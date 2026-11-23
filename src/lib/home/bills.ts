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

// The picture each bill tile shows (an emoji the line-icon drawing is picked from): the same on Bills, This month, Search and Add a bill.
export const BILL_EMOJI: Record<string, string> = { rent: "🏠", society: "🏢", electricity: "⚡", wifi: "📶", help: "🧹", cook: "🍳", milk: "🥛", water: "💧", groceries: "🛒", gas: "🔥", streaming: "📺", mobile: "📱" };

type DueRule = { day: number; every: number; startMonth: string; endMonth: string; paused: boolean; pausedAt?: Date | null; tz: string; nature: string };

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
// A paused daily bill still has the month it was paused in (the days before the pause are added with that month's bill, on the 1st);
// nothing later is due. A paused bill of any other kind, or one with no pause day, has nothing due.
export function periodsDue(b: DueRule, now: Date): string[] {
  if (b.paused && !(b.nature === "daily" && b.pausedAt)) return [];
  const today = dayKey(now, b.tz || DEFAULT_TIME_ZONE);
  const thisMonth = today.slice(0, 7);
  const pauseMonth = b.paused && b.pausedAt ? dayKey(b.pausedAt, b.tz || DEFAULT_TIME_ZONE).slice(0, 7) : "";
  const out: string[] = [];
  for (const p of [addMonths(thisMonth, -1), thisMonth]) {
    if (pauseMonth && p > pauseMonth) continue;
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

// The first due date strictly after a done month ("2026-11" → "2027-01" for a bill every 2 months from 2026-11), or null.
// The start month stays the anchor of the cycle (never moved to "the month after"), so every-other-month bills keep their own months.
export function nextDueAfter(b: DueRule, after: string): string | null {
  const every = Math.max(1, b.every);
  for (let i = 0, p = addMonths(after, 1); i < 36; i++, p = addMonths(p, 1)) {
    if (p < b.startMonth) continue;
    if (b.endMonth && p > b.endMonth) return null;
    if (monthsBetween(b.startMonth, p) % every !== 0) continue;
    return b.nature === "daily" ? dueKey(p, "last") : dueKey(p, b.day >= 31 ? "last" : b.day);
  }
  return null;
}

// The month "Enter amount" and Skip point at: the OLDEST month still waiting (not one waiting because it was deleted), otherwise the
// next coming month that has no row yet. One rule everywhere, so the Bills tab, "Enter amount" and Skip can never name different months.
export function skipTarget(b: DueRule, runs: { period: string; status: string; reason: string }[], now: Date): string | null {
  const open = runs.filter((r) => r.status === "waiting" && r.reason !== "deleted").map((r) => r.period).sort()[0];
  if (open) return open;
  const every = Math.max(1, b.every);
  for (let i = 0, p = dayKey(now, b.tz || DEFAULT_TIME_ZONE).slice(0, 7); i < 36; i++, p = addMonths(p, 1)) {
    if (b.endMonth && p > b.endMonth) return null;
    if (p >= b.startMonth && monthsBetween(b.startMonth, p) % every === 0 && !runs.some((r) => r.period === p)) return p;
  }
  return null;
}

// The period whose due date is exactly this calendar day ("2026-11" for day "2026-11-16"), or null. Worked out from
// the bill's rules alone, so it does not matter whether the daily job has already added that period (for someone
// behind India, "tomorrow" can already be India's today). Same rules as nextDueDay.
export function periodDueOn(b: DueRule, day: string): string | null {
  if (b.paused) return null;
  const p = day.slice(0, 7);
  if (p < b.startMonth || (b.endMonth && p > b.endMonth)) return null;
  if (monthsBetween(b.startMonth, p) % Math.max(1, b.every) !== 0) return null;
  const due = b.nature === "daily" ? dueKey(p, "last") : dueKey(p, b.day >= 31 ? "last" : b.day);
  return due === day ? p : null;
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

// The days of a month that a pause cuts off: from the day it was paused (in the bill's own time zone) to the month's end, and every day of a
// later month. Worked out from `pausedAt`, never written down, so Start again has nothing to un-mark (and days someone marked
// "didn't come" ahead of time stay marked).
export function pausedDays(b: { paused?: boolean; pausedAt?: Date | null; tz?: string; nature?: string }, period: string): number[] {
  if (!b.paused || !b.pausedAt || (b.nature && b.nature !== "daily")) return [];
  const from = dayKey(b.pausedAt, b.tz || DEFAULT_TIME_ZONE);
  const pauseMonth = from.slice(0, 7);
  if (period < pauseMonth) return [];
  const first = period === pauseMonth ? Number(from.slice(8, 10)) : 1;
  return Array.from({ length: daysInMonth(period) - first + 1 }, (_, i) => first + i);
}

// The days a daily bill didn't come, plus the days a pause cuts off.
export function countedMissed(b: { missed: string; paused?: boolean; pausedAt?: Date | null; tz?: string; nature?: string }, period: string): number[] {
  return [...new Set([...missedDays(b.missed, period), ...pausedDays(b, period)])].sort((x, y) => x - y);
}

// A daily bill for a month: the rate × the days it came (and, if it is paused, only the days before the pause).
export function dailyTotal(b: { amount: number; missed: string; paused?: boolean; pausedAt?: Date | null; tz?: string }, period: string): { days: number; amount: number } {
  const days = daysInMonth(period) - countedMissed(b, period).length;
  return { days, amount: days * b.amount };
}

// A stopped bill is a paused bill with an end month (the month it was stopped in). Live code never writes an end month, so a bill
// that is only paused (or one from before this) is never mistaken for a stopped one.
export function isStopped(b: { paused: boolean; endMonth: string }): boolean {
  return b.paused && b.endMonth !== "";
}

// A stopped bill is finished (and goes) once nothing of it is left to add: no month waiting or being added, and, for a daily bill,
// last month and this month (up to the end month) each have their run, or came to no days.
export function stopDone(
  b: { paused: boolean; endMonth: string; startMonth: string; every: number; nature: string; amount: number; missed: string; pausedAt?: Date | null; tz: string },
  runs: { period: string; status: string; reason: string }[],
  now: Date,
): boolean {
  if (!isStopped(b)) return false;
  if (runs.some((r) => r.status === "adding" || (r.status === "waiting" && r.reason !== "deleted"))) return false;
  if (b.nature === "daily" && b.pausedAt) { // (no pause day: no days to add)
    const thisMonth = dayKey(now, b.tz || DEFAULT_TIME_ZONE).slice(0, 7);
    for (const p of [addMonths(thisMonth, -1), thisMonth]) {
      if (p < b.startMonth || p > b.endMonth) continue;
      if (monthsBetween(b.startMonth, p) % Math.max(1, b.every) !== 0) continue;
      if (runs.some((r) => r.period === p)) continue;
      if (b.amount > 0 && dailyTotal(b, p).days > 0) return false;
    }
  }
  return true;
}

const SHORT_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// "1–19 Nov" (or "19 Nov" for one day).
export function dayRangeLabel(period: string, from: number, to: number): string {
  const mon = SHORT_MONTH_NAMES[Number(period.slice(5, 7)) - 1] ?? "";
  return from >= to ? `${to} ${mon}` : `${from}–${to} ${mon}`;
}

// The word on a bill coming up (Home's This month): "Next bill" only when it really is the next one coming.
export function nextBillLabel(s: { status: string; nature: string; reason: string; payerId: string | null }): string {
  if (s.status !== "waiting") return "Next bill";
  const hold = billHold(s);
  return hold === "payer" ? "Needs a payer" : hold === "amount" ? "Waiting for amount" : "Overdue";
}

// ---------- The words for pausing and stopping ----------
// A pause or stop adds nothing now. The days used so far (up to the day before) are added with the normal monthly bill on the 1st.
// `money` is the amount of the days so far, e.g. "₹1,140"; `less` the move-out charges already paid for them (name + amount text).
export type StopWords = {
  name: string;
  nature: string;
  month: string; // the month it is paused or stopped in, "2026-11"
  day: number; // the day it is paused or stopped on (that day is not counted)
  days: number; // days counted so far this month
  money: string; // those days at the daily price
  less: { who: string; money: string }[];
  lastMonth: { period: string; money: string } | null; // last month, if its bill is still to come
  waiting: { period: string; varies: boolean } | null; // a month still waiting to be added (not a daily one)
};
const longMonth = (period: string) => LONG_MONTH_NAMES[Number(period.slice(5, 7)) - 1] ?? period;
const firstOfNext = (period: string) => `1 ${SHORT_MONTH_NAMES[Number(addMonths(period, 1).slice(5, 7)) - 1] ?? ""}`;

// What "this adds on the 1st": "1–19 Nov (₹1,140, less ₹200 C already paid when they moved out)" – "" when no day was counted.
function soFar(w: StopWords): string {
  if (w.nature !== "daily" || w.days <= 0 || w.day <= 1) return "";
  const less = w.less.map((x) => `, less ${x.money} ${x.who} already paid when they moved out`).join("");
  return `${dayRangeLabel(w.month, 1, w.day - 1)} (${w.money}${less})`;
}

export function stopLines(w: StopWords): { stop: string; pause: string; stoppedNote: string; pausedNote: string } {
  const sofar = soFar(w);
  const last = w.lastMonth ? `${longMonth(w.lastMonth.period)} (${w.lastMonth.money}) is still added with the monthly bill.` : "";
  const day1 = firstOfNext(w.month);
  let stop: string;
  if (w.waiting) {
    stop = w.waiting.varies
      ? `Stop ${w.name}? ${longMonth(w.waiting.period)} is still waiting for its amount. It stays in Bills until you enter it or skip it. Nothing new is added after that.`
      : `Stop ${w.name}? ${longMonth(w.waiting.period)} is still waiting to be added. It stays in Bills until you add it or skip it. Nothing new is added after that.`;
  } else if (sofar || last) {
    stop = `Stop ${w.name}? ${sofar ? `${w.name} stops now. ${sofar} is added on ${day1} with the monthly bill. ` : ""}${last ? `${last} ` : ""}Expenses already added stay.`;
  } else {
    stop = `Stop ${w.name}? Expenses already added stay.`;
  }
  const pause = sofar || last
    ? `Pause ${w.name}? ${sofar ? `${sofar} is added on ${day1} with the monthly bill. ` : ""}${last ? `${last} ` : ""}Nothing more is added until you start it again.`
    : `Pause ${w.name}? Nothing more is added until you start it again.`;
  const from = `${w.day} ${SHORT_MONTH_NAMES[Number(w.month.slice(5, 7)) - 1] ?? ""}`;
  // (No days so far, but a month before the cut is still to come: say so, not "nothing more is added".)
  const lastLine = w.lastMonth ? `${longMonth(w.lastMonth.period)} (${w.lastMonth.money}) is added on ${firstOfNext(w.lastMonth.period)} with the monthly bill` : "";
  const stoppedNote = !sofar && lastLine
    ? `Stopped from ${from}. ${lastLine}, then ${w.name} ends.`
    : sofar
    ? `Stopped from ${from}. ${sofar} is added on ${day1} with the monthly bill, then ${w.name} ends.`
    : `Stopped from ${from}. Nothing more is added, then ${w.name} ends.`;
  const pausedNote = !sofar && lastLine
    ? `Paused from ${from}. ${lastLine}. Nothing more is added until you start it again.`
    : sofar
    ? `Paused from ${from}. ${sofar} is added on ${day1} with the monthly bill. Nothing more is added until you start it again.`
    : `Paused from ${from}. Nothing more is added until you start it again.`;
  return { stop, pause, stoppedNote, pausedNote };
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

// Why a bill that is due is waiting (`reason` is worked out fresh by billStatuses, "" = nothing is wrong now):
//   amount – a "varies" bill waits for its amount
//   payer  – nobody can pay it (the payer left)
//   fix    – something is wrong with it (a split that can't work, a closed group); fix it in the bill's settings
//   add    – a fixed or daily bill with nothing wrong any more (fixed since, or an add that was interrupted): just add it
export function billHold(b: { nature: string; reason: string; payerId: string | null }): "amount" | "payer" | "fix" | "add" {
  if (b.reason === "payer left" || !b.payerId) return "payer";
  if (b.reason === "") return b.nature === "varies" ? "amount" : "add";
  return "fix";
}

export type BillBadge = { id: "needs-amount" | "needs-add" | "needs-fix" | "needs-payer" | "due-today" | "recorded" | "paused"; label: string; tone: "orange" | "gold" | "green" | "grey" };

// One word for where a bill is right now (nothing for a bill that's simply coming later):
//   Paused        – switched off
//   Needs amount  – a bill that changes is waiting for its payer to enter the amount (orange)
//   Add it        – a fixed or daily bill is waiting and nothing is wrong with it now (orange)
//   Needs a fix   – held for a problem (e.g. someone in its split has left); fix it in the bill's settings (orange)
//   Needs a payer – it is waiting and the person who pays has left (orange)
//   Added this month – this month's is already added (green)
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
  ended?: boolean; // stopped (paused with an end month): the same grey chip, another word
}): BillBadge | null {
  if (b.status === "paused") return { id: "paused", label: b.ended ? "Stopped" : "Paused", tone: "grey" };
  if (b.status === "waiting") {
    const hold = billHold(b);
    return hold === "payer"
      ? { id: "needs-payer", label: "Needs a payer", tone: "orange" }
      : hold === "amount"
        ? { id: "needs-amount", label: "Needs amount", tone: "orange" }
        : hold === "add"
          ? { id: "needs-add", label: "Add it", tone: "orange" }
          : { id: "needs-fix", label: "Needs a fix", tone: "orange" };
  }
  if (b.recordedThisMonth) return { id: "recorded", label: "Added this month", tone: "green" };
  if (b.due && b.due === dayKey(b.now, b.tz || DEFAULT_TIME_ZONE)) return { id: "due-today", label: "Due today", tone: "gold" };
  return null;
}
