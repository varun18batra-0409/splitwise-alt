import { dayKey, DEFAULT_TIME_ZONE } from "../dates";
import { addMonths, daysInMonth, dueKey } from "./month";

// Recurring bills (pure rules, no database): which months are due, who pays,
// and what a daily bill comes to. A "period" is a month: "2026-10".

export type BillNature = "fixed" | "varies" | "daily";

// The tiles on "Add a regular bill".
export const BILL_TEMPLATES: { id: string; name: string; category: string; nature: BillNature; day: number; every?: number }[] = [
  { id: "rent", name: "Rent", category: "bills", nature: "fixed", day: 1 },
  { id: "society", name: "Society", category: "bills", nature: "fixed", day: 5 },
  { id: "electricity", name: "Electricity", category: "bills", nature: "varies", day: 5 },
  { id: "wifi", name: "Wi-Fi", category: "bills", nature: "fixed", day: 20 },
  { id: "help", name: "House help", category: "bills", nature: "fixed", day: 31 },
  { id: "cook", name: "Cook", category: "bills", nature: "fixed", day: 31 },
  { id: "milk", name: "Milk", category: "groceries", nature: "daily", day: 31 },
  { id: "water", name: "Water cans", category: "groceries", nature: "daily", day: 31 },
  { id: "groceries", name: "Groceries", category: "groceries", nature: "varies", day: 31 },
  { id: "gas", name: "Gas", category: "bills", nature: "varies", day: 1, every: 2 },
  { id: "streaming", name: "Streaming", category: "entertainment", nature: "fixed", day: 8 },
  { id: "mobile", name: "Mobile", category: "bills", nature: "fixed", day: 10 },
  { id: "other", name: "Other", category: "bills", nature: "fixed", day: 1 },
];

type DueRule = { day: number; every: number; startMonth: string; endMonth: string; paused: boolean; tz: string; nature: string };

// Months between two "2026-10" keys (b − a).
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

// Which periods are due now: this month and last month only (so a job that
// was down for a while catches up, but never adds old months), within the
// bill's start/end, every N months, and once the due day has come in the
// bill's time zone. A daily bill is due once its month is over.
export function periodsDue(b: DueRule, now: Date): string[] {
  if (b.paused) return [];
  const today = dayKey(now, b.tz || DEFAULT_TIME_ZONE);
  const thisMonth = today.slice(0, 7);
  const out: string[] = [];
  for (const p of [addMonths(thisMonth, -1), thisMonth]) {
    if (p < b.startMonth) continue;
    if (b.endMonth && p > b.endMonth) continue;
    if (monthsBetween(b.startMonth, p) % Math.max(1, b.every) !== 0) continue;
    if (b.nature === "daily" ? p >= thisMonth : dueKey(p, b.day >= 31 ? "last" : b.day) > today) continue;
    out.push(p);
  }
  return out;
}

// The next date this bill comes up on or after today ("2026-11-01"), or null.
export function nextDueDay(b: DueRule, now: Date): string | null {
  if (b.paused) return null;
  const today = dayKey(now, b.tz || DEFAULT_TIME_ZONE);
  let p = today.slice(0, 7) < b.startMonth ? b.startMonth : today.slice(0, 7);
  for (let i = 0; i < 36; i++, p = addMonths(p, 1)) {
    if (b.endMonth && p > b.endMonth) return null;
    if (monthsBetween(b.startMonth, p) % Math.max(1, b.every) !== 0) continue;
    const due = b.nature === "daily" ? dueKey(p, "last") : dueKey(p, b.day >= 31 ? "last" : b.day);
    if (due >= today) return due;
  }
  return null;
}

// Who pays this period: the set payer (null if they've left), or taking turns
// round the people still in the group.
export function payerFor(b: { payer: string; rotation: string; startMonth: string; every: number }, period: string, activeIds: string[]): string | null {
  if (b.payer) return activeIds.includes(b.payer) ? b.payer : null;
  let order: string[] = [];
  try {
    const v = JSON.parse(b.rotation);
    if (Array.isArray(v)) order = v.filter((x) => typeof x === "string");
  } catch {
    order = [];
  }
  if (!order.length) return null;
  const turn = Math.floor(monthsBetween(b.startMonth, period) / Math.max(1, b.every));
  for (let i = 0; i < order.length; i++) {
    const id = order[(((turn + i) % order.length) + order.length) % order.length];
    if (activeIds.includes(id)) return id;
  }
  return null;
}

