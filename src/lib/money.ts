// All money is stored as whole numbers in the currency's smallest unit:
// paise for INR (₹12.50 = 1250), cents for USD/THB, whole yen for JPY, etc.

export type CurrencyInfo = { code: string; name: string; flag: string; decimals: number };

// Every active world currency (ISO 4217). Format: code, name, decimals (if not 2).
// IDR is kept at 0 decimals because rupiah are never split into cents in practice.
const TABLE: [string, string, number?][] = [
  ["AED", "UAE dirham"], ["AFN", "Afghan afghani"], ["ALL", "Albanian lek"], ["AMD", "Armenian dram"],
  ["ANG", "Netherlands Antillean guilder"], ["AOA", "Angolan kwanza"], ["ARS", "Argentine peso"],
  ["AUD", "Australian dollar"], ["AWG", "Aruban florin"], ["AZN", "Azerbaijani manat"],
  ["BAM", "Bosnia-Herzegovina mark"], ["BBD", "Barbadian dollar"], ["BDT", "Bangladeshi taka"],
  ["BGN", "Bulgarian lev"], ["BHD", "Bahraini dinar", 3], ["BIF", "Burundian franc", 0], ["BMD", "Bermudian dollar"],
  ["BND", "Brunei dollar"], ["BOB", "Bolivian boliviano"], ["BRL", "Brazilian real"], ["BSD", "Bahamian dollar"],
  ["BTN", "Bhutanese ngultrum"], ["BWP", "Botswana pula"], ["BYN", "Belarusian ruble"], ["BZD", "Belize dollar"],
  ["CAD", "Canadian dollar"], ["CDF", "Congolese franc"], ["CHF", "Swiss franc"], ["CLP", "Chilean peso", 0],
  ["CNY", "Chinese yuan"], ["COP", "Colombian peso"], ["CRC", "Costa Rican colón"], ["CUP", "Cuban peso"],
  ["CVE", "Cape Verdean escudo"], ["CZK", "Czech koruna"], ["DJF", "Djiboutian franc", 0], ["DKK", "Danish krone"],
  ["DOP", "Dominican peso"], ["DZD", "Algerian dinar"], ["EGP", "Egyptian pound"], ["ERN", "Eritrean nakfa"],
  ["ETB", "Ethiopian birr"], ["EUR", "Euro"], ["FJD", "Fijian dollar"], ["FKP", "Falkland Islands pound"],
  ["GBP", "British pound"], ["GEL", "Georgian lari"], ["GHS", "Ghanaian cedi"], ["GIP", "Gibraltar pound"],
  ["GMD", "Gambian dalasi"], ["GNF", "Guinean franc", 0], ["GTQ", "Guatemalan quetzal"], ["GYD", "Guyanese dollar"],
  ["HKD", "Hong Kong dollar"], ["HNL", "Honduran lempira"], ["HTG", "Haitian gourde"], ["HUF", "Hungarian forint"],
  ["IDR", "Indonesian rupiah", 0], ["ILS", "Israeli new shekel"], ["INR", "Indian rupee"], ["IQD", "Iraqi dinar", 3],
  ["IRR", "Iranian rial"], ["ISK", "Icelandic króna", 0], ["JMD", "Jamaican dollar"], ["JOD", "Jordanian dinar", 3],
  ["JPY", "Japanese yen", 0], ["KES", "Kenyan shilling"], ["KGS", "Kyrgyzstani som"], ["KHR", "Cambodian riel"],
  ["KMF", "Comorian franc", 0], ["KPW", "North Korean won"], ["KRW", "South Korean won", 0],
  ["KWD", "Kuwaiti dinar", 3], ["KYD", "Cayman Islands dollar"], ["KZT", "Kazakhstani tenge"], ["LAK", "Lao kip"],
  ["LBP", "Lebanese pound"], ["LKR", "Sri Lankan rupee"], ["LRD", "Liberian dollar"], ["LSL", "Lesotho loti"],
  ["LYD", "Libyan dinar", 3], ["MAD", "Moroccan dirham"], ["MDL", "Moldovan leu"], ["MGA", "Malagasy ariary"],
  ["MKD", "Macedonian denar"], ["MMK", "Myanmar kyat"], ["MNT", "Mongolian tögrög"], ["MOP", "Macanese pataca"],
  ["MRU", "Mauritanian ouguiya"], ["MUR", "Mauritian rupee"], ["MVR", "Maldivian rufiyaa"], ["MWK", "Malawian kwacha"],
  ["MXN", "Mexican peso"], ["MYR", "Malaysian ringgit"], ["MZN", "Mozambican metical"], ["NAD", "Namibian dollar"],
  ["NGN", "Nigerian naira"], ["NIO", "Nicaraguan córdoba"], ["NOK", "Norwegian krone"], ["NPR", "Nepalese rupee"],
  ["NZD", "New Zealand dollar"], ["OMR", "Omani rial", 3], ["PAB", "Panamanian balboa"], ["PEN", "Peruvian sol"],
  ["PGK", "Papua New Guinean kina"], ["PHP", "Philippine peso"], ["PKR", "Pakistani rupee"], ["PLN", "Polish złoty"],
  ["PYG", "Paraguayan guaraní", 0], ["QAR", "Qatari riyal"], ["RON", "Romanian leu"], ["RSD", "Serbian dinar"],
  ["RUB", "Russian ruble"], ["RWF", "Rwandan franc", 0], ["SAR", "Saudi riyal"], ["SBD", "Solomon Islands dollar"],
  ["SCR", "Seychellois rupee"], ["SDG", "Sudanese pound"], ["SEK", "Swedish krona"], ["SGD", "Singapore dollar"],
  ["SHP", "Saint Helena pound"], ["SLE", "Sierra Leonean leone"], ["SOS", "Somali shilling"],
  ["SRD", "Surinamese dollar"], ["SSP", "South Sudanese pound"], ["STN", "São Tomé and Príncipe dobra"],
  ["SYP", "Syrian pound"], ["SZL", "Eswatini lilangeni"], ["THB", "Thai baht"], ["TJS", "Tajikistani somoni"],
  ["TMT", "Turkmenistani manat"], ["TND", "Tunisian dinar", 3], ["TOP", "Tongan paʻanga"], ["TRY", "Turkish lira"],
  ["TTD", "Trinidad and Tobago dollar"], ["TWD", "New Taiwan dollar"], ["TZS", "Tanzanian shilling"],
  ["UAH", "Ukrainian hryvnia"], ["UGX", "Ugandan shilling", 0], ["USD", "US dollar"], ["UYU", "Uruguayan peso"],
  ["UZS", "Uzbekistani soʻm"], ["VES", "Venezuelan bolívar"], ["VND", "Vietnamese dong", 0],
  ["VUV", "Vanuatu vatu", 0], ["WST", "Samoan tālā"], ["XAF", "Central African CFA franc", 0],
  ["XCD", "East Caribbean dollar"], ["XCG", "Caribbean guilder"], ["XOF", "West African CFA franc", 0],
  ["XPF", "CFP franc", 0], ["YER", "Yemeni rial"], ["ZAR", "South African rand"], ["ZMW", "Zambian kwacha"],
  ["ZWG", "Zimbabwe gold"],
];

