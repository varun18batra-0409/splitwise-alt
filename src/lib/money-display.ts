// Display-only. Amounts on overview screens drop the paise once they reach 1,000 whole units (₹17,618.19 → ₹17,618).
// Never used for a stored number, a calculation, an export, an email or anything sent to the server. Where an
// amount is shown this way, the exact figure goes in `title` and `data-exact` (screen readers hear the same rounded figure everyone sees; the group card and the expense itself carry the exact one).
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

// Screen-only: in a sentence that already has rupee amounts written into it (an alert such as "Asha added Dinner ₹1,286.70"),
// show each amount of 1,000 or more without the paise. Text that is not a ₹ amount is left exactly as it is, and the caller keeps
// the original sentence in `title` / `data-exact`. Never use it on anything stored, sent or exported.
export function overviewAmountsInText(text: string): string {
  return text.replace(/₹(\d{1,3}(?:,\d{2,3})*|\d+)(?:\.(\d{1,2}))?/g, (whole, units: string, paise?: string) => {
    const minor = Number(units.replace(/,/g, "")) * 100 + (paise ? Number(paise.padEnd(2, "0")) : 0);
    return Number.isFinite(minor) ? overviewMoney(minor, "INR") : whole;
  });
}
