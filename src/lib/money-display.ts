// Display-only. Amounts on overview screens drop the paise once they reach 1,000 whole units (₹17,618.19 → ₹17,618).
// Never used for a stored number, a calculation, an export, an email or anything sent to the server. Where an
// amount is shown this way, the exact figure goes in `title`, `data-exact` and the spoken label (see `exactAttrs`).
import { homeMoney } from "./home/display";
import { formatMoney } from "./money";

export { homeMoney };
export const overviewMoney = homeMoney;

// The attributes that keep the exact amount beside a rounded one: a tooltip, a machine-readable value for tests,
// and (when the element has no label of its own) the screen-reader text.
export function exactAttrs(minor: number, currency = "INR"): { title: string; "data-exact": string } {
  const exact = formatMoney(minor, currency);
  return { title: exact, "data-exact": exact };
}

// Same, with the real minus sign (−) in front of a negative figure, the way chart labels write it.
export function signedOverview(minor: number, currency = "INR"): string {
  return minor < 0 ? `−${overviewMoney(-minor, currency)}` : overviewMoney(minor, currency);
}
