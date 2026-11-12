import { formatMoney, parseAmount } from "./money";

// The bill form's one-line preview of what each person pays, using the same rounding as the real split:
// the leftover smallest units go to the first people, so shares always add up to the bill.
// "₹33.34 for one, ₹33.33 for the others" (100 over 3); "₹50 each" when it divides evenly. Null when there is
// no valid amount or nobody to share with.
export function billEachText(amountInput: string, people: number, currency: string): string | null {
  const minor = parseAmount(amountInput, currency);
  if (minor === null || !Number.isInteger(people) || people < 1) return null;
  const base = Math.floor(minor / people);
  const extra = minor - base * people;
  if (extra === 0) return people === 1 ? null : `${formatMoney(base, currency)} each`;
  const high = extra === 1 ? "one" : String(extra);
  const rest = people - extra;
  return `${formatMoney(base + 1, currency)} for ${high}, ${formatMoney(base, currency)} for the ${rest === 1 ? "other" : "others"}`;
}

// The amount as shown in the sentence: properly formatted when it parses, otherwise what was typed.
export function billAmountText(amountInput: string, currency: string): string {
  const minor = parseAmount(amountInput, currency);
  return minor === null ? `${currency} ${amountInput}` : formatMoney(minor, currency);
}
