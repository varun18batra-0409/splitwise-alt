import { db } from "./db";

// The daily clean-up of the "already sent" notes (NotifyLog). Only notes that belong to ONE day or ONE month are removed, and only
// after 60 days, long past the last time any job looks at them. Everything else is kept on purpose, because it is a one-time marker
// that must stay for good: "zones-live" and "bill-asks-live" (the switch-over moments, read back by their date), "invite-note:",
// "trip-from-goal:" and "trip-from-goal-made:" (so a trip is made from a goal once), the mail counters and the keys cleaned elsewhere.
// A list of what may go (not of what may stay), so a new kind of note is never deleted by surprise.
export const NOTIFY_LOG_KEEP_DAYS = 60;
export const NOTIFY_LOG_CLEANABLE_PREFIXES = ["countdown:", "countdown-after:", "pulse:", "memory:", "reminders:", "billask:", "budget:", "budget-zone:", "summary:"] as const;

export async function cleanOldNotifyLog(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - NOTIFY_LOG_KEEP_DAYS * 86_400_000);
  const r = await db.notifyLog.deleteMany({
    where: { createdAt: { lt: before }, OR: NOTIFY_LOG_CLEANABLE_PREFIXES.map((p) => ({ key: { startsWith: p } })) },
  });
  return r.count;
}
