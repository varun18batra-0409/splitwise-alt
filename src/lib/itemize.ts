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
