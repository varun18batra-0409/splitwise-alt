import { db } from "../db";
import { logEvent, type Db } from "../events";
import { withRetry } from "../once";
import { formatMoney, formatPercent, parseAmount, parsePercent } from "../money";
import { typedZero } from "../zero-amount";
import { BILL_TEMPLATES, addMissed, dayRangeLabel, daysBefore, daysInRange, firstMonth, monthsBetween, ordinalDay, periodsDue, toggleMissed } from "./bills";
import { addMonths, dueKey } from "./month";
import { parsePrepaid } from "./moving";
import type { Prisma } from "@prisma/client";
import { addMonthSoFar, catchUpLastMonth, monthLongName, parseSplit } from "./bills-db";
import { DEFAULT_TIME_ZONE, dayKey } from "../dates";

// Setting bills up and changing them (database side, checked here).

type Result = { ok: true; id: string } | { ok: false; error: string };

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// A move-out share of a daily bill's month was charged at the bill's price (and for the days it came): until that month is added, these can't change.
const PRICE_LOCKED = (bill: string) => `A move-out share of this month’s ${bill} was charged at the current price, so the price, type and split can’t change until this month is added.`;
const SKIP_PART_LOCKED = (bill: string) => `Part of this month’s ${bill} was already added, so this month can’t be skipped.`;
const SKIP_LOCKED = (bill: string) => `A move-out share of this month’s ${bill} was already charged, so this month can’t be skipped.`;
class BillLocked extends Error {}
// The split as people, not as text: the same people and amounts compare equal whatever order or spacing the JSON has.
const splitKey = (json: string) => {
  const v = parseSplit(json);
  return JSON.stringify([v.mode, [...v.ids].sort(), Object.entries(v.pct).sort(([a], [b]) => a.localeCompare(b)), Object.entries(v.amt).sort(([a], [b]) => a.localeCompare(b))]);
};

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
  if (group.type === "direct") return { ok: false, error: "This is just between two people, so it has none of these extras." };
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
      if (!raw || typedZero(raw)) continue; // blank or a typed zero: this person is skipped
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
    try {
      await db.$transaction(async (tx) => {
        // A daily bill with a move-out share charged for a month that isn't added yet: the share was worked out at today's price, type
        // and split, so those can't change until the month is added (the name and who pays still can). Read again here, in the write.
        const cur = await tx.bill.findFirst({ where: { id: existing.id, groupId, deletedAt: null } });
        if (!cur) throw new BillLocked("That bill no longer exists.");
        if (cur.nature === "daily" && (data.amount !== cur.amount || data.nature !== cur.nature || splitKey(data.split) !== splitKey(cur.split))) {
          // (Months older than last month can never be added again, so what was charged in them locks nothing.)
          const oldest = addMonths(dayKey(now, cur.tz || DEFAULT_TIME_ZONE).slice(0, 7), -1);
          const periods = Object.entries(parsePrepaid(cur.prepaid)).filter(([period, list]) => list.length && period >= oldest);
          if (periods.length) {
            const runs = await tx.billRun.findMany({ where: { billId: cur.id }, select: { period: true, status: true } });
            if (periods.some(([period]) => { const run = runs.find((r) => r.period === period); return !run || run.status === "waiting"; })) throw new BillLocked(PRICE_LOCKED(cur.name));
          }
        }
        await tx.bill.update({ where: { id: existing.id }, data });
        await logEvent(tx, { groupId, actorId, kind: "bill_changed", text: `changed the bill ${name} (${what}, ${when})` });
      });
    } catch (err) {
      if (err instanceof BillLocked) return { ok: false, error: err.message };
      throw err;
    }
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

type DailyBill = NonNullable<Awaited<ReturnType<typeof loadDaily>>>;
const loadDaily = (billId: string) => db.bill.findFirst({ where: { id: billId, deletedAt: null }, include: { group: { include: { members: true } } } });

