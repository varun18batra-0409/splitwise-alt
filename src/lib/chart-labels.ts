import { decimalsOf, formatMoney } from "./money";

// Money labels for charts: always the real, signed number (never clamped to zero, never an absolute value).
const MINUS = "−"; // −

// −₹30 (a plain minus sign, so it reads the same everywhere).
export function signedMoney(minor: number, currency: string): string {
  return minor < 0 ? `${MINUS}${formatMoney(-minor, currency)}` : formatMoney(minor, currency);
}

// A chart row where money came back: "−₹30 back". Spending stays as it is.
export function backMoney(minor: number, money: (n: number) => string): string {
  return minor < 0 ? `${MINUS}${money(-minor)} back` : money(minor);
}

// A share of a total as "40%", or "—" when there is nothing sensible to divide by (no NaN%, no Infinity%).
export function percentText(part: number, total: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

// ₹30K, ₹1.2L, $4.5K for a chart's scale. Uses the currency's own decimals (KWD has 3, JPY has 0).
export function compactMoney(minor: number, currency: string): string {
  const v = minor / 10 ** decimalsOf(currency);
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(v);
  } catch {
    return `${currency} ${Math.round(v)}`;
  }
}

// How wide (or tall) a bar is, in percent: nothing at zero or below, never a sliver for real money.
export function barSize(value: number, max: number, min = 2): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(100, Math.max(min, (value / max) * 100));
}