// Flag from the country part of the code (THB → 🇹🇭). Shared currencies get a globe.
const NO_COUNTRY = new Set(["ANG", "XAF", "XCD", "XCG", "XOF", "XPF"]);
export function flagOf(code: string): string {
  if (code === "EUR") return "🇪🇺";
  if (NO_COUNTRY.has(code) || !/^[A-Z]{3}$/.test(code)) return "🌍";
  return String.fromCodePoint(...[...code.slice(0, 2)].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

export const CURRENCIES: CurrencyInfo[] = TABLE.map(([code, name, decimals]) => ({
  code,
  name,
  flag: flagOf(code),
  decimals: decimals ?? 2,
}));

// Shown at the top of currency lists.
export const POPULAR_CURRENCIES = [
  "INR", "USD", "EUR", "GBP", "SGD", "THB", "VND", "JPY", "IDR", "MYR", "AED", "AUD", "CAD", "CHF", "CNY", "HKD",
  "KRW", "LKR", "NPR", "NZD", "PHP", "SAR", "QAR", "ZAR",
];

// Suggested group (settle-up) currencies, listed first in group settings. Any currency is allowed.
export const BASE_CURRENCIES = ["INR", "USD", "EUR", "GBP", "SGD"];

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function currencyInfo(code: string): CurrencyInfo {
  return BY_CODE.get(code) ?? { code, name: code, flag: "💱", decimals: 2 };
}
export const isSupportedCurrency = (code: string) => BY_CODE.has(code);
export const decimalsOf = (code: string) => currencyInfo(code).decimals;

// Search by code, name or country word: "baht", "thb", "dollar".
export function searchCurrencies(query: string): CurrencyInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return CURRENCIES;
  return CURRENCIES.filter((c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).sort(
    (a, b) => Number(b.code.toLowerCase() === q) - Number(a.code.toLowerCase() === q),
  );
}

// The database stores whole numbers up to about 2.1 billion, so amounts are capped
// there (₹2 crore, 2 billion dong, 2 million Kuwaiti dinar). Plenty for shared expenses.
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

// ₹ amounts the Indian way (₹1,23,456.50); dollars the US way ($123,456.50);
// other currencies with their code (THB 3,000).
export function formatMoney(minor: number, currency = "INR"): string {
  const d = decimalsOf(currency);
  const whole = minor % 10 ** d === 0;
  const opts = { minimumFractionDigits: whole ? 0 : d, maximumFractionDigits: d };
  if (currency === "INR") {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, ...opts }).format(minor / 10 ** d);
  }
  if (currency === "USD") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, ...opts }).format(minor / 10 ** d);
  }
  return `${currency} ${new Intl.NumberFormat("en-US", opts).format(minor / 10 ** d)}`;
}

export function formatPercent(bp: number): string {
  return `${Number((bp / 100).toFixed(2))}%`; // 300 → "3%", 350 → "3.5%", 3333 → "33.33%"
}

// Smallest units → what a person would type, e.g. 300000 THB → "3000", 9950 → "99.5".
export function toInputAmount(minor: number, currency = "INR"): string {
  const d = decimalsOf(currency);
  const s = (minor / 10 ** d).toFixed(d);
  return d > 0 ? s.replace(/\.?0+$/, "") : s;
}
