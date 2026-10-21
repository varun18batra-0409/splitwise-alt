import { isSupportedCurrency } from "./money";

// A sensible starting currency for a new group, from where the phone is.
// Uses the country Vercel detects, else the region in the phone's language
// setting (e.g. "en-GB" → GBP). People can always pick another.

const EURO = "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ");
const BY_COUNTRY: Record<string, string> = {
  IN: "INR", US: "USD", GB: "GBP", AE: "AED", SG: "SGD", AU: "AUD", CA: "CAD", NZ: "NZD", JP: "JPY", CN: "CNY",
  HK: "HKD", TH: "THB", MY: "MYR", ID: "IDR", PH: "PHP", VN: "VND", KR: "KRW", TW: "TWD", LK: "LKR", NP: "NPR",
  BD: "BDT", PK: "PKR", SA: "SAR", QA: "QAR", KW: "KWD", OM: "OMR", BH: "BHD", CH: "CHF", SE: "SEK", NO: "NOK",
  DK: "DKK", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", TR: "TRY", ZA: "ZAR", NG: "NGN", KE: "KES", EG: "EGP",
  BR: "BRL", MX: "MXN", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN", IL: "ILS", RU: "RUB", UA: "UAH", MV: "MVR",
};

export function currencyForCountry(country: string | null | undefined): string | null {
  const c = (country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  const code = EURO.includes(c) ? "EUR" : BY_COUNTRY[c];
  return code && isSupportedCurrency(code) ? code : null;
}

// "en-GB,en;q=0.9" → "GB"
export function countryFromLanguages(acceptLanguage: string | null | undefined): string | null {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const m = part.trim().match(/^[a-zA-Z]{2,3}[-_]([a-zA-Z]{2})\b/);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

export function defaultCurrency(h: { get(name: string): string | null }, fallback = "USD"): string {
  return (
    currencyForCountry(h.get("x-vercel-ip-country")) ??
    currencyForCountry(countryFromLanguages(h.get("accept-language"))) ??
    fallback
  );
}

// Where the visitor seems to be, for examples and seasonal ideas: their
// currency (dollars when unknown) and whether they're in India.
export function visitorRegion(h: { get(name: string): string | null }): { country: string | null; currency: string; india: boolean } {
  const country = (h.get("x-vercel-ip-country") ?? countryFromLanguages(h.get("accept-language")) ?? "").toUpperCase() || null;
  const currency = defaultCurrency(h, "USD");
  return { country, currency, india: country === "IN" || currency === "INR" };
}
