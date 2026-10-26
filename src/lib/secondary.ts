// The group's "second currency": amounts are also shown in it (≈) next to the
// group currency. Usually the trip's local currency, e.g. INR group in Thailand → THB.
//
// Setting: "" = automatic (the foreign currency used most in the group's expenses),
// "none" = don't show, or a currency code chosen in group settings.

export function resolveSecondary(
  setting: string,
  groupCurrency: string,
  expenses: { originalCurrency: string }[],
): string | null {
  if (setting === "none") return null;
  if (setting && setting !== groupCurrency) return setting;
  const counts = new Map<string, number>();
  for (const e of expenses) {
    if (e.originalCurrency !== groupCurrency) counts.set(e.originalCurrency, (counts.get(e.originalCurrency) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

// Totals spent per original currency, with the group-currency equivalent that was actually used.
export function spentByCurrency(expenses: { originalCurrency: string; originalAmount: number; amount: number; kind?: string | null }[]) {
  const m = new Map<string, { original: number; group: number; count: number }>();
  for (const e of expenses) {
    if (e.kind === "pot") continue;
    const row = m.get(e.originalCurrency) ?? { original: 0, group: 0, count: 0 };
    const sign = e.kind === "refund" ? -1 : 1; // money back reduces what was spent
    row.original += sign * e.originalAmount;
    row.group += sign * e.amount;
    row.count += 1;
    m.set(e.originalCurrency, row);
  }
  return [...m].map(([currency, r]) => ({ currency, ...r })).sort((a, b) => b.group - a.group);
}
