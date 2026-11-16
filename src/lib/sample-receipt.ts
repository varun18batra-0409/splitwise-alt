import { decimalsOf, isSupportedCurrency } from "./money";

// The sample receipt on the start screen: the same dinner for 6 and boat tour, in the visitor's own money, with round
// amounts that feel normal there. Pictures only: nothing here is a rate anyone is charged.
// Dollars: dinner 30 each x 6 = 180, boat tour 240, total 420. Rupees keep their original 3,240 / 4,800 / 8,040.
const UNITS_PER_USD: Record<string, number> = {
  EUR: 0.9, GBP: 0.8, AUD: 1.5, CAD: 1.4, NZD: 1.7, SGD: 1.35, AED: 3.7, SAR: 3.75, QAR: 3.65, KWD: 0.31, OMR: 0.38, BHD: 0.38,
  JPY: 150, CNY: 7.2, HKD: 7.8, TWD: 32, KRW: 1350, THB: 35, MYR: 4.5, IDR: 16000, PHP: 57, VND: 25000, LKR: 300, NPR: 135,
  BDT: 120, PKR: 280, CHF: 0.9, SEK: 10.5, NOK: 10.5, DKK: 6.9, PLN: 4, CZK: 23, HUF: 360, RON: 4.6, TRY: 35, ZAR: 18,
  NGN: 1500, KES: 130, EGP: 50, BRL: 5.5, MXN: 18, ARS: 1000, CLP: 950, COP: 4000, PEN: 3.7, ILS: 3.7, RUB: 95, UAH: 41, MVR: 15.4,
};

// A friendly number: under 100, a multiple of 5 (at least 5); otherwise two significant figures (4,500; 360; 24,000).
export function niceAmount(v: number): number {
  if (!(v > 0)) return 5;
  if (v < 100) return Math.max(5, Math.round(v / 5) * 5);
  const mag = 10 ** (Math.floor(Math.log10(v)) - 1);
  return Math.round(v / mag) * mag;
}

// Whole units (not minor units) for the dinner (6 people), the boat tour and the total, in this currency.
export function sampleReceipt(currency: string): { currency: string; dinner: number; boat: number; total: number; each: number } {
  const code = (currency || "").toUpperCase();
  if (code === "INR") return { currency: "INR", each: 540, dinner: 3240, boat: 4800, total: 8040 };
  const c = isSupportedCurrency(code) ? code : "USD";
  const rate = UNITS_PER_USD[c] ?? 1;
  const each = niceAmount(30 * rate);
  const dinner = each * 6;
  const boat = niceAmount(240 * rate);
  return { currency: c, each, dinner, boat, total: dinner + boat };
}

// The three lines as minor units, ready for formatMoney.
export function sampleReceiptMinor(currency: string) {
  const r = sampleReceipt(currency);
  const k = 10 ** decimalsOf(r.currency);
  return { currency: r.currency, dinner: r.dinner * k, boat: r.boat * k, total: r.total * k };
}
