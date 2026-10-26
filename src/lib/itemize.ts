import { allocateByWeights } from "./split";
import { parseAmount } from "./money";

// Split a bill by item: each item is shared by whoever had it; tax, service
// charge and tip are shared in proportion to what each person ordered (the
// fair way: someone who had 10% of the food pays 10% of the tax). Pure.

export type BillItem = { name: string; price: number; who: string[] }; // price in minor units
export type ItemizeResult = { perPerson: Record<string, number>; subtotal: number; extras: number; total: number };

// "18%" → 18% of the subtotal; "120" → that amount. Empty → 0. null if it isn't a number.
export function extraAmount(raw: string, subtotal: number, currency: string): number | null {
  const v = String(raw ?? "").trim();
  if (!v) return 0;
  const pct = v.match(/^(\d+(?:[.,]\d+)?)\s*%$/);
  if (pct) {
    const p = Number(pct[1].replace(",", "."));
    return p > 100 ? null : Math.round((subtotal * p) / 100);
  }
  if (/^0+([.,]0*)?$/.test(v)) return 0;
  return parseAmount(v, currency);
}

export function itemize(items: BillItem[], extras: number[]): ItemizeResult | null {
  const perPerson: Record<string, number> = {};
  let subtotal = 0;
  for (const it of items) {
    if (it.price <= 0) continue;
    const who = [...new Set(it.who)];
    if (!who.length) return null; // an item nobody had
    subtotal += it.price;
    for (const s of allocateByWeights(it.price, who.map((memberId) => ({ memberId, weight: 1 })))) perPerson[s.memberId] = (perPerson[s.memberId] ?? 0) + s.amount;
  }
  if (subtotal <= 0) return null;
  const extra = extras.reduce((s, x) => s + Math.max(0, x), 0);
  if (extra > 0) {
    const ids = Object.keys(perPerson).filter((id) => perPerson[id] > 0);
    for (const s of allocateByWeights(extra, ids.map((memberId) => ({ memberId, weight: perPerson[memberId] })))) perPerson[s.memberId] += s.amount;
  }
  return { perPerson, subtotal, extras: extra, total: subtotal + extra };
}

// The bill as a few lines for the expense's notes.
export function itemsNote(items: { name: string; priceText: string; whoText: string }[], extrasText: string[]): string {
  const lines = items.filter((i) => i.priceText).map((i) => `${i.name || "Item"} ${i.priceText} (${i.whoText})`);
  return [...lines, ...extrasText.filter(Boolean)].join("\n").slice(0, 500);
}

// "Paste the bill": text copied from a photo with the phone's own reader
// (Google Lens / iPhone Live Text) → items, plus tax, service charge and tip.
// Totals, payment lines and dates are skipped. Free, on the phone, no AI.
export type PastedBill = { items: { name: string; price: number }[]; tax: number; service: number; tip: number; skipped: number };

const SKIP = /\b(sub\s*-?\s*total|grand\s*total|total|net\s*(amount|amt|payable)|amount\s*payable|payable|balance|round(ed)?\s*off|rounding|cash|change|card|upi|paid|tender|bill\s*no|invoice|table|date|time|qty|quantity|items?\s*count|discount|savings|you\s*saved|thank|gstin|fssai|phone|tel|mobile|order\s*no|kot|cover|pax|server|cashier|steward)\b/i;
const TAX = /\b(c\s*gst|s\s*gst|i\s*gst|u\s*gst|gst|vat|tax|cess)\b/i;
const SERVICE = /\b(service\s*(charge|chg|fee)?|s\.?\s*c\.?)\b/i;
const TIP = /\b(tip|gratuity)\b/i;

export function parseBillText(text: string, currency: string): PastedBill {
  const out: PastedBill = { items: [], tax: 0, service: 0, tip: 0, skipped: 0 };
  for (const raw of String(text ?? "").split(/\r?\n/).slice(0, 120)) {
    const line = raw.replace(/[₹$£€¥]|\b(rs|inr|usd)\.?(?=\s|\d)/gi, " ").replace(/\/-/g, "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const m = line.match(/^(.*?)(\d[\d,]*(?:\.\d{1,2})?)\s*$/);
    if (!m) continue;
    const amount = parseAmount(m[2].replace(/,/g, ""), currency);
    if (amount === null || amount <= 0) continue;
    // The name: drop quantities and unit prices ("2 x Naan @ 60 120" → "Naan").
    const name = m[1]
      .replace(/^\s*\d+\s*(x|×|nos?\.?|pcs?)?\s+/i, "")
      .replace(/(\s+(x|×|@)?\s*\d[\d,]*(\.\d+)?)+\s*$/i, "")
      .replace(/[:\-–.@x×]+\s*$/i, "")
      .trim();
    if (TIP.test(name)) out.tip += amount;
    else if (SERVICE.test(name) && !/\bfood|dish/i.test(name)) out.service += amount;
    else if (TAX.test(name)) out.tax += amount;
    else if (SKIP.test(name) || !/\p{L}/u.test(name) || name.length < 2) out.skipped++;
    else out.items.push({ name: name.slice(0, 40), price: amount });
  }
  out.items = out.items.slice(0, 40);
  return out;
}
