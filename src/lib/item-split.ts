// Split by item: each line on the bill goes to the people who had it, and
// whatever's left of the total (tax, service, tip) is shared in proportion to
// what each person had, like restaurants do. Works in whole minor units (paise,
// cents) and always adds up to the bill exactly. Pure.

// A bill can be split over at most this many item lines (the server keeps no more, so the form stops here too).
export const MAX_ITEM_LINES = 40;

export type BillItem = { name: string; amount: number; people: string[] };
export type ItemSplitResult =
  | { ok: true; amounts: Record<string, number>; itemsTotal: number; extra: number }
  | { ok: false; error: string };

// Shares `total` by whole weights, the leftover units going to the biggest remainders (ties: list order).
export function allocate(total: number, weights: { id: string; w: number }[]): Record<string, number> {
  const sum = weights.reduce((s, x) => s + x.w, 0);
  const out: Record<string, number> = {};
  if (!sum || !total) {
    for (const x of weights) out[x.id] = 0;
    return out;
  }
  const raw = weights.map((x, i) => ({ id: x.id, i, exact: (total * x.w) / sum }));
  let given = 0;
  for (const r of raw) {
    out[r.id] = Math.floor(r.exact);
    given += out[r.id];
  }
  const order = [...raw].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || a.i - b.i);
  for (let k = 0; k < total - given; k++) out[order[k % order.length].id]++;
  return out;
}

export function splitByItems(items: BillItem[], total: number): ItemSplitResult {
  const lines = items.filter((x) => x.amount > 0 || x.name.trim());
  if (!lines.length) return { ok: false, error: "Add the items on the bill." };
  for (const x of lines) {
    if (!(x.amount > 0)) return { ok: false, error: `Add a price for ${x.name.trim() || "each item"}.` };
    if (!x.people.length) return { ok: false, error: `Pick who had ${x.name.trim() || "each item"}.` };
  }
  const itemsTotal = lines.reduce((s, x) => s + x.amount, 0);
  if (!(total > 0)) return { ok: false, error: "Enter the bill’s total first." };
  if (itemsTotal > total) return { ok: false, error: "The items add up to more than the bill. Check the prices or the total." };

  const had: Record<string, number> = {};
  for (const x of lines) {
    const parts = allocate(x.amount, x.people.map((id) => ({ id, w: 1 })));
    for (const [id, a] of Object.entries(parts)) had[id] = (had[id] ?? 0) + a;
  }
  const extra = total - itemsTotal;
  const ids = Object.keys(had);
  const extraParts = allocate(extra, ids.map((id) => ({ id, w: had[id] })));
  const amounts = Object.fromEntries(ids.map((id) => [id, had[id] + (extraParts[id] ?? 0)]));
  return { ok: true, amounts, itemsTotal, extra };
}
