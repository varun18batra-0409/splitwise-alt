import { moneyLines } from "./payers";
import { allocateByWeights } from "./split";
// Smart Settle: turns everyone's net balance into a short list of payments
// that clears every debt in the group.
//
// 1. Anyone who owes exactly what someone else is owed pays them directly.
// 2. Then the person who owes the most pays the person owed the most, repeatedly.
// This never needs more than (people − 1) payments, and usually far fewer than
// paying back each expense separately.

export type Transfer = { from: string; to: string; amount: number };

export function smartSettle(net: Record<string, number>): Transfer[] {
  const owes = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, left: -v }));
  const owed = Object.entries(net)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, left: v }));
  const transfers: Transfer[] = [];

  // Exact matches first: one payment clears two people.
  for (const d of owes) {
    const c = owed.find((x) => x.left > 0 && x.left === d.left);
    if (c) {
      transfers.push({ from: d.id, to: c.id, amount: d.left });
      c.left = 0;
      d.left = 0;
    }
  }

  // Then biggest debtor pays biggest creditor. Ties broken by id so the result is stable.
  const biggest = (list: { id: string; left: number }[]) =>
    list.filter((x) => x.left > 0).sort((a, b) => b.left - a.left || a.id.localeCompare(b.id))[0];
  for (;;) {
    const d = biggest(owes);
    const c = biggest(owed);
    if (!d || !c) break;
    const amount = Math.min(d.left, c.left);
    transfers.push({ from: d.id, to: c.id, amount });
    d.left -= amount;
    c.left -= amount;
  }
  return transfers;
}

// How many separate "X owes Y" debts there would be without Smart Settle:
// every expense makes each sharer owe the payer, netted per pair of people.
export function pairwiseDebtCount(
  expenses: { paidById: string; amount?: number; payers?: string | null; kind?: string | null; shares: { memberId: string; amount: number }[] }[],
  payments: { fromId: string; toId: string; amount: number }[] = [],
): number {
  const pair = new Map<string, number>(); // key "a|b" with a < b; positive = a owes b
  const add = (debtor: string, creditor: string, amount: number) => {
    if (debtor === creditor) return;
    const [a, b, sign]: [string, string, number] = debtor < creditor ? [debtor, creditor, 1] : [creditor, debtor, -1];
    const key = `${a}|${b}`;
    pair.set(key, (pair.get(key) ?? 0) + sign * amount);
  };
  for (const e of expenses) {
    // Each debit is owed to the credits in proportion (one payer: all to them).
    const { credits, debits } = moneyLines(e);
    for (const d of debits) {
      if (credits.length === 1) add(d.memberId, credits[0].memberId, d.amount);
      else for (const part of allocateByWeights(d.amount, credits.map((c) => ({ memberId: c.memberId, weight: c.amount })))) add(d.memberId, part.memberId, part.amount);
    }
  }
  for (const p of payments) add(p.toId, p.fromId, p.amount); // a payment reduces what `from` owes `to`
  return [...pair.values()].filter((v) => v !== 0).length;
}
