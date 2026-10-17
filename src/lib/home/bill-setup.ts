import { db } from "../db";
import { logEvent } from "../events";
import { formatMoney, formatPercent, parseAmount, parsePercent } from "../money";
import { BILL_TEMPLATES, addMissed, daysBefore, daysInRange, firstMonth, monthsBetween, ordinalDay, periodsDue, toggleMissed } from "./bills";
import { addMonths, dueKey } from "./month";
import { DEFAULT_TIME_ZONE, dayKey } from "../dates";

// Setting bills up and changing them (database side, checked here).

type Result = { ok: true; id: string } | { ok: false; error: string };

export type BillInput = {
  billId?: string; // editing
  template: string;
  name: string;
  nature: string; // fixed | varies | daily
  amount: string; // typed; for varies, optional ("usually")
  day: string; // 1–28, or 31 = last day
  payer: string; // memberId, or "turns"
  split: string; // group | equal | some | percent | amounts
  ids: string[]; // when split = some
  pct?: Record<string, string>; // when split = percent: "50" per person
  amt?: Record<string, string>; // when split = amounts: "18000" per person
};

export async function saveBillFor(groupId: string, actorId: string, input: BillInput, now = new Date()): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  const actor = group.members.find((m) => m.id === actorId && !m.leftAt);
  if (!actor) return { ok: false, error: "Only people in this group can set up bills." };
  const active = group.members.filter((m) => !m.leftAt);

  const tpl = BILL_TEMPLATES.find((t) => t.id === input.template) ?? BILL_TEMPLATES[BILL_TEMPLATES.length - 1];
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 40) || tpl.name;
  const nature = (["fixed", "varies", "daily"] as const).find((n) => n === input.nature) ?? tpl.nature;
  const amount = input.amount.trim() ? parseAmount(input.amount, group.currency) : null;
  if (input.amount.trim() && amount === null) return { ok: false, error: "Enter the amount as a number, like 4000." };
  if (nature !== "varies" && !(amount && amount > 0)) return { ok: false, error: nature === "daily" ? "Enter the price per day." : "Enter the amount." };
  const day = Number(input.day);
  if (nature !== "daily" && !(Number.isInteger(day) && ((day >= 1 && day <= 28) || day === 31))) return { ok: false, error: "Pick the day it’s due." };
  const turns = input.payer === "turns";
  if (!turns && !active.some((m) => m.id === input.payer)) return { ok: false, error: "Pick who pays." };
  const split = (["group", "equal", "some", "percent", "amounts"] as const).find((s) => s === input.split) ?? "group";
  const ids = split === "some" ? active.filter((m) => input.ids.includes(m.id)).map((m) => m.id) : [];
  if (split === "some" && ids.length === 0) return { ok: false, error: "Pick who shares it." };
  // Unequal: a percentage or a fixed amount for each person (blank = nothing).
  const pct: Record<string, number> = {};
  const amt: Record<string, number> = {};
  if (split === "percent") {
    for (const m of active) {
      const bp = parsePercent(input.pct?.[m.id] ?? "");
      if (bp === null) return { ok: false, error: `${m.name}’s percentage isn’t a number.` };
      if (bp > 0) pct[m.id] = bp;
    }
    const sum = Object.values(pct).reduce((x, y) => x + y, 0);
    if (sum !== 10000) return { ok: false, error: `The percentages add up to ${formatPercent(sum)}. They need to add up to 100%.` };
  }
  if (split === "amounts") {
    if (nature !== "fixed") return { ok: false, error: "Fixed amounts only work for a bill that’s the same each month. Use percentages instead." };
    for (const m of active) {
      const raw = (input.amt?.[m.id] ?? "").trim();
      if (!raw) continue;
      const v = parseAmount(raw, group.currency);
      if (v === null || v < 0) return { ok: false, error: `${m.name}’s amount isn’t a number.` };
      if (v > 0) amt[m.id] = v;
    }
    const sum = Object.values(amt).reduce((x, y) => x + y, 0);
    if (sum !== (amount ?? 0)) return { ok: false, error: `The amounts add up to ${formatMoney(sum, group.currency)}. They need to add up to ${formatMoney(amount ?? 0, group.currency)}.` };
  }

  const data = {
    name,
    category: tpl.category,
    icon: tpl.id,
    nature,
    amount: amount ?? 0,
    day: nature === "daily" ? 31 : day,
    every: tpl.every ?? 1,
    payer: turns ? "" : input.payer,
    rotation: turns ? JSON.stringify(active.map((m) => m.id)) : "[]",
    split: JSON.stringify(split === "percent" ? { mode: split, pct } : split === "amounts" ? { mode: split, amt } : { mode: split, ids }),
  };
  const money = (n: number) => formatMoney(n, group.currency);
  const when = nature === "daily" ? "added up at month end" : `on the ${ordinalDay(data.day)}`;
  const what = nature === "varies" ? "amount entered each time" : nature === "daily" ? `${money(data.amount)} a day` : money(data.amount);

  if (input.billId) {
    const existing = await db.bill.findFirst({ where: { id: input.billId, groupId, deletedAt: null } });
    if (!existing) return { ok: false, error: "That bill no longer exists." };
    await db.$transaction(async (tx) => {
      await tx.bill.update({ where: { id: existing.id }, data });
      await logEvent(tx, { groupId, actorId, kind: "bill_changed", text: `changed the bill ${name} (${what}, ${when})` });
    });
    return { ok: true, id: existing.id };
  }

  const tz = DEFAULT_TIME_ZONE;
  const startMonth = firstMonth(data.day, nature, now, tz);
  const bill = await db.$transaction(async (tx) => {
    // A daily bill set up mid-month counts only from today: earlier days are marked as not come.
    const missed = nature === "daily" ? daysBefore(startMonth, dayKey(now, tz)) : "{}";
    const b = await tx.bill.create({ data: { ...data, groupId, startMonth, tz, createdById: actorId, missed } });
    await logEvent(tx, { groupId, actorId, kind: "bill_added", text: `set up ${name} (${what}, ${when})` });
    return b;
  });
  return { ok: true, id: bill.id };
}

