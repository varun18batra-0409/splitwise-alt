// Display-only. Amounts on overview screens drop the paise once they reach 1,000 whole units (₹17,618.19 → ₹17,618).
// Never used for a stored number, a calculation, an export, an email or anything sent to the server. Where an
// amount is shown this way, the exact figure goes in `title` and `data-exact` (screen readers hear the same rounded figure everyone sees; the group card and the expense itself carry the exact one).
import { homeMoney, recapShownDiff, roundedMinor } from "./home/display";
import { decimalsOf, formatMoney } from "./money";

export { homeMoney, recapShownDiff, roundedMinor };
export const overviewMoney = homeMoney;

// Group screens (balances, people, activity, group lists) show the EXACT amount, paise included, in the group's own
// currency: the same text Settle up shows. Only Home, charts and the recap round. Same as formatMoney, named for intent.
export function exactMoney(minor: number, currency = "INR"): string {
  return formatMoney(minor, currency);
}

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

// Largest-remainder sharing out of a whole number: `floors` each get their whole part, and the `extra` left over go to
// the biggest leftover fractions (ties: the bigger amount first, then list order).
function shareExtra(parts: number[], floors: number[], rems: number[], extra: number): number[] {
  const out = [...floors];
  const order = parts.map((_, i) => i).sort((a, b) => rems[b] - rems[a] || parts[b] - parts[a] || a - b);
  for (let k = 0; k < extra && k < order.length; k++) out[order[k]] += 1;
  return out;
}

// Display-only. Amounts (in minor units) shown as whole units so that the rows add up to the rounded total:
// ₹12,298 + ₹978 + ₹579 + ₹244 = ₹14,099. Each is rounded down, then the biggest leftover fractions are rounded up until
// the rows equal round(sum). Money back (a negative part) or a currency without decimals is returned unchanged.
export function roundPartsToTotal(parts: number[], currency = "INR"): number[] {
  const d = decimalsOf(currency);
  if (d === 0 || parts.some((p) => p < 0)) return [...parts];
  const unit = 10 ** d;
  const floors = parts.map((p) => Math.floor(p / unit));
  const rems = parts.map((p) => p % unit);
  const sum = parts.reduce((s, p) => s + p, 0);
  const target = Math.floor((sum + unit / 2) / unit);
  const extra = target - floors.reduce((s, f) => s + f, 0);
  return shareExtra(parts, floors, rems, extra).map((w) => w * unit);
}

// Display-only. Whole percentages that always add up to 100 (the same largest-remainder method).
// A total of 0 or less gives all zeros; any negative amount falls back to rounding each one.
export function percentsTo100(amounts: number[]): number[] {
  const total = amounts.reduce((s, a) => s + a, 0);
  if (total <= 0) return amounts.map(() => 0);
  if (amounts.some((a) => a < 0)) return amounts.map((a) => Math.round((a * 100) / total));
  const floors = amounts.map((a) => Math.floor((a * 100) / total));
  const rems = amounts.map((a) => (a * 100) % total);
  return shareExtra(amounts, floors, rems, 100 - floors.reduce((s, f) => s + f, 0));
}

// Display-only. For a list of amounts in one card: if any row has paise, every row keeps its two decimals
// (₹2,670.00 beside ₹30,723.44); otherwise they all show plain (₹2,500, ₹1,000).
export function listMoney(minors: number[], currency = "INR"): (minor: number) => string {
  const unit = 10 ** decimalsOf(currency);
  const anyPaise = minors.some((m) => m % unit !== 0);
  return (minor: number) => formatMoney(minor, currency, { keepDecimals: anyPaise });
}
