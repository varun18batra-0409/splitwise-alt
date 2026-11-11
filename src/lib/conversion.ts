import { amountError, decimalsOf, formatMoney, formatPercent, MAX_MINOR, parseAmount } from "./money";

// Currency conversion and card markup, done with exact whole-number maths
// (BigInt) so there are no floating-point rounding surprises.
//
//   Converted amount = Original amount × Exchange rate
//   Card markup      = Converted amount × Markup % / 100
//   Total expense    = Converted amount + Card markup
//
// The total is what gets split between people. The markup is never added twice.

export type PaymentMethod = "card" | "cash" | "bank";
export const PAYMENT_METHODS: { id: PaymentMethod; label: string }[] = [
  { id: "card", label: "Card" },
  { id: "cash", label: "Cash" },
  { id: "bank", label: "Bank / UPI" },
];

const MAX_RATE_DECIMALS = 12;

// A typed rate as plain digits and a dot: "16,000" → "16000", "2.84" stays.
// One comma with other than three digits after it (or "0,…") is a decimal
// comma, as some phone keyboards type it: "2,84" → "2.84", "0,012" → "0.012".
export function cleanRateText(input: string): string {
  const t = String(input ?? "").replace(/\s/g, "");
  const m = /^(\d+),(\d+)$/.exec(t);
  if (m && (m[2].length !== 3 || /^0+$/.test(m[1]))) return `${m[1]}.${m[2]}`;
  return t.replace(/,/g, "");
}

// "2.8367" → { n: 28367n, scale: 10000n }. Null if not a positive number.
export function parseRate(input: string): { n: bigint; scale: bigint } | null {
  const s = cleanRateText(input);
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && !m[2])) return null;
  const frac = (m[2] ?? "").slice(0, MAX_RATE_DECIMALS);
  if ((m[2] ?? "").length > MAX_RATE_DECIMALS && /[1-9]/.test((m[2] ?? "").slice(MAX_RATE_DECIMALS))) return null;
  const n = BigInt((m[1] || "0") + frac);
  if (n <= 0n) return null;
  if (BigInt(m[1] || "0") > 1_000_000n) return null; // no real rate is this large
  return { n, scale: 10n ** BigInt(frac.length) };
}

// Turns a rate from the API (a JavaScript number) into exact text, e.g. 2.8367 → "2.8367".
export function rateToString(rate: number): string {
  const s = Number(rate.toPrecision(10)).toFixed(MAX_RATE_DECIMALS);
  return s.replace(/\.?0+$/, "");
}

// Rounds num/den to the nearest whole number (halves round up). Both positive.
function divRound(num: bigint, den: bigint): bigint {
  return (num * 2n + den) / (2n * den);
}

export function convertAmount(originalMinor: number, from: string, to: string, rate: string): number | null {
  if (from === to) return originalMinor;
  const r = parseRate(rate);
  if (!r) return null;
  const num = BigInt(originalMinor) * r.n * 10n ** BigInt(decimalsOf(to));
  const den = 10n ** BigInt(decimalsOf(from)) * r.scale;
  const out = Number(divRound(num, den));
  return Number.isSafeInteger(out) ? out : null;
}

export function markupAmountOf(convertedMinor: number, markupBp: number): number {
  if (markupBp <= 0) return 0;
  return Number(divRound(BigInt(convertedMinor) * BigInt(markupBp), 10000n));
}

// Markup only applies to a card payment made in a currency other than the group's.
export function markupApplies(originalCurrency: string, baseCurrency: string, method: PaymentMethod | ""): boolean {
  return method === "card" && originalCurrency !== baseCurrency;
}

export type Totals =
  | {
      ok: true;
      originalAmount: number;
      convertedAmount: number;
      markupBp: number;
      markupAmount: number;
      total: number;
      exchangeRate: string;
    }
  | { ok: false; error: string; originalAmount: number | null };

export function computeTotals(args: {
  amount: string; // as typed, in the expense's currency
  currency: string;
  baseCurrency: string;
  rate: string; // base currency per 1 unit of `currency`; ignored when they match
  paymentMethod: PaymentMethod | "";
  markupBp: number; // the markup chosen (group default or override)
}): Totals {
  const originalAmount = parseAmount(args.amount, args.currency);
  if (originalAmount === null) return { ok: false, error: amountError(args.amount, args.currency), originalAmount };

  const same = args.currency === args.baseCurrency;
  if (!same && !parseRate(args.rate)) {
    return { ok: false, error: "Enter the exchange rate to convert this amount.", originalAmount };
  }
  const exchangeRate = same ? "1" : cleanRateText(args.rate);
  const convertedAmount = convertAmount(originalAmount, args.currency, args.baseCurrency, exchangeRate);
  if (convertedAmount === null || convertedAmount <= 0) {
    return { ok: false, error: "That amount is too small to convert. Check the rate.", originalAmount };
  }

  const markupBp = markupApplies(args.currency, args.baseCurrency, args.paymentMethod)
    ? Math.max(0, Math.min(args.markupBp, 2000))
    : 0;
  const markupAmount = markupAmountOf(convertedAmount, markupBp);
  const total = convertedAmount + markupAmount;
  if (total > MAX_MINOR) return { ok: false, error: "That amount is too large.", originalAmount };

  return { ok: true, originalAmount, convertedAmount, markupBp, markupAmount, total, exchangeRate };
}

// The maths behind a foreign-currency expense, in one line:
//   "THB 1,000 × 2.50 = ₹2,500 + ₹75 card fee (3%) = ₹2,575"
// The rate is shown exactly as saved ("2.5" if that's what was saved; "2.50" only if it was). It is only
// shown when recalculating from the saved pieces gives exactly the saved total; otherwise null, so a line
// that doesn't add up is never shown.
export function fxLine(e: {
  originalAmount: number;
  originalCurrency: string;
  baseCurrency: string;
  exchangeRate: string;
  convertedAmount: number;
  markupBp: number;
  markupAmount: number;
  amount: number;
  paymentMethod?: string;
}): string | null {
  if (e.originalCurrency === e.baseCurrency) return null;
  const converted = convertAmount(e.originalAmount, e.originalCurrency, e.baseCurrency, e.exchangeRate);
  if (converted === null || converted !== e.convertedAmount) return null;
  const fee = markupAmountOf(converted, e.markupBp);
  if (fee !== e.markupAmount || converted + fee !== e.amount) return null;
  const rate = cleanRateText(e.exchangeRate);
  // The converted amount is shown in the middle, so each step can be checked by hand:
  // "$1 × 83.12345 = ₹83.12 + ₹2.49 card fee (3%) = ₹85.61".
  const head = `${formatMoney(e.originalAmount, e.originalCurrency)} × ${rate} = ${formatMoney(converted, e.baseCurrency)}`;
  return e.markupBp > 0 && fee > 0 ? `${head} + ${formatMoney(fee, e.baseCurrency)} card fee (${formatPercent(e.markupBp)}) = ${formatMoney(e.amount, e.baseCurrency)}` : head;
}

// Where the rate came from, for the line under the maths. `rateDate` is the day the rate applies to ("2026-10-14").
export function rateSourceLine(e: { rateSource: string; rateDate: string }, niceDate: (day: string) => string): string | null {
  if (e.rateSource === "api") return e.rateDate ? `Live rate for ${niceDate(e.rateDate)}` : "Live rate";
  if (e.rateSource === "manual") return "Rate entered by hand";
  if (e.rateSource === "converted") return "Adjusted when the group currency changed";
  return null;
}
