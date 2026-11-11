import { allocateByWeights } from "../split";
import type { Transfer } from "../settle";
import { daysInMonth } from "./month";
import { missedDays } from "./bills";

// Moving in and out of a flat, and the deposit (pure rules).

type Share = { memberId: string; amount: number };

// This month's bill re-split for someone who left part-way: they keep their
// share for the days they stayed; the rest goes to the others by weight.
// The expense's total never changes.
export function proRataShares(shares: Share[], leaverId: string, daysStayed: number, monthDays: number, weights: Record<string, number>): Share[] {
  const theirs = shares.find((s) => s.memberId === leaverId)?.amount ?? 0;
  if (!theirs) return shares;
  const keep = Math.floor((theirs * Math.max(0, Math.min(daysStayed, monthDays))) / monthDays);
  const freed = theirs - keep;
  const others = shares.filter((s) => s.memberId !== leaverId);
  if (!others.length || freed === 0) return shares;
  const extra = allocateByWeights(freed, others.map((s) => ({ memberId: s.memberId, weight: weights[s.memberId] ?? 100 })));
  return shares.map((s) =>
    s.memberId === leaverId ? { memberId: s.memberId, amount: keep } : { memberId: s.memberId, amount: s.amount + (extra.find((e) => e.memberId === s.memberId)?.amount ?? 0) },
  );
}

// Weights for a month's bills when someone moved in part-way: each person's
// weight × the days they're there (people there all month count every day).
export function joinWeights(members: { id: string; splitWeight: number; joinedFrom: Date | null }[], period: string): Record<string, number> {
  const days = daysInMonth(period);
  return Object.fromEntries(
    members.map((m) => {
      const from = m.joinedFrom ? m.joinedFrom.toISOString().slice(0, 10) : "";
      const present = from.slice(0, 7) === period ? days - Number(from.slice(8, 10)) + 1 : from.slice(0, 7) > period ? 0 : days;
      return [m.id, m.splitWeight * present];
    }),
  );
}

// The leaver squares up: if they owe, they pay those who are owed (in
// proportion); if they're owed, those who owe pay them.
export function leaverPayments(net: Record<string, number>, leaverId: string): Transfer[] {
  const mine = net[leaverId] ?? 0;
  if (mine === 0) return [];
  const sign = mine < 0 ? 1 : -1; // owe → pay the creditors; owed → paid by the debtors
  const others = Object.entries(net).filter(([id, v]) => id !== leaverId && v * sign > 0);
  if (!others.length) return [];
  return allocateByWeights(Math.abs(mine), others.map(([id, v]) => ({ memberId: id, weight: Math.abs(v) }))).map((p) =>
    mine < 0 ? { from: leaverId, to: p.memberId, amount: p.amount } : { from: p.memberId, to: leaverId, amount: p.amount },
  );
}

// The deposit coming back: deductions (painting, repairs) shared by weight;
// each person gets back what they put in, less their part (never below zero).
// If someone's part of the deductions is more than they put in, the rest is
// shared among the others, so the refunds always add up to exactly what came back.
export function depositRefunds(shares: Share[], deductions: number, weights: Record<string, number>): { memberId: string; refund: number }[] {
  const total = shares.reduce((x, s) => x + Math.max(0, s.amount), 0);
  let left = Math.min(Math.max(0, deductions), total);
  const cut = new Map<string, number>();
  let open = shares.filter((s) => s.amount > 0);
  while (left > 0 && open.length) {
    let entries = open.map((s) => ({ memberId: s.memberId, weight: weights[s.memberId] ?? 100 }));
    if (entries.every((e) => e.weight <= 0)) entries = open.map((s) => ({ memberId: s.memberId, weight: s.amount }));
    const parts = allocateByWeights(left, entries);
    left = 0;
    const next: Share[] = [];
    for (const s of open) {
      const room = s.amount - (cut.get(s.memberId) ?? 0);
      const want = parts.find((p) => p.memberId === s.memberId)?.amount ?? 0;
      const take = Math.min(room, want);
      cut.set(s.memberId, (cut.get(s.memberId) ?? 0) + take);
      left += want - take;
      if (room - take > 0) next.push(s);
    }
    open = next;
  }
  return shares.map((s) => ({ memberId: s.memberId, refund: Math.max(0, s.amount - (cut.get(s.memberId) ?? 0)) }));
}

// ---------- Daily bills (milk, water cans) when someone moves out ----------
//
// A daily bill is added once its month is over, and then only the people still in
// the flat share it. So someone who moves out on the 14th would never pay for the
// days they were there. Their share for those days is worked out now, and charged
// at move-out if they say so ("Add it now"). At month end the bill is added for
// the total less what they already paid, shared by the others.

export type DailyBillRule = { amount: number; missed: string; split: string };
export type DailyMember = { id: string; splitWeight: number; joinedFrom: Date | null; leftAt: Date | null };
export type DailyPrecharge = {
  days: number; // days they were there and the bill came
  missed: number[]; // days in their stay the bill didn't come
  amount: number; // their share, in minor units, rounded down once at the end
  unsupported: boolean; // fixed amounts per person: worked out by hand
};

