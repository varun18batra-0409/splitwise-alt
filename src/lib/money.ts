// All money is stored as whole numbers in the currency's smallest unit:
// paise for INR (₹12.50 = 1250), cents for USD/THB, whole yen for JPY, etc.

export type CurrencyInfo = { code: string; name: string; flag: string; decimals: number };

// Currencies people can enter expenses in.
export const CURRENCIES: CurrencyInfo[] = [
  { code: "INR", name: "Indian rupee", flag: "🇮🇳", decimals: 2 },
  { code: "THB", name: "Thai baht", flag: "🇹🇭", decimals: 2 },
  { code: "VND", name: "Vietnamese dong", flag: "🇻🇳", decimals: 0 },
  { code: "JPY", name: "Japanese yen", flag: "🇯🇵", decimals: 0 },
  { code: "USD", name: "US dollar", flag: "🇺🇸", decimals: 2 },
  { code: "EUR", name: "Euro", flag: "🇪🇺", decimals: 2 },
  { code: "SGD", name: "Singapore dollar", flag: "🇸🇬", decimals: 2 },
  { code: "IDR", name: "Indonesian rupiah", flag: "🇮🇩", decimals: 0 },
  { code: "MYR", name: "Malaysian ringgit", flag: "🇲🇾", decimals: 2 },
  { code: "GBP", name: "British pound", flag: "🇬🇧", decimals: 2 },
  { code: "AED", name: "UAE dirham", flag: "🇦🇪", decimals: 2 },
];

// Currencies a group can settle up in.
export const BASE_CURRENCIES = ["INR", "USD", "EUR", "GBP", "SGD"];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencyInfo(code: string): CurrencyInfo {
  return BY_CODE.get(code) ?? { code, name: code, flag: "💱", decimals: 2 };
}
export const isSupportedCurrency = (code: string) => BY_CODE.has(code);
export const decimalsOf = (code: string) => currencyInfo(code).decimals;

// The database stores whole numbers up to about 2.1 billion, so amounts are capped
// there (₹2 crore, or 2 billion dong). Plenty for shared expenses.
export const MAX_MINOR = 2_000_000_000;

// "1,250.5" / "₹ 99" / "3000" → smallest units. Null if it isn't a valid amount.
export function parseAmount(input: string, currency = "INR"): number | null {
  const d = decimalsOf(currency);
  const s = input.replace(/[₹,\s]/g, "");
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && !m[2])) return null;
  const frac = m[2] ?? "";
  if (frac.length > d) return null;
  const total = Number(m[1] || "0") * 10 ** d + Number(frac.padEnd(d, "0") || "0");
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_MINOR) return null;
  return total;
}

// "33.33" → 3333 "basis points" (hundredths of a percent). 100% = 10000.
export function parsePercent(input: string): number | null {
  const s = input.replace(/[%\s]/g, "");
  if (s === "") return 0;
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === "" && !m[2])) return null;
  const bp = Number(m[1] || "0") * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bp > 10000 ? null : bp;
}

// ₹ amounts the Indian way (₹1,23,456.50); other currencies with their code (THB 3,000).
export function formatMoney(minor: number, currency = "INR"): string {
  const d = decimalsOf(currency);
  const whole = minor % 10 ** d === 0;
  const opts = { minimumFractionDigits: whole ? 0 : d, maximumFractionDigits: d };
  if (currency === "INR") {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, ...opts }).format(minor / 10 ** d);
  }
  return `${currency} ${new Intl.NumberFormat("en-US", opts).format(minor / 10 ** d)}`;
}

export function formatPercent(bp: number): string {
  return `${Number((bp / 100).toFixed(2))}%`; // 300 → "3%", 350 → "3.5%", 3333 → "33.33%"
}