// Stopping a bill: every month with charges written on it and no bill is closed ("stopped"), so those charges lock; then the bill goes.
async function finishStop(tx: Prisma.TransactionClient, billId: string, now: Date) {
  const cur = await tx.bill.findUnique({ where: { id: billId }, select: { prepaid: true, deletedAt: true } });
  if (!cur || cur.deletedAt) return;
  for (const [period, list] of Object.entries(parsePrepaid(cur.prepaid))) {
    if (!list.length) continue;
    await tx.billRun.upsert({ where: { billId_period: { billId, period } }, create: { billId, period, status: "skipped", reason: "stopped" }, update: {} });
  }
  await tx.bill.update({ where: { id: billId }, data: { deletedAt: now } });
}

// Pause or stop a daily bill: last month first (if it is due), then the month so far, then the pause or stop, all or nothing.
async function changeDaily(bill: DailyBill, command: "pause" | "stop", actorId: string, now: Date, expect: number | null): Promise<Result> {
  const verb = command === "pause" ? "paused" : "stopped";
  const group = { id: bill.group.id, currency: bill.group.currency, closed: bill.group.closed, members: bill.group.members };
  if (!bill.paused) {
    const bad = await catchUpLastMonth(bill, group, now, verb);
    if (bad) return { ok: false, error: bad };
  }
  const fresh = await loadDaily(bill.id);
  if (!fresh) return { ok: false, error: "That bill no longer exists." };
  const today = dayKey(now, bill.tz);
  // A bill that is already paused counts nothing from the day it was paused.
  const pausedDay = fresh.paused && fresh.pausedAt ? dayKey(fresh.pausedAt, bill.tz) : "";
  const until = pausedDay && pausedDay < today ? pausedDay : today;
  const finish = (tx: Prisma.TransactionClient) =>
    command === "pause" ? tx.bill.updateMany({ where: { id: bill.id, paused: false, deletedAt: null }, data: { paused: true, pausedAt: now } }).then(() => undefined) : finishStop(tx, bill.id, now);
  const r = await addMonthSoFar(fresh, group, { period: today.slice(0, 7), until, verb, actorId, now, expect, finish });
  return r.ok ? { ok: true, id: bill.id } : r;
}

