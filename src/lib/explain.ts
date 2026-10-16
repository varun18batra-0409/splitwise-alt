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
