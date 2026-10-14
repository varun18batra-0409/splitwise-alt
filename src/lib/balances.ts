// Net balance per person in the group's currency.
// Positive = others owe them; negative = they owe others.
//
// Each expense counts ONCE: the payer is credited the final total (including any
// card markup) and each responsible person is debited their share of that same total.

type ExpenseLike = { paidById: string; amount: number; shares: { memberId: string; amount: number }[] };
type PaymentLike = { fromId: string; toId: string; amount: number };

export function netBalances(
  memberIds: string[],
  expenses: ExpenseLike[],
  payments: PaymentLike[] = [],
): Record<string, number> {
  const net: Record<string, number> = Object.fromEntries(memberIds.map((id) => [id, 0]));
  for (const e of expenses) {
    net[e.paidById] = (net[e.paidById] ?? 0) + e.amount;
    for (const s of e.shares) net[s.memberId] = (net[s.memberId] ?? 0) - s.amount;
  }
  for (const p of payments) {
    net[p.fromId] = (net[p.fromId] ?? 0) + p.amount;
    net[p.toId] = (net[p.toId] ?? 0) - p.amount;
  }
  return net;
}