type SplitRule = { mode: string; ids: string[]; pct: Record<string, number> };
function parseSplitRule(json: string): SplitRule {
  try {
    const v = JSON.parse(json);
    const pct: Record<string, number> = {};
    if (v?.pct && typeof v.pct === "object") for (const [k, n] of Object.entries(v.pct)) if (Number.isInteger(n) && (n as number) > 0) pct[k] = n as number;
    return {
      mode: ["equal", "some", "percent", "amounts"].includes(v?.mode) ? v.mode : "group",
      ids: Array.isArray(v?.ids) ? v.ids.filter((x: unknown): x is string => typeof x === "string") : [],
      pct,
    };
  } catch {
    return { mode: "group", ids: [], pct: {} };
  }
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

// The leaver's share of a daily bill for the days from the 1st (or when they moved in)
// to their last day, leaving out the days it didn't come:
//   Σ over those days of  rate × (their weight ÷ everyone's weight that day)
// Weights: the flat's own split for "group", 100 each for "equal", the listed people
// for "some". "percent": their percentage × days × rate. Rounded down once at the end,
// so a few paise stay with the month-end bill, never with the leaver.
export function dailyPrecharge(bill: DailyBillRule, period: string, lastDay: string, members: DailyMember[], leaverId: string): DailyPrecharge {
  const split = parseSplitRule(bill.split);
  if (split.mode === "amounts") return { days: 0, missed: [], amount: 0, unsupported: true };
  const leaver = members.find((m) => m.id === leaverId);
  const none = { days: 0, missed: [] as number[], amount: 0, unsupported: false };
  if (!leaver || lastDay.slice(0, 7) !== period || bill.amount <= 0) return none;
  const last = Number(lastDay.slice(8, 10));
  const key = (d: number) => `${period}-${String(d).padStart(2, "0")}`;
  const present = (m: DailyMember, d: number) => {
    const from = m.joinedFrom ? m.joinedFrom.toISOString().slice(0, 10) : "";
    const to = m.leftAt ? m.leftAt.toISOString().slice(0, 10) : "";
    return (!from || from <= key(d)) && (!to || to >= key(d));
  };
  const missed = missedDays(bill.missed, period);
  const weightOf = (m: DailyMember) =>
    split.mode === "group" ? m.splitWeight : split.mode === "equal" ? 100 : split.mode === "some" ? (split.ids.includes(m.id) ? 100 : 0) : split.mode === "percent" ? (split.pct[m.id] ?? 0) : 0;
  let days = 0;
  const stayed: number[] = [];
  const stayedMissed: number[] = [];
  for (let d = 1; d <= last; d++) {
    if (!present(leaver, d)) continue;
    (missed.includes(d) ? stayedMissed : stayed).push(d);
    if (!missed.includes(d)) days++;
  }
  const w = weightOf(leaver);
  if (!days || w <= 0) return { days, missed: stayedMissed, amount: 0, unsupported: false };
  if (split.mode === "percent") return { days, missed: stayedMissed, amount: Math.floor((w * days * bill.amount) / 10000), unsupported: false };
  // Sum the fractions exactly (days with the same people in the flat share one denominator), then round down once.
  const byTotal = new Map<number, number>();
  for (const d of stayed) {
    const total = members.filter((m) => present(m, d)).reduce((x, m) => x + weightOf(m), 0);
    if (total > 0) byTotal.set(total, (byTotal.get(total) ?? 0) + 1);
  }
  let num = 0n;
  let den = 1n;
  for (const [total, n] of byTotal) {
    num = num * BigInt(total) + BigInt(bill.amount) * BigInt(w) * BigInt(n) * den;
    den = den * BigInt(total);
    const g = gcd(num, den);
    if (g > 1n) {
      num /= g;
      den /= g;
    }
  }
  return { days, missed: stayedMissed, amount: Number(num / den), unsupported: false };
}

// What a daily bill has already had charged for a month at move-out: {"2026-11":[{m,a,e,d}]}
// (m = who, a = their share, e = the expense that charged it, d = their last day).
export type Prepaid = { m: string; a: number; e: string; d?: string };

export function parsePrepaid(json: string): Record<string, Prepaid[]> {
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== "object") return {};
    const out: Record<string, Prepaid[]> = {};
    for (const [period, list] of Object.entries(v as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      out[period] = list.filter((x): x is Prepaid => !!x && typeof x.m === "string" && Number.isInteger(x.a) && x.a > 0 && typeof x.e === "string");
    }
    return out;
  } catch {
    return {};
  }
}

export function addPrepaid(json: string, period: string, entry: Prepaid): string {
  const all = parsePrepaid(json);
  all[period] = [...(all[period] ?? []), entry];
  return JSON.stringify(all);
}

// Takes one expense's entries out again (undo of a move-out); empty months disappear.
export function removePrepaid(json: string, period: string, expenseId: string): string {
  const all = parsePrepaid(json);
  const rest = (all[period] ?? []).filter((x) => x.e !== expenseId);
  if (rest.length) all[period] = rest;
  else delete all[period];
  return JSON.stringify(all);
}
