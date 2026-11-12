// The one line under the Recap search box that says what the numbers cover.
// "All 4 groups · amounts in ₹ (other currencies at the saved rate)", or "Goa trip · amounts in THB".
export function recapScope(o: { groupName?: string; groupCount: number; currency: string; symbol?: string; converted: boolean; skipped?: number }): string {
  const what = o.groupName ?? (o.groupCount === 1 ? "Your one group" : `All ${o.groupCount} groups`);
  const money = o.symbol ?? o.currency;
  const rest = o.converted ? ` · amounts in ${money}, others at the saved rate` : ` · amounts in ${money}`;
  const left = o.skipped && o.skipped > 0 ? ` · ${o.skipped} ${o.skipped === 1 ? "expense" : "expenses"} left out (no saved rate)` : "";
  return `${what}${rest}${left}`;
}
