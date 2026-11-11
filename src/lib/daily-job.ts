import { runAllBills } from "./home/bills-db";
import { sendReminders } from "./home/reminders-db";
import { checkBudgets } from "./home/budgets-db";
import { sendMonthlySummaries } from "./home/insights-db";
import { sendMemoryLane, sendTripCountdowns } from "./countdown-db";
import { noteOpenedPostcards } from "./postcards/open-db";
import { db } from "./db";
import { DEFAULT_TIME_ZONE, dayKey } from "./dates";

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

// The parts, in the order they run.
export const PART_NAMES = ["bills", "reminders", "countdowns", "budgets", "summaries", "memories", "postcards", "blob-trash"] as const;

// What the morning run could not finish is written down (one NotifyLog row per part, for that day), so the
// evening catch-up runs exactly those parts and nothing else: it must not send first-time nudges at 21:30
// that the morning run had already done or had no reason to send. Rows are small and removed after a week.
const deferredPrefix = (today: string) => `daily-deferred:${today}:`;

export async function recordDeferred(now: Date, parts: string[]): Promise<void> {
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  for (const part of new Set(parts)) {
    if (!(PART_NAMES as readonly string[]).includes(part)) continue;
    await db.notifyLog.create({ data: { key: `${deferredPrefix(today)}${part}`, state: "done", createdAt: now } }).catch(() => undefined); // already noted
  }
}

// The morning run writes `daily-started:<day>` when it begins and `daily-finished:<day>` when it is through.
// If the evening finds it started but never finished (it crashed or was cut off), or never started at all
// (the cron did not fire), it runs every part: safe, because each part claims its work per group first.
const startedKey = (today: string) => `daily-started:${today}`;
const finishedKey = (today: string) => `daily-finished:${today}`;

async function note(key: string, now: Date) {
  await db.notifyLog.create({ data: { key, state: "done", createdAt: now } }).catch(() => undefined); // already noted
}
export const markDailyStarted = (now: Date) => note(startedKey(dayKey(now, DEFAULT_TIME_ZONE)), now);
export const markDailyFinished = (now: Date) => note(finishedKey(dayKey(now, DEFAULT_TIME_ZONE)), now);

export async function dailyState(now: Date): Promise<{ started: boolean; finished: boolean }> {
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  const rows = await db.notifyLog.findMany({ where: { key: { in: [startedKey(today), finishedKey(today)] } }, select: { key: true } });
  const keys = new Set(rows.map((r) => r.key));
  return { started: keys.has(startedKey(today)), finished: keys.has(finishedKey(today)) };
}

export async function deferredToday(now: Date): Promise<string[]> {
  const prefix = deferredPrefix(dayKey(now, DEFAULT_TIME_ZONE));
  const rows = await db.notifyLog.findMany({ where: { key: { startsWith: prefix } }, select: { key: true } });
  const noted = new Set(rows.map((r) => r.key.slice(prefix.length)));
  return PART_NAMES.filter((p) => noted.has(p));
}

// The evening catch-up: run only the parts the morning left undone (nothing deferred = nothing at all).
// A part that gets through is crossed off; the groups it already did are not repeated (their own claims).
export async function runDeferredParts(now: Date, stop: () => boolean, failed: string[]): Promise<PartsReport> {
  const noted = await deferredToday(now);
  const state = await dailyState(now);
  // The morning did not start, or did not get to the end: nothing says what it missed, so try every part.
  const everything = !state.started || !state.finished;
  const todo: string[] = everything ? [...PART_NAMES] : noted;
  if (!todo.length) return { results: {}, deferred: [] };
  const report = await runClaimedParts(now, stop, failed, todo);
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  const finished = todo.filter((p) => !report.deferred.includes(p) && !failed.includes(p));
  if (finished.length) await db.notifyLog.deleteMany({ where: { key: { in: finished.map((p) => `${deferredPrefix(today)}${p}`) } } }).catch(() => undefined);
  // Everything got through: the day counts as done, so a second evening run does nothing.
  if (everything && finished.length === todo.length) {
    await markDailyStarted(now);
    await markDailyFinished(now);
  }
  return report;
}

// Each part runs on its own: one failing doesn't stop the rest. A part that
// can't start (time is short) or that stops early is listed as deferred.
// `only`: run just these parts (the evening catch-up).
export async function runClaimedParts(now: Date, stop: () => boolean, failed: string[], only?: readonly string[]): Promise<PartsReport> {
  const results: Record<string, unknown> = {};
  const deferred: string[] = [];
  const part = async (name: string, fn: () => Promise<unknown>) => {
    if (only && !only.includes(name)) return;
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
  // (Not sent at night, so it counts as left for later.)
  const night = async () => ({ sent: 0, skipped: "night", deferred: true });

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
