import { expenseDate } from "./dates";
import { moneyLines } from "./payers";

// "Why?" for a balance: every expense and payment that moved one person's
// balance, and by how much. The lines always add up to their balance.

type ExpenseLike = {
  id: string;
  description: string;
  category: string;
  amount: number;
  markupAmount: number;
  paidById: string;
  payers?: string | null;
  kind?: string | null;
  spentAt?: Date | null;
  createdAt: Date;
  shares: { memberId: string; amount: number }[];
};
type PaymentLike = { id: string; fromId: string; toId: string; amount: number; createdAt: Date };

export type WhyLine = {
  id: string;
  kind: "expense" | "payment";
  label: string; // "Dinner" / "Paid Asha" / "Asha paid them"
  category?: string;
  otherId?: string; // payments: the other person
  date: Date;
  paid: number; // what they paid (expense) — 0 if someone else paid
  share: number; // their share of it (expense)
  fee: number; // card fee inside their share
  effect: number; // + raises their balance (they get back), − lowers it
};

export type Why = {
  lines: WhyLine[];
  paidTotal: number; // paid for the group
  shareTotal: number; // their share of all expenses
  feeTotal: number; // card fees inside that share
  sent: number; // payments they made
  received: number; // payments made to them
  balance: number; // = paidTotal − shareTotal + sent − received
};

export function explainBalance(
  memberId: string,
  expenses: ExpenseLike[],
  payments: PaymentLike[],
  nameOf: (id: string) => string,
): Why {
  const lines: WhyLine[] = [];
  let paidTotal = 0, shareTotal = 0, feeTotal = 0, sent = 0, received = 0;

  for (const e of expenses) {
    // For money back the roles flip: "paid" is what they got back for others (negative effect).
    const { credits, debits } = moneyLines(e);
    const refund = e.kind === "refund";
    const paid = (refund ? debits : credits).find((p) => p.memberId === memberId)?.amount ?? 0;
    const share = (refund ? credits : debits).find((s) => s.memberId === memberId)?.amount ?? 0;
    if (!paid && !share) continue;
    // Their part of the card fee, in proportion to their share of the total.
    const fee = e.markupAmount > 0 && share > 0 && e.amount > 0 ? Math.round((e.markupAmount * share) / e.amount) : 0;
    const sign = refund ? -1 : 1;
    paidTotal += sign * paid;
    shareTotal += sign * share;
    feeTotal += sign * fee;
    lines.push({ id: e.id, kind: "expense", label: e.description, category: e.category, date: expenseDate(e), paid: sign * paid, share: sign * share, fee: sign * fee, effect: sign * (paid - share) });
  }
  for (const p of payments) {
    if (p.fromId === memberId) {
      sent += p.amount;
      lines.push({ id: p.id, kind: "payment", label: `Paid ${nameOf(p.toId)}`, otherId: p.toId, date: p.createdAt, paid: 0, share: 0, fee: 0, effect: p.amount });
    } else if (p.toId === memberId) {
      received += p.amount;
      lines.push({ id: p.id, kind: "payment", label: `${nameOf(p.fromId)} paid them`, otherId: p.fromId, date: p.createdAt, paid: 0, share: 0, fee: 0, effect: -p.amount });
    }
  }
  lines.sort((a, b) => b.date.getTime() - a.date.getTime());
  return { lines, paidTotal, shareTotal, feeTotal, sent, received, balance: paidTotal - shareTotal + sent - received };
}

// Everyone's totals in one pass (the Balances screen shows a "Why?" for every person, but only
// the one that is open needs its item-by-item list). The totals are exactly explainBalance's:
// same rules, same rounding, same "first line for that person" choice.
export type WhySummary = Omit<Why, "lines"> & { count: number }; // count = how many lines explainBalance would list

export function explainAll(memberIds: string[], expenses: ExpenseLike[], payments: PaymentLike[]): Record<string, WhySummary> {
  const out: Record<string, WhySummary> = {};
  for (const id of memberIds) out[id] = { paidTotal: 0, shareTotal: 0, feeTotal: 0, sent: 0, received: 0, balance: 0, count: 0 };

  for (const e of expenses) {
    const { credits, debits } = moneyLines(e);
    const refund = e.kind === "refund";
    const paidList = refund ? debits : credits;
    const shareList = refund ? credits : debits;
    // explainBalance uses .find(): if a person is listed twice, only the first entry counts.
    const paidBy = new Map<string, number>();
    for (const p of paidList) if (!paidBy.has(p.memberId)) paidBy.set(p.memberId, p.amount);
    const shareBy = new Map<string, number>();
    for (const s of shareList) if (!shareBy.has(s.memberId)) shareBy.set(s.memberId, s.amount);
    const sign = refund ? -1 : 1;
    for (const id of new Set([...paidBy.keys(), ...shareBy.keys()])) {
      const w = out[id];
      if (!w) continue;
      const paid = paidBy.get(id) ?? 0;
      const share = shareBy.get(id) ?? 0;
      if (!paid && !share) continue;
      const fee = e.markupAmount > 0 && share > 0 && e.amount > 0 ? Math.round((e.markupAmount * share) / e.amount) : 0;
      w.paidTotal += sign * paid;
      w.shareTotal += sign * share;
      w.feeTotal += sign * fee;
      w.count += 1;
    }
  }
  for (const p of payments) {
    const from = out[p.fromId];
    if (from) {
      from.sent += p.amount;
      from.count += 1;
    }
    // (explainBalance reads a payment to yourself as "sent" only.)
    const to = p.toId !== p.fromId ? out[p.toId] : undefined;
    if (to) {
      to.received += p.amount;
      to.count += 1;
    }
  }
  for (const id of memberIds) out[id].balance = out[id].paidTotal - out[id].shareTotal + out[id].sent - out[id].received;
  return out;
}