// Skip this month, pause, resume or stop a bill.
export async function billCommand(groupId: string, actorId: string, billId: string, command: string, now = new Date()): Promise<Result> {
  const bill = await db.bill.findFirst({ where: { id: billId, groupId, deletedAt: null }, include: { group: { include: { members: true } } } });
  if (!bill) return { ok: false, error: "That bill no longer exists." };
  if (!bill.group.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can change bills." };
  if (command === "skip") {
    // Skip the month that's waiting, or else this month (if not added yet), or next month.
    const waiting = await db.billRun.findFirst({ where: { billId, status: "waiting" }, orderBy: { period: "asc" } });
    if (waiting) await db.billRun.update({ where: { id: waiting.id }, data: { status: "skipped", reason: "skipped" } });
    else {
      // The first month from this one that the bill comes round in and isn't added yet
      // (a bill every 2 months skips its next real month).
      const comesIn = (p: string) => p >= bill.startMonth && monthsBetween(bill.startMonth, p) % Math.max(1, bill.every) === 0 && (!bill.endMonth || p <= bill.endMonth);
      let next: string | null = null;
      for (let i = 0, p = dayKey(now, bill.tz).slice(0, 7); i < 36 && !next; i++, p = addMonths(p, 1)) {
        if (comesIn(p) && !(await db.billRun.findUnique({ where: { billId_period: { billId, period: p } } }))) next = p;
      }
      if (!next) return { ok: false, error: "There’s no coming month to skip." };
      const period = next;
      await db.billRun.upsert({ where: { billId_period: { billId, period } }, create: { billId, period, status: "skipped", reason: "skipped" }, update: {} });
    }
  } else if (command === "pause") {
    if (!bill.paused) await db.bill.update({ where: { id: billId }, data: { paused: true, pausedAt: now } });
  } else if (command === "resume") {
    // What came round while it was paused isn't charged afterwards: a monthly
    // bill skips the months it fell due in; a daily one counts those days as not come.
    const today = dayKey(now, bill.tz);
    const from = bill.pausedAt ? dayKey(bill.pausedAt, bill.tz) : "";
    await db.$transaction(async (tx) => {
      let missed = bill.missed;
      if (bill.nature === "daily") {
        if (from) for (const p of [addMonths(today.slice(0, 7), -1), today.slice(0, 7)]) missed = addMissed(missed, p, daysInRange(p, from, today));
      } else {
        for (const period of periodsDue({ ...bill, paused: false }, now)) {
          if (from && dueKey(period, bill.day >= 31 ? "last" : bill.day) < from) continue;
          await tx.billRun.upsert({ where: { billId_period: { billId, period } }, create: { billId, period, status: "skipped", reason: "paused" }, update: {} });
        }
      }
      await tx.bill.update({ where: { id: billId }, data: { paused: false, pausedAt: null, missed } });
    });
  } else if (command === "stop") {
    await db.bill.update({ where: { id: billId }, data: { deletedAt: new Date() } });
  } else return { ok: false, error: "Unknown action." };
  const text = { skip: `skipped ${bill.name} this time`, pause: `paused ${bill.name}`, resume: `started ${bill.name} again`, stop: `stopped ${bill.name}` }[command]!;
  await logEvent(db, { groupId, actorId, kind: "bill_changed", text });
  return { ok: true, id: billId };
}

// Daily bill calendar: tap a day it didn't come (or did after all).
export async function toggleMissedDayFor(groupId: string, actorId: string, billId: string, period: string, day: number): Promise<Result> {
  const bill = await db.bill.findFirst({ where: { id: billId, groupId, deletedAt: null, nature: "daily" }, include: { group: { include: { members: true } } } });
  if (!bill) return { ok: false, error: "That bill no longer exists." };
  if (!bill.group.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can change bills." };
  if (!/^\d{4}-\d{2}$/.test(period) || !Number.isInteger(day)) return { ok: false, error: "That day isn’t valid." };
  // Only months not added yet can change.
  if (await db.billRun.findUnique({ where: { billId_period: { billId, period } } })) return { ok: false, error: "That month has already been added." };
  await db.bill.update({ where: { id: billId }, data: { missed: toggleMissed(bill.missed, period, day) } });
  return { ok: true, id: billId };
}

// Settings → "Reminders and settling up".
export async function saveSettleRulesFor(
  groupId: string,
  actorId: string,
  input: { reminders: boolean; settleDay: number; settleMin: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can change this." };
  const day = Number.isInteger(input.settleDay) && ((input.settleDay >= 1 && input.settleDay <= 28) || input.settleDay === 31) ? input.settleDay : 0;
  const min = input.settleMin.trim() ? parseAmount(input.settleMin, group.currency) : 0;
  if (min === null || min < 0) return { ok: false, error: "Enter the smallest amount as a number, like 50." };
  const reminders = group.type === "home" ? input.reminders : false;
  const changes: string[] = [];
  if (reminders !== group.reminders) changes.push(reminders ? "Reminders on" : "Reminders off");
  if (day !== group.settleDay) changes.push(day ? `Settle-up day: the ${ordinalDay(day)}` : "No settle-up day");
  if (min !== group.settleMin) changes.push(min ? `Leave out payments under ${formatMoney(min, group.currency)}` : "Show every payment");
  if (!changes.length) return { ok: true };
  await db.$transaction(async (tx) => {
    await tx.group.update({ where: { id: groupId }, data: { reminders, settleDay: day, settleMin: min } });
    await logEvent(tx, { groupId, actorId, kind: "bill_changed", text: "changed how the group settles up", details: changes });
  });
  return { ok: true };
}
