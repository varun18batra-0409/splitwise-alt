// "More" on Add expense (notes, several payers, spin) is closed by default.
// When editing an expense that already uses it, it opens by itself so nothing is hidden.
export function shouldOpenMore(initial?: { notes?: string; multiPay?: boolean } | null): boolean {
  if (!initial) return false;
  return Boolean(initial.notes?.trim()) || Boolean(initial.multiPay);
}

// A save that fails because of the several-payers amounts ("The payers add up to …", "Pick who paid.") must show
// the fields to fix, and those sit under "More". Only when several payers is switched on.
export function errorNeedsMore(error: string, multiPay: boolean): boolean {
  return multiPay && /payers|who paid/i.test(error);
}

// The Faster entry buttons (Scan a bill, Speak, Type a line). Editing: the bill photo already has Replace / Remove,
// so the row is hidden when the expense has a photo, and is just "Bill photo" when it doesn't.
export function fasterEntryColumns(x: { billRun: boolean; quickOk: boolean; editing: boolean; hasPhoto: boolean }): number {
  if (x.editing && x.hasPhoto) return 0;
  const bill = x.billRun ? 0 : 1;
  const quick = x.quickOk ? 2 : 0;
  return bill + quick;
}
