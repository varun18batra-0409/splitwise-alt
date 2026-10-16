import { allocateByWeights } from "../split";
import type { Transfer } from "../settle";
import { daysInMonth } from "./month";

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
export function depositRefunds(shares: Share[], deductions: number, weights: Record<string, number>): { memberId: string; refund: number }[] {
  const cut = deductions > 0 ? allocateByWeights(deductions, shares.map((s) => ({ memberId: s.memberId, weight: weights[s.memberId] ?? 100 }))) : [];
  return shares.map((s) => ({ memberId: s.memberId, refund: Math.max(0, s.amount - (cut.find((c) => c.memberId === s.memberId)?.amount ?? 0)) }));
}