// Days a daily bill didn't come, per month: {"2026-10": [4, 12]}.
export function missedDays(missed: string, period: string): number[] {
  try {
    const v = JSON.parse(missed);
    const list = v && Array.isArray(v[period]) ? v[period] : [];
    const last = daysInMonth(period);
    return [...new Set(list.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= last) as number[])].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

// A daily bill for a month: the rate × the days it came.
export function dailyTotal(b: { amount: number; missed: string }, period: string): { days: number; amount: number } {
  const days = daysInMonth(period) - missedDays(b.missed, period).length;
  return { days, amount: days * b.amount };
}

// Tap a day on the calendar: missed ⇄ came.
export function toggleMissed(missed: string, period: string, day: number): string {
  let v: Record<string, number[]> = {};
  try {
    const parsed = JSON.parse(missed);
    if (parsed && typeof parsed === "object") v = parsed;
  } catch {
    v = {};
  }
  const now = missedDays(missed, period);
  v[period] = now.includes(day) ? now.filter((d) => d !== day) : [...now, day].sort((a, b) => a - b);
  // Keep only the last few months.
  const keep = Object.keys(v).sort().slice(-3);
  return JSON.stringify(Object.fromEntries(keep.map((k) => [k, v[k]])));
}

// A daily bill set up part-way through a month: the days before it started,
// as "missed" ({"2026-10":[1,…,19]}), so it's charged only from the start.
export function daysBefore(period: string, today: string): string {
  if (today.slice(0, 7) !== period) return "{}";
  const n = Number(today.slice(8, 10)) - 1;
  return n > 0 ? JSON.stringify({ [period]: Array.from({ length: n }, (_, i) => i + 1) }) : "{}";
}

// The days of a month from one date up to (not including) another:
// ("2026-10", "2026-10-20", "2026-11-03") → 20…31.
export function daysInRange(period: string, from: string, until: string): number[] {
  const out: number[] = [];
  for (let d = 1; d <= daysInMonth(period); d++) {
    const key = `${period}-${String(d).padStart(2, "0")}`;
    if (key >= from && key < until) out.push(d);
  }
  return out;
}

// Add days to a daily bill's "didn't come" list for a month.
export function addMissed(missed: string, period: string, days: number[]): string {
  let out = missed;
  for (const d of days) if (!missedDays(out, period).includes(d)) out = toggleMissed(out, period, d);
  return out;
}

// The first month a new bill is added: this month if its day hasn't passed, else next month.
export function firstMonth(day: number, nature: string, now: Date, tz: string = DEFAULT_TIME_ZONE): string {
  const today = dayKey(now, tz);
  const m = today.slice(0, 7);
  if (nature === "daily") return m;
  return dueKey(m, day >= 31 ? "last" : day) >= today ? m : addMonths(m, 1);
}

export function ordinalDay(day: number): string {
  if (day >= 31) return "last day";
  const s = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${s}`;
}

// ---------- The state chip on each bill in the Bills tab ----------

// Why a bill that is due is waiting: for the amount only a "varies" bill needs, because nobody
// can pay it (the payer left), or because something is wrong with it (a split that can't work,
// a closed group) and it needs fixing in the bill's settings.
export function billHold(b: { nature: string; reason: string; payerId: string | null }): "amount" | "payer" | "fix" {
  if (b.reason === "payer left" || !b.payerId) return "payer";
  return b.nature === "varies" && b.reason === "" ? "amount" : "fix";
}

export type BillBadge = { id: "needs-amount" | "needs-fix" | "needs-payer" | "due-today" | "recorded" | "paused"; label: string; tone: "orange" | "gold" | "green" | "grey" };

// One word for where a bill is right now (nothing for a bill that's simply coming later):
//   Paused        – switched off
//   Needs amount  – a bill that changes is waiting for its payer to enter the amount (orange)
//   Needs a fix   – held for a problem (e.g. someone in its split has left); fix it in the bill's settings (orange)
//   Needs a payer – it is waiting and the person who pays has left (orange)
//   Recorded      – this month's is already added (green)
//   Due today     – it is due today and not added yet (gold)
export function billBadge(b: {
  nature: string;
  status: "waiting" | "added" | "upcoming" | "paused";
  due: string; // the next (or waiting) due date, "2026-11-01"
  payerId: string | null;
  reason: string;
  recordedThisMonth: boolean;
  tz: string;
  now: Date;
}): BillBadge | null {
  if (b.status === "paused") return { id: "paused", label: "Paused", tone: "grey" };
  if (b.status === "waiting") {
    const hold = billHold(b);
    return hold === "payer"
      ? { id: "needs-payer", label: "Needs a payer", tone: "orange" }
      : hold === "amount"
        ? { id: "needs-amount", label: "Needs amount", tone: "orange" }
        : { id: "needs-fix", label: "Needs a fix", tone: "orange" };
  }
  if (b.recordedThisMonth) return { id: "recorded", label: "Recorded", tone: "green" };
  if (b.due && b.due === dayKey(b.now, b.tz || DEFAULT_TIME_ZONE)) return { id: "due-today", label: "Due today", tone: "gold" };
  return null;
}
