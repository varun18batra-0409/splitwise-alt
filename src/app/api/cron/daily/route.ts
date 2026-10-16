import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { runAllBills } from "@/lib/home/bills-db";
import { sendReminders } from "@/lib/home/reminders-db";
import { checkBudgets } from "@/lib/home/budgets-db";
import { sendMonthlySummaries } from "@/lib/home/insights-db";
import { db } from "@/lib/db";
import { allow, clientIp } from "@/lib/rate-limit";
import { DEFAULT_TIME_ZONE } from "@/lib/dates";

// The daily job (Vercel Cron, 06:00 India time): adds the bills that are due.
// Safe to run more than once — every bill month is added at most once.
// When CRON_SECRET is set (Vercel sends it), only that caller may run it.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sameSecret(given: string | null, secret: string) {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Each part runs on its own: one failing doesn't stop the rest.
async function part<T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    console.error(`daily job: ${name} failed`, String(err).slice(0, 300));
    return { error: "failed" };
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && !sameSecret(req.headers.get("authorization"), secret)) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  // No secret set: anyone may run it (it only adds what's due anyway), but not often.
  if (!secret && !(await allow(`cron:${clientIp(await headers())}`, 12, 3600))) {
    return Response.json({ error: "Too many runs" }, { status: 429 });
  }
  const now = new Date();
  const bills = await part("bills", () => runAllBills(now));
  // Phone nudges never go out in the night, even if the job is started early.
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: DEFAULT_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(now));
  const daytime = hour >= 6 && hour < 22;
  const reminders = daytime ? await part("reminders", () => sendReminders(now)) : { sent: 0, skipped: "night" };
  // Budgets reached by bills added just now.
  const budgetAlerts = await part("budgets", async () => {
    const groups = await db.budget.findMany({ select: { groupId: true }, distinct: ["groupId"] });
    let n = 0;
    for (const b of groups) n += (await checkBudgets(b.groupId, now).catch(() => [])).length;
    return n;
  });
  const summaries = daytime ? await part("summaries", () => sendMonthlySummaries(now)) : { sent: 0, skipped: "night" };
  // Speed numbers are kept two weeks.
  const speedLogsRemoved = await part("cleanup", async () => (await db.speedLog.deleteMany({ where: { at: { lt: new Date(now.getTime() - 14 * 86_400_000) } } })).count);
  return Response.json({ ok: true, bills, reminders, budgetAlerts, summaries, speedLogsRemoved });
}
