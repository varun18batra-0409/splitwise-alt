import { headers } from "next/headers";
import { runAllBills } from "@/lib/home/bills-db";
import { sendReminders } from "@/lib/home/reminders-db";
import { allow, clientIp } from "@/lib/rate-limit";

// The daily job (Vercel Cron, 06:00 India time): adds the bills that are due.
// Safe to run more than once — every bill month is added at most once.
// When CRON_SECRET is set (Vercel sends it), only that caller may run it.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Not allowed" }, { status: 401 });
  }
  // No secret set: anyone may run it (it only adds what's due anyway), but not often.
  if (!secret && !(await allow(`cron:${clientIp(await headers())}`, 12, 3600))) {
    return Response.json({ error: "Too many runs" }, { status: 429 });
  }
  const now = new Date();
  const bills = await runAllBills(now);
  const reminders = await sendReminders(now);
  return Response.json({ ok: true, bills, reminders });
}
