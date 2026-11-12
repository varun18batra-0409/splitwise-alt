import { decimalsOf } from "./money";

// "About" amounts are rounded to a whole unit of the currency: whole rupees, dollars, yen or dinars,
// whatever the currency's decimals are (0 for JPY, 2 for INR, 3 for KWD). Input and output are minor units.
export function roundToWhole(minor: number, currency: string): number {
  const unit = 10 ** decimalsOf(currency);
  return Math.round(minor / unit) * unit;
}
