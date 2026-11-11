import { db } from "../db";
import { loadGroup } from "../group-data";
import { claimJob, finishJob, sendPushTo } from "../push";
import { dayKey, DEFAULT_TIME_ZONE } from "../dates";
import { billStatuses } from "./bills-db";
import { reminderPlan, type ReminderGroup } from "./reminders";

// The daily job's reminders: once per day and flat (each flat claimed on its own,
// so a run that runs out of time carries on with the flats it didn't reach next
// time, and never repeats the ones it did). For flats that turned them on.
// `stop` says time is short: the rest is left for the next run ("deferred").
export async function sendReminders(now = new Date(), stop: () => boolean = () => false) {
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000), DEFAULT_TIME_ZONE);
  const groups = await db.group.findMany({ where: { type: "home", reminders: true, deletedAt: null, closed: false }, select: { id: true }, orderBy: { id: "asc" } });
  let sent = 0;
  let deferred = false;
  // The day this was deployed, the old whole-day claim ("reminders:<day>") may already be done: those reminders
  // went out, so no flat is sent them a second time under the new per-flat claims.
  const wholeDay = await db.notifyLog.findUnique({ where: { key: `reminders:${today}` }, select: { state: true } });
  if (wholeDay?.state === "done") return { sent: 0, skipped: true, deferred: false };
  for (const { id } of groups) {
    if (stop()) { deferred = true; break; }
    const key = `reminders:${today}:${id}`;
    if (!(await claimJob(key, now))) continue;
    const data = await loadGroup(id, { events: false });
    if (data) {
      const bills = await billStatuses(id, now);
      const input: ReminderGroup = {
        id,
        name: data.group.name,
        type: data.group.type,
        reminders: data.group.reminders,
        settleDay: data.group.settleDay,
        settleMin: data.group.settleMin,
        currency: data.group.currency,
        transfers: data.transfers,
        billsTomorrow: bills.filter((b) => b.status === "upcoming" && b.due === tomorrow && b.payerId).map((b) => ({ payerId: b.payerId!, name: b.bill.name })),
        names: Object.fromEntries(data.group.members.map((m) => [m.id, m.name])),
      };
      for (const r of reminderPlan(today, [input])) sent += await sendPushTo(r.memberIds, r);
    }
    await finishJob(key);
  }
  return { sent, skipped: false, deferred };
}
