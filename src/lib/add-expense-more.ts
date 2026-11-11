// "More" on Add expense (notes, several payers, spin) is closed by default.
// When editing an expense that already uses it, it opens by itself so nothing is hidden.
export function shouldOpenMore(initial?: { notes?: string; multiPay?: boolean } | null): boolean {
  if (!initial) return false;
  return Boolean(initial.notes?.trim()) || Boolean(initial.multiPay);
}