// Skip this month, pause, resume or stop a bill.
// `expect`: the amount the confirm showed (the month so far a pause, stop or start-again adds); if the server now works out another, nothing is done.
export async function billCommand(groupId: string, actorId: string, billId: string, command: string, now = new Date(), opts: { afterRead?: () => Promise<void>; expect?: number | null } = {}): Promise<Result> {
  const bill = await db.bill.findFirst({ where: { id: billId, groupId, deletedAt: null }, include: { group: { include: { members: true } } } });
  if (!bill) return { ok: false, error: "That bill no longer exists." };
  if (!bill.group.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can change bills." };
  if (command === "skip") {
    // Skip the month that's waiting, or else this month (if not added yet), or next month.
    const waiting = await db.billRun.findFirst({ where: { billId, status: "waiting" }, orderBy: { period: "asc" } });
    // A daily bill's month that already has a move-out share charged can't be skipped (the share would be left with no month-end bill).
    // Read again inside the write (a move-out can commit a charge in the gap), never from the first look.
    // "part" = only part charges (a pause or stop earlier this month); "move" = a move-out charge is in it.
    const charged = async (tx: Prisma.TransactionClient, period: string): Promise<"part" | "move" | null> => {
      const now2 = await tx.bill.findUnique({ where: { id: billId }, select: { nature: true, prepaid: true } });
      const list = now2 && now2.nature === "daily" ? parsePrepaid(now2.prepaid)[period] ?? [] : [];
      return list.length === 0 ? null : list.every((x) => x.k === "part") ? "part" : "move";
    };
    await opts.afterRead?.();
    if (waiting) {
      // Only while it is still waiting: if it was added in the gap, nothing is skipped.
      const done = await db.$transaction(async (tx) => {
        const kind = await charged(tx, waiting.period);
        if (kind) return kind;
        const c = await tx.billRun.updateMany({ where: { id: waiting.id, status: "waiting" }, data: { status: "skipped", reason: "skipped" } });
        return c.count === 1 ? ("ok" as const) : ("added" as const);
      });
      if (done === "move") return { ok: false, error: SKIP_LOCKED(bill.name) };
      if (done === "part") return { ok: false, error: SKIP_PART_LOCKED(bill.name) };
      if (done === "added") return { ok: false, error: `${bill.name} was just added, so it wasn’t skipped. You’ll find it in Activity.` };
    } else {
      // The first month from this one that the bill comes round in and isn't added yet
      // (a bill every 2 months skips its next real month).
      const comesIn = (p: string) => p >= bill.startMonth && monthsBetween(bill.startMonth, p) % Math.max(1, bill.every) === 0 && (!bill.endMonth || p <= bill.endMonth);
      let next: string | null = null;
      for (let i = 0, p = dayKey(now, bill.tz).slice(0, 7); i < 36 && !next; i++, p = addMonths(p, 1)) {
        if (comesIn(p) && !(await db.billRun.findUnique({ where: { billId_period: { billId, period: p } } }))) next = p;
      }
      if (!next) return { ok: false, error: "There’s no coming month to skip." };
      const period = next;
      const locked = await db.$transaction(async (tx) => {
        const kind = await charged(tx, period);
        if (kind) return kind;
        await tx.billRun.upsert({ where: { billId_period: { billId, period } }, create: { billId, period, status: "skipped", reason: "skipped" }, update: {} });
        return null;
      });
      if (locked) return { ok: false, error: locked === "part" ? SKIP_PART_LOCKED(bill.name) : SKIP_LOCKED(bill.name) };
    }
  } else if (command === "pause") {
    if (!bill.paused) {
      if (bill.nature === "daily") {
        const r = await changeDaily(bill, "pause", actorId, now, opts.expect ?? null);
        if (!r.ok) return r;
      } else await db.bill.update({ where: { id: billId }, data: { paused: true, pausedAt: now } });
    }
  } else if (command === "resume") {
    // What came round while it was paused isn't charged afterwards: a monthly
    // bill skips the months it fell due in; a daily one counts those days as not come.
    const today = dayKey(now, bill.tz);
    const from = bill.pausedAt ? dayKey(bill.pausedAt, bill.tz) : "";
    const thisMonth = today.slice(0, 7);
    const lastMonth = addMonths(thisMonth, -1);
    const pauseMonth = from.slice(0, 7);
    const finish = async (tx: Prisma.TransactionClient) => {
      let missed = (await tx.bill.findUnique({ where: { id: billId }, select: { missed: true } }))?.missed ?? bill.missed;
      if (bill.nature === "daily") {
        if (from) for (const p of [lastMonth, thisMonth]) missed = addMissed(missed, p, daysInRange(p, from, today));
        // The months from the pause month up to (not including) last month can never be added now: each is closed, so what was
        // added when the bill was paused stands as that month's bill and the price lock lifts.
        if (from) for (let p = pauseMonth, i = 0; p < lastMonth && i < 36; p = addMonths(p, 1), i++) {
          if (p < bill.startMonth) continue;
          await tx.billRun.upsert({ where: { billId_period: { billId, period: p } }, create: { billId, period: p, status: "skipped", reason: "paused" }, update: {} });
        }
      } else {
        for (const period of periodsDue({ ...bill, paused: false }, now)) {
          if (from && dueKey(period, bill.day >= 31 ? "last" : bill.day) < from) continue;
          await tx.billRun.upsert({ where: { billId_period: { billId, period } }, create: { billId, period, status: "skipped", reason: "paused" }, update: {} });
        }
      }
      await tx.bill.update({ where: { id: billId }, data: { paused: false, pausedAt: null, missed } });
    };
    // A daily bill paused before part charges existed: the days before the pause (in a month too old to be added now) are added first.
    const legacy = bill.nature === "daily" && from !== "" && pauseMonth < lastMonth && pauseMonth >= bill.startMonth && !(await db.billRun.findUnique({ where: { billId_period: { billId, period: pauseMonth } } }));
    if (legacy && !(parsePrepaid(bill.prepaid)[pauseMonth] ?? []).some((x) => x.k === "part")) {
      const r = await addMonthSoFar(bill, { id: bill.group.id, currency: bill.group.currency, closed: bill.group.closed, members: bill.group.members }, { period: pauseMonth, until: from, verb: "started again", actorId, now, expect: opts.expect ?? null, finish });
      if (!r.ok) return r;
    } else await db.$transaction(finish);
  } else if (command === "stop") {
    // Any month still waiting for its amount (or its payer) would be lost: it has to be dealt with first.
    const open = await db.billRun.findFirst({ where: { billId, status: "waiting" }, orderBy: { period: "asc" } });
    if (open) return { ok: false, error: `${bill.name} for ${monthLongName(open.period)} is still waiting for its amount. Enter it or skip it first, then stop the bill.` };
    if (bill.nature === "daily") {
      const r = await changeDaily(bill, "stop", actorId, now, opts.expect ?? null);
      if (!r.ok) return r;
    } else await db.bill.update({ where: { id: billId }, data: { deletedAt: new Date() } });
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
  // Compare and set: the new list is written only if the bill's list is still the one it was worked out from, and the
  // month still isn't added. If another tap got in first (a second phone, a double tap), read again and apply this
  // tap on top of theirs, so neither day is lost.
  let current = bill.missed;
  for (let tries = 0; tries < 6; tries++) {
    const done = await withRetry(() => db.$transaction(async (tx) => {
      // Only months not added yet can change.
      if (await tx.billRun.findUnique({ where: { billId_period: { billId, period } } })) return "added" as const;
      // The days up to a leaver's last day were charged to them when they moved out: those days can't change (read again here, in the write).
      const now = await tx.bill.findFirst({ where: { id: billId, groupId, deletedAt: null, nature: "daily" }, select: { name: true, prepaid: true } });
      if (!now) return "moved" as const;
      for (const x of parsePrepaid(now.prepaid)[period] ?? []) {
        if (x.d && day > Number(x.d.slice(8, 10))) continue;
        if (x.k === "part") {
          // (From the 1st, or the day after the part charge before this one.)
          const before = (parsePrepaid(now.prepaid)[period] ?? []).filter((y) => y.k === "part" && y.d && x.d && y.d < x.d).reduce((n, y) => Math.max(n, Number((y.d ?? "").slice(8, 10))), 0);
          return { locked: `${now.name} for ${dayRangeLabel(period, before + 1, Number((x.d ?? "").slice(8, 10)))} was already added when it was paused, so those days can’t change.` };
        }
        const who = (await tx.member.findUnique({ where: { id: x.m }, select: { name: true } }))?.name ?? "Someone";
        return { locked: x.d ? `${who}’s share of ${now.name} up to ${Number(x.d.slice(8, 10))} ${SHORT_MONTHS[Number(x.d.slice(5, 7)) - 1] ?? ""} was charged when they moved out, so those days can’t change.` : `${who}’s share of ${now.name} was charged when they moved out, so those days can’t change.` };
      }
      const set = await tx.bill.updateMany({ where: { id: billId, deletedAt: null, missed: current, prepaid: now.prepaid }, data: { missed: toggleMissed(current, period, day) } });
      return set.count === 1 ? ("saved" as const) : ("moved" as const);
    }));
    if (typeof done === "object") return { ok: false, error: done.locked };
    if (done === "added") return { ok: false, error: "That month has already been added." };
    if (done === "saved") return { ok: true, id: billId };
    const fresh = await db.bill.findFirst({ where: { id: billId, groupId, deletedAt: null, nature: "daily" }, select: { missed: true } });
    if (!fresh) return { ok: false, error: "That bill no longer exists." };
    current = fresh.missed;
  }
  return { ok: false, error: "That bill is changing right now. Try again in a moment." };
}

// Settings → "Reminders and settling up".
export async function saveSettleRulesFor(
  groupId: string,
  actorId: string,
  input: { reminders: boolean; settleDay: number; settleMin: string },
  opts?: { dryRun?: boolean; tx?: Db },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = opts?.tx ?? db;
  const group = await c.group.findUnique({ where: { id: groupId }, include: { members: true } });
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
  if (!changes.length || opts?.dryRun) return { ok: true };
  const write = async (tx: Db) => {
    await tx.group.update({ where: { id: groupId }, data: { reminders, settleDay: day, settleMin: min } });
    await logEvent(tx, { groupId, actorId, kind: "bill_changed", text: "changed how the group settles up", details: changes });
  };
  if (opts?.tx) await write(opts.tx);
  else await db.$transaction(write);
  return { ok: true };
}
