// The "big one" heads-up (instead of approvals): an expense far bigger than
// what this group usually spends gets a louder alert, so people take a look.
// Pure, so it can be tested. Needs some history first (5 expenses).
export function isBigExpense(amount: number, recent: number[]): boolean {
  const xs = recent.filter((n) => n > 0).sort((a, b) => a - b);
  if (xs.length < 5 || amount <= 0) return false;
  const mid = xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
  return amount >= mid * 5 && amount > xs[xs.length - 1];
}
