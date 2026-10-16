import { allocateByWeights, type Share } from "./split";
import { moneyLines, scalePayers } from "./payers";

// Amounts in the currency an expense was actually paid in — WITHOUT any card
// markup. The markup is only the cost of converting to the group's currency,
// so it appears in the group-currency numbers, never in the foreign ones.
//
// Example: THB 3,000 dinner for 3, paid by card at ₹2.50 + 3% markup.
//   Group currency: total ₹7,725, shares ₹2,575 each (includes markup)
//   Thai baht:      total THB 3,000, shares THB 1,000 each (no markup)

type ExpenseLike = {
  amount: number; // final, group currency (incl. markup)
  originalAmount: number;
  originalCurrency: string;
  paidById: string;
  payers?: string | null;
  kind?: string | null;
  shares: { memberId: string; amount: number }[];
};

// Each person's share in the original currency. Same proportions as the
// group-currency shares, and always adds up exactly to the original amount.
export function originalShares(e: ExpenseLike): Share[] {
  if (e.originalAmount === e.amount) return e.shares.map((s) => ({ memberId: s.memberId, amount: s.amount }));
  return allocateByWeights(
    e.originalAmount,
    e.shares.filter((s) => s.amount > 0).map((s) => ({ memberId: s.memberId, weight: s.amount })),
  );
}

export type Ledger = {
  currency: string;
  spent: number; // total of expenses in this currency
  count: number;
  net: Record<string, number>; // + owed to them, − they owe (this currency, no markup)
};

// One balance sheet per foreign currency, from the expenses paid in it.
// (Settle-ups are recorded in the group currency, so they show there only.)
export function foreignLedgers(expenses: ExpenseLike[], groupCurrency: string, memberIds: string[]): Ledger[] {
  const ledgers = new Map<string, Ledger>();
  for (const e of expenses) {
    if (e.originalCurrency === groupCurrency) continue;
    const l = ledgers.get(e.originalCurrency) ?? {
      currency: e.originalCurrency,
      spent: 0,
      count: 0,
      net: Object.fromEntries(memberIds.map((id) => [id, 0])),
    };
    l.spent += e.kind === "refund" ? -e.originalAmount : e.originalAmount;
    l.count += 1;
    // The same lines as in the group currency, in the expense's own currency.
    const { credits, debits } = moneyLines(e);
    for (const c of scalePayers(credits, e.originalAmount)) l.net[c.memberId] = (l.net[c.memberId] ?? 0) + c.amount;
    for (const d of scalePayers(debits, e.originalAmount)) l.net[d.memberId] = (l.net[d.memberId] ?? 0) - d.amount;
    ledgers.set(e.originalCurrency, l);
  }
  return [...ledgers.values()].sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));
}
