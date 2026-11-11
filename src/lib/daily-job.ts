import { runAllBills } from "./home/bills-db";
import { sendReminders } from "./home/reminders-db";
import { checkBudgets } from "./home/budgets-db";
import { sendMonthlySummaries } from "./home/insights-db";
import { sendMemoryLane, sendTripCountdowns } from "./countdown-db";
import { noteOpenedPostcards } from "./postcards/open-db";
import { db } from "./db";
import { DEFAULT_TIME_ZONE } from "./dates";

// The parts of the daily job that send things or add bills. Every one of them
// claims its work per group (or per bill month) before doing it, so any of them
// can be run again safely: a repeat only does what's still undone. That is how
// a run that ran out of time is finished later (the evening job calls this too,
// and so does the end of the daily run if there is time left).

// The job has 60 seconds on Vercel; stop starting new work after 50.
export const DAILY_BUDGET_MS = 50_000;

// `stop()` turns true once the budget is used up. `nowMs` is for tests.
export function makeStop(budgetMs = DAILY_BUDGET_MS, nowMs: () => number = Date.now): () => boolean {
  const started = nowMs();
  return () => nowMs() - started >= budgetMs;
}

export type PartsReport = { results: Record<string, unknown>; deferred: string[] };

// Each part runs on its own: one failing doesn't stop the rest. A part that
// can't start (time is short) or that stops early is listed as deferred.
export async function runClaimedParts(now: Date, stop: () => boolean, failed: string[]): Promise<PartsReport> {
  const results: Record<string, unknown> = {};
  const deferred: string[] = [];
  const part = async (name: string, fn: () => Promise<unknown>) => {
    if (stop()) {
      deferred.push(name);
      results[name] = { deferred: true };
      return;
    }
    try {
      const r = await fn();
      results[name] = r;
      if ((r as { deferred?: boolean } | null)?.deferred === true) deferred.push(name);
    } catch (err) {
      console.error(`daily job: ${name} failed`, String(err).slice(0, 300));
      failed.push(name);
      results[name] = { error: "failed" };
    }
  };
  // Phone nudges never go out in the night, even if the job is started early.
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: DEFAULT_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(now));
  const daytime = hour >= 6 && hour < 22;
  const night = async () => ({ sent: 0, skipped: "night" });

  await part("bills", () => runAllBills(now, stop));
  await part("reminders", () => (daytime ? sendReminders(now, stop) : night()));
  await part("countdowns", () => (daytime ? sendTripCountdowns(now, stop) : night()));
  // Budgets reached by bills added just now.
  await part("budgets", async () => {
    const groups = await db.budget.findMany({ select: { groupId: true }, distinct: ["groupId"], orderBy: { groupId: "asc" } });
    let sent = 0;
    for (const b of groups) {
      if (stop()) return { sent, deferred: true };
      sent += (await checkBudgets(b.groupId, now).catch(() => [])).length;
    }
    return { sent, deferred: false };
  });
  await part("summaries", () => (daytime ? sendMonthlySummaries(now, stop) : night()));
  await part("memories", () => (daytime ? sendMemoryLane(now, stop) : night()));
  await part("postcards", () => noteOpenedPostcards(now));
  await part("blob-trash", async () => (await import("./photo-store")).flushPhotoDeletes(200, now));
  return { results, deferred };
}
