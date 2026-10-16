import { db } from "../db";
import { logEvent } from "../events";
import { formatMoney, parseAmount } from "../money";
import { BILL_TEMPLATES, firstMonth, ordinalDay, toggleMissed } from "./bills";
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
  split: string; // group | equal | some
  ids: string[]; // when split = some
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
  const split = (["group", "equal", "some"] as const).find((s) => s === input.split) ?? "group";
  const ids = split === "some" ? active.filter((m) => input.ids.includes(m.id)).map((m) => m.id) : [];
  if (split === "some" && ids.length === 0) return { ok: false, error: "Pick who shares it." };

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
    split: JSON.stringify({ mode: split, ids }),
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
    const b = await tx.bill.create({ data: { ...data, groupId, startMonth, tz, createdById: actorId } });
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
  const month = dayKey(now, bill.tz).slice(0, 7);
  if (command === "skip") {
    // Skip the month that's waiting, or else this month (if not added yet), or next month.
    const waiting = await db.billRun.findFirst({ where: { billId, status: "waiting" }, orderBy: { period: "asc" } });
    if (waiting) await db.billRun.update({ where: { id: waiting.id }, data: { status: "skipped", reason: "skipped" } });
    else {
      const thisRun = await db.billRun.findUnique({ where: { billId_period: { billId, period: month } } });
      const period = thisRun ? (await import("./month")).addMonths(month, 1) : month;
      await db.billRun.upsert({ where: { billId_period: { billId, period } }, create: { billId, period, status: "skipped", reason: "skipped" }, update: {} });
    }
  } else if (command === "pause" || command === "resume") {
    await db.bill.update({ where: { id: billId }, data: { paused: command === "pause" } });
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
