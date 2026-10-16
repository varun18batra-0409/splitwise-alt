import { convertAmount, markupAmountOf, parseRate } from "./conversion";
import { allocateByWeights } from "./split";
import { parsePayers, payersJson } from "./payers";

// Changing a group's currency after expenses exist: every amount is converted
// at one rate (old group currency → new), keeping each expense's ORIGINAL
// amount untouched and every set of shares adding up exactly.

const MAX_DECIMALS = 12;

// "2.8367" × "0.012" = "0.0340404" (exact, rounded to 12 decimals).
export function multiplyRates(a: string, b: string): string | null {
  const x = parseRate(a);
  const y = parseRate(b);
  if (!x || !y) return null;
  const num = x.n * y.n;
  const den = x.scale * y.scale;
  const scale = 10n ** BigInt(MAX_DECIMALS);
  const scaled = (num * scale * 2n + den) / (2n * den); // rounded
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(MAX_DECIMALS, "0").replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : `${whole}`;
  return parseRate(out) ? out : null;
}

type ExpenseIn = {
  originalAmount: number;
  originalCurrency: string;
  exchangeRate: string;
  markupBp: number;
  markupAmount: number;
  payers?: string | null;
  shares: { id: string; memberId: string; amount: number }[];
};

export type RebasedExpense = {
  baseCurrency: string;
  exchangeRate: string;
  rateSource: string;
  convertedAmount: number;
  markupAmount: number;
  amount: number;
  payers: string; // "" for a single payer
  shares: { id: string; amount: number }[];
};

export function rebaseExpense(e: ExpenseIn, oldBase: string, newBase: string, rate: string): RebasedExpense | null {
  let exchangeRate: string;
  let convertedAmount: number;
  let markupAmount: number;

  if (e.originalCurrency === newBase) {
    // Now in the group's own currency: no conversion; any card fee already paid is kept (converted).
    exchangeRate = "1";
    convertedAmount = e.originalAmount;
    const m = convertAmount(e.markupAmount, oldBase, newBase, rate);
    if (m === null) return null;
    markupAmount = m;
  } else {
    const r = e.originalCurrency === oldBase ? rate : multiplyRates(e.exchangeRate, rate);
    if (!r) return null;
    exchangeRate = r;
    const c = convertAmount(e.originalAmount, e.originalCurrency, newBase, r);
    if (c === null || c <= 0) return null;
    convertedAmount = c;
    markupAmount = markupAmountOf(c, e.markupBp);
  }

  const amount = convertedAmount + markupAmount;
  const weights = e.shares.map((s) => ({ memberId: s.id, weight: s.amount }));
  const allocated = allocateByWeights(amount, weights);
  // Keep every share row (some may round to 0 for tiny shares).
  const shares = e.shares.map((s) => ({ id: s.id, amount: allocated.find((a) => a.memberId === s.id)?.amount ?? 0 }));
  // Several payers: their parts are converted the same way, so they still add up to the total.
  const list = parsePayers(e.payers);
  const payers = list.length ? payersJson(allocateByWeights(amount, list.map((p) => ({ memberId: p.memberId, weight: p.amount })))) : "";
  return { baseCurrency: newBase, exchangeRate, rateSource: "converted", convertedAmount, markupAmount, amount, payers, shares };
}

export function rebasePayment(amount: number, oldBase: string, newBase: string, rate: string): number | null {
  return convertAmount(amount, oldBase, newBase, rate);
}
