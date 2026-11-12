// A card game's result is money moving between players, not spending: the "Who paid" and
// "Each person's share" charts leave it out, the same way month totals do.
export function spendingOnly<T extends { kind: string }>(expenses: T[]): T[] {
  return expenses.filter((e) => e.kind !== "pot");
}
