import { db } from "../db";
import { loadGroup } from "../group-data";
import { claimOnce, sendPushTo } from "../push";
import { dayKey, DEFAULT_TIME_ZONE } from "../dates";
import { billStatuses } from "./bills-db";
import { reminderPlan, type ReminderGroup } from "./reminders";

// The daily job's reminders: once per day (claimed), for flats that turned them on.
export async function sendReminders(now = new Date()) {
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  if (!(await claimOnce(`reminders:${today}`))) return { sent: 0, skipped: true };
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000), DEFAULT_TIME_ZONE);
  const groups = await db.group.findMany({ where: { type: "home", reminders: true, deletedAt: null, closed: false }, select: { id: true } });
  const input: ReminderGroup[] = [];
  for (const { id } of groups) {
    const data = await loadGroup(id);
    if (!data) continue;
    const bills = await billStatuses(id, now);
    input.push({
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
    });
  }
  let sent = 0;
  for (const r of reminderPlan(today, input)) sent += await sendPushTo(r.memberIds, r);
  return { sent, skipped: false };
}
