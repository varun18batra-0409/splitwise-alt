import { currencyInfo, formatMoney } from "./money";

// Money in a foreign currency, said the same way on a person's row and in the "Spent in other currencies" box. The sign
// is the ledger's: a positive amount is money owed TO that person in that currency, a negative one is money they owe.

// The sub-line under a person's balance when part of it comes from spending in another currency:
// "Thai baht part: you owe THB 5,099.17" (for someone else: "Thai baht part: owes THB 5,099.17").
// The currency code is always in the amount (never a bare number). It can be the opposite way to the person's overall
// balance (owed ₹17,618 overall, yet owing THB 5,099 in baht alone), which is why the direction is said here.
export function foreignPartLine(parts: { currency: string; amount: number }[], isMe = false, fmt: (minor: number, currency: string) => string = formatMoney): string {
  const list = parts
    .filter((p) => p.amount !== 0)
    .map((p) => {
      const owes = p.amount < 0;
      const verb = isMe ? (owes ? "you owe" : "you’re owed") : owes ? "owes" : "is owed";
      return `${currencyInfo(p.currency).name} part: ${verb} ${fmt(Math.abs(p.amount), p.currency)}`;
    });
  return list.join(" · ");
}

// The sentence in the "Spent in other currencies" box: "In THB alone, you owe THB 5,099.17. Overall you’re owed ₹17,618.19."
// `fmt` is for the screen only (overviewMoney drops the paise from 1,000 up); the default stays exact.
export function ledgerSummary(parts: { currency: string; amount: number }[], overall: number, groupCurrency: string, fmt: (minor: number, currency: string) => string = formatMoney): string {
  const alone = parts
    .filter((p) => p.amount !== 0)
    .map((p) => `In ${p.currency} alone, ${p.amount < 0 ? "you owe" : "you’re owed"} ${fmt(Math.abs(p.amount), p.currency)}.`);
  const all = overall === 0 ? "" : overall > 0 ? `Overall you’re owed ${fmt(overall, groupCurrency)}.` : `Overall you owe ${fmt(-overall, groupCurrency)}.`;
  return [...alone, all].filter(Boolean).join(" ");
}
