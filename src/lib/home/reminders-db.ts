import { db } from "../db";
import { loadGroup } from "../group-data";
import { claimJob, finishJob, sendPushTo } from "../push";
import { dayKey, DEFAULT_TIME_ZONE } from "../dates";
import { addDays } from "../local-time";
import { coveredByOldRecord, splitByZone, zonesOf } from "../nudge-zones";
import { billStatuses } from "./bills-db";
import { reminderPlan, type ReminderGroup } from "./reminders";

// The daily job's reminders: once per day and flat (each flat claimed on its own,
// so a run that runs out of time carries on with the flats it didn't reach next
// time, and never repeats the ones it did). For flats that turned them on.
// People whose phone has told us its time zone get theirs in their own daytime (06:00-22:00 there), once
// per person per local day; everyone else keeps the flat's India-time claim.
// `stop` says time is short: the rest is left for the next run ("deferred").
// `legacy: false` = it is night in India: only the people with a zone of their own are sent to.
export async function sendReminders(now = new Date(), stop: () => boolean = () => false, opts: { legacy?: boolean } = {}) {
  const legacyOk = opts.legacy !== false;
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  const tomorrow = addDays(today, 1);
  const groups = await db.group.findMany({ where: { type: "home", reminders: true, deletedAt: null, closed: false }, select: { id: true, members: { select: { id: true } } }, orderBy: { id: "asc" } });
  const zones = await zonesOf(groups.flatMap((g) => g.members.map((m) => m.id)));
  let sent = 0;
  let deferred = false;
  // The day this was deployed, the old whole-day claim ("reminders:<day>") may already be done: those reminders
  // went out, so no flat is sent them a second time under the new per-flat claims.
  const wholeDay = await db.notifyLog.findUnique({ where: { key: `reminders:${today}` }, select: { state: true } });
  const wholeDayDone = wholeDay?.state === "done";
  for (const { id, members } of groups) {
    if (stop()) { deferred = true; break; }
    const { legacy, zoned } = splitByZone(members.map((m) => m.id), zones, now);
    const key = `reminders:${today}:${id}`;
    const runLegacy = legacyOk && !wholeDayDone && legacy.length > 0 && (await claimJob(key, now));
    if (!runLegacy && !zoned.length) continue;
    const data = await loadGroup(id, { events: false });
    if (data) {
      const bills = await billStatuses(id, now);
      const planFor = (day: string, nextDay: string) => {
        const input: ReminderGroup = {
          id,
          name: data.group.name,
          type: data.group.type,
          reminders: data.group.reminders,
          settleDay: data.group.settleDay,
          settleMin: data.group.settleMin,
          currency: data.group.currency,
          transfers: data.transfers,
          billsTomorrow: bills.filter((b) => b.status === "upcoming" && b.due === nextDay && b.payerId).map((b) => ({ payerId: b.payerId!, name: b.bill.name })),
          names: Object.fromEntries(data.group.members.map((m) => [m.id, m.name])),
        };
        return reminderPlan(day, [input]);
      };
      if (runLegacy) {
        const mine = new Set(legacy);
        for (const r of planFor(today, tomorrow)) {
          const to = r.memberIds.filter((m) => mine.has(m));
          if (to.length) sent += await sendPushTo(to, r);
        }
      }
      for (const p of zoned) {
        const plan = planFor(p.today, p.tomorrow).filter((r) => r.memberIds.includes(p.id));
        if (!plan.length) continue;
        if (!p.daytime) { deferred = true; continue; } // their night: the next run (when it is day there) sends it
        const personKey = `reminders:${p.today}:${id}:m:${p.id}`;
        if (await coveredByOldRecord(`reminders:${p.today}:${id}`)) continue;
        if (!(await claimJob(personKey, now))) continue;
        for (const r of plan) sent += await sendPushTo([p.id], r);
        await finishJob(personKey);
      }
    }
    if (runLegacy) await finishJob(key);
  }
  return { sent, skipped: wholeDayDone, deferred };
}
