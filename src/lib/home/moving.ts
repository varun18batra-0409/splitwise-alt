import { allocateByWeights } from "../split";
import type { Transfer } from "../settle";
import { daysInMonth } from "./month";
import { countedMissed } from "./bills";

// Moving in and out of a flat, and the deposit (pure rules).

type Share = { memberId: string; amount: number };

// This month's bill re-split for someone who left part-way: they keep their
// share for the days they stayed; the rest goes to the others by weight.
// The expense's total never changes.
// `eligible` (when given): only these people can take the freed share, i.e. the ones still in the flat. Someone who moved out earlier
// keeps exactly the share they had (they left square, so their balance must not move). If nobody eligible shares the bill, it is left as it is.
export function proRataShares(shares: Share[], leaverId: string, daysStayed: number, monthDays: number, weights: Record<string, number>, eligible?: ReadonlySet<string>): Share[] {
  const theirs = shares.find((s) => s.memberId === leaverId)?.amount ?? 0;
  if (!theirs) return shares;
  const keep = Math.floor((theirs * Math.max(0, Math.min(daysStayed, monthDays))) / monthDays);
  const freed = theirs - keep;
  const others = shares.filter((s) => s.memberId !== leaverId && (!eligible || eligible.has(s.memberId)));
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
// Anyone who left earlier is already at 0 (the rule: a person who has left owes nothing and is owed nothing), so they never
// show up here. Hand-worked: Meera is owed 1000, Ravi owes 600, Asha owes 400 and is leaving: Asha pays Meera 400, everyone at 0.
export function leaverPayments(net: Record<string, number>, leaverId: string): Transfer[] {
  const mine = net[leaverId] ?? 0;
  if (mine === 0) return [];
  const sign = mine < 0 ? 1 : -1; // owe → pay the creditors; owed → paid by the debtors
  const others = Object.entries(net).filter(([id, v]) => id !== leaverId && v * sign > 0);
  if (!others.length) return [];
  const available = others.reduce((s, [, v]) => s + Math.abs(v), 0);
  return allocateByWeights(Math.min(Math.abs(mine), available), others.map(([id, v]) => ({ memberId: id, weight: Math.abs(v) }))).map((p) =>
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

export type DailyBillRule = { amount: number; missed: string; split: string; paused?: boolean; pausedAt?: Date | null; tz?: string };
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

// The helpers a daily bill's days are worked out with (shared by the move-out charge and the month-end split, so they can never disagree).
const dayOf = (period: string, d: number) => `${period}-${String(d).padStart(2, "0")}`;
// Was this person in the flat on this day ("2026-11-14")? From the day they moved in to their last day, both included.
function wasThere(m: { joinedFrom: Date | null; leftAt: Date | null }, day: string): boolean {
  const from = m.joinedFrom ? m.joinedFrom.toISOString().slice(0, 10) : "";
  const to = m.leftAt ? m.leftAt.toISOString().slice(0, 10) : "";
  return (!from || from <= day) && (!to || to >= day);
}
// Their weight on the bill: the flat's own split for "group", 100 each for "equal", the listed people for "some", their percentage for "percent".
function dailyWeight(split: SplitRule, m: { id: string; splitWeight: number }): number {
  return split.mode === "group" ? m.splitWeight : split.mode === "equal" ? 100 : split.mode === "some" ? (split.ids.includes(m.id) ? 100 : 0) : split.mode === "percent" ? (split.pct[m.id] ?? 0) : 0;
}

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
  const present = (m: DailyMember, d: number) => wasThere(m, dayOf(period, d));
  const missed = countedMissed(bill, period); // (the days a pause cuts off count as not come)
  const weightOf = (m: DailyMember) => dailyWeight(split, m);
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

// The month-end share of a daily bill, day by day (for a month where someone moved in, or someone moved out and paid their part at move-out).
// Each counted day (every day of the month, less the days it didn't come and the days a pause or stop cut off) is shared by the people who were
// there that day, by weight. A person's part is the sum of their daily fractions, kept exact as whole-number units (weight × L ÷ that day's total,
// L = the smallest number every day's total divides), then `amount` is shared by those units with the largest-remainder rule.
//  - Someone whose move-out charge is still on the bill (`live`, even if they were brought back by "Not received") was there only up to the last day
//    written on it, and takes no part of `amount`: their part is the charge. `amount` is the month's total less those charges.
//  - Someone who left with no charge isn't counted at all (the days are shared by the others, as always).
//  - Someone whose charge expense was deleted (`gone`) and who is back in the flat shares the month, but only for the days up to their last day.
// Returns null when the usual way applies: a percentage or fixed-amount split, nobody moved in or out with a charge this month, nobody with units,
// or numbers too big to keep exact.
export function dailyMonthShares(args: { bill: DailyBillRule; period: string; members: DailyMember[]; live: Prepaid[]; gone: Prepaid[]; amount: number }): Share[] | null {
  const { bill, period, members, live, gone, amount } = args;
  const split = parseSplitRule(bill.split);
  if ((split.mode !== "group" && split.mode !== "equal" && split.mode !== "some") || !Number.isSafeInteger(amount) || amount <= 0) return null;
  const sharing = members.filter((m) => dailyWeight(split, m) > 0);
  const movedIn = sharing.some((m) => !m.leftAt && m.joinedFrom !== null && m.joinedFrom.toISOString().slice(0, 7) === period);
  const hasEntry = sharing.some((m) => [...live, ...gone].some((e) => e.m === m.id));
  if (!movedIn && !hasEntry) return null;
  const lastDayOf = (list: Prepaid[], id: string) => list.filter((e) => e.m === id).map((e) => e.d ?? "").sort().pop() ?? "";
  // Who counts in each day's total (`there`: their dates), and who takes a part of the month-end bill (`takes`).
  const there: { m: DailyMember; weight: number; takes: boolean }[] = [];
  for (const m of sharing) {
    const charged = live.some((e) => e.m === m.id);
    if (charged) {
      // Their last day is on the charge; with none written, the day they left (or the whole month if they are back and it is missing).
      const d = lastDayOf(live, m.id) || (m.leftAt ? m.leftAt.toISOString().slice(0, 10) : "");
      there.push({ m: { ...m, leftAt: d ? new Date(`${d}T12:00:00Z`) : null }, weight: dailyWeight(split, m), takes: false });
    } else if (m.leftAt) {
      continue; // left with no charge: not counted
    } else {
      const d = lastDayOf(gone, m.id); // charge deleted after they came back: only the days up to their last day
      there.push({ m: { ...m, leftAt: d ? new Date(`${d}T12:00:00Z`) : null }, weight: dailyWeight(split, m), takes: true });
    }
  }
  const missed = countedMissed(bill, period);
  const days: bigint[] = [];
  const perDay: { total: bigint; who: typeof there }[] = [];
  for (let d = 1; d <= daysInMonth(period); d++) {
    if (missed.includes(d)) continue;
    const who = there.filter((x) => wasThere(x.m, dayOf(period, d)));
    const total = who.reduce((n, x) => n + BigInt(x.weight), 0n);
    if (total <= 0n) continue;
    days.push(total);
    perDay.push({ total, who });
  }
  if (!perDay.length) return null;
  let l = 1n;
  for (const t of new Set(days)) l = (l / gcd(l, t)) * t;
  const units = new Map<string, bigint>();
  for (const day of perDay) {
    for (const x of day.who) if (x.takes) units.set(x.m.id, (units.get(x.m.id) ?? 0n) + (BigInt(x.weight) * l) / day.total);
  }
  const rows = there.filter((x) => x.takes && (units.get(x.m.id) ?? 0n) > 0n).map((x) => ({ memberId: x.m.id, units: units.get(x.m.id)! }));
  const big = BigInt(Number.MAX_SAFE_INTEGER);
  if (!rows.length || l > big || rows.reduce((n, r) => n + r.units, 0n) > big) return null;
  const out = allocateByWeights(amount, rows.map((r) => ({ memberId: r.memberId, weight: Number(r.units) })));
  return out.length && out.reduce((n, s) => n + s.amount, 0) === amount ? out : null;
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
