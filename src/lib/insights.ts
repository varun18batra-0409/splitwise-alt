import { bucketOf, bucketsEnding, type Grain } from "./search";
import { payersOf } from "./payers";

// Insights (the chart on top of Search), worked out in one place so it can be
// checked: for each week / month / year, either YOUR SHARE of every expense
// (what Home's "your month" card shows) or the GROUP SPEND (each expense's
// whole amount, once). Money back counts as minus. Deleted expenses are never
// passed in. Amounts in other currencies are converted with `toChart` (the
// saved rate); ones that can't be converted are left out and `skipped` counts them.

type Expense = {
  id: string;
  amount: number; // in the group's currency (after any card fee)
  kind?: string | null; // "refund" = money back
  category: string;
  spentAt: Date | null;
  createdAt: Date;
  shares: { memberId: string; amount: number }[];
  paidById?: string;
  payers?: string | null;
};
export type InsightGroup = { currency: string; myId: string; expenses: Expense[] };

export type InsightsResult = {
  bars: { key: string; value: number }[]; // oldest first
  selected: string; // the bar being looked at
  categories: { id: string; amount: number }[]; // for the selected bar, biggest first (positive only)
  converted: boolean; // something was converted from another currency
  skipped: number; // expenses left out (no saved rate for their currency)
  // For the selected bar, from expenses only (settle-up payments not included):
  // your share of the costs, what you paid, and the difference (+ others owe you, − you owe).
  me: { share: number; paid: number; net: number };
};

export function computeInsights(
  groups: InsightGroup[],
  opts: {
    view: "share" | "spent";
    grain: Grain;
    selected?: string; // a bar key the person tapped ("2026-10", "2026", a week's Monday)
    now: Date;
    tz: string;
    currency: string; // the chart's currency
    toChart: (amount: number, currency: string) => number | null; // positive amounts only
    include?: (expenseId: string) => boolean; // words typed in Search
  },
): InsightsResult {
  const sums = new Map<string, number>();
  const points: { key: string; value: number; category: string }[] = [];
  let converted = false;
  let skipped = 0;
  const today0 = bucketOf(opts.now, opts.grain, opts.tz);
  const sel = opts.selected ?? today0;
  const me = { share: 0, paid: 0, net: 0 };
  const conv = (raw: number, cur: string): number | null => (cur === opts.currency ? raw : opts.toChart(raw, cur));
  for (const g of groups) {
    for (const e of g.expenses) {
      if (opts.include && !opts.include(e.id)) continue;
      if (e.kind === "pot") continue; // a card game's result isn't spending
      const sign = e.kind === "refund" ? -1 : 1;
      const raw = opts.view === "share" ? (e.shares.find((s) => s.memberId === g.myId)?.amount ?? 0) : e.amount;
      if (bucketOf(e.spentAt ?? e.createdAt, opts.grain, opts.tz) === sel) {
        // Money back flips it: whoever got the money back owes it to the people it's shared with.
        const shareRaw = e.shares.find((x) => x.memberId === g.myId)?.amount ?? 0;
        const paidRaw = e.paidById !== undefined ? (payersOf({ paidById: e.paidById, amount: e.amount, payers: e.payers }).find((p) => p.memberId === g.myId)?.amount ?? 0) : 0;
        const sh = shareRaw ? conv(shareRaw, g.currency) : 0;
        const pd = paidRaw ? conv(paidRaw, g.currency) : 0;
        if (sh !== null && pd !== null) {
          me.share += sign * sh;
          me.paid += sign * pd;
        }
      }
      if (raw === 0) continue;
      let value: number;
      if (g.currency === opts.currency) value = raw;
      else {
        const c = opts.toChart(raw, g.currency);
        if (c === null) {
          skipped++;
          continue;
        }
        converted = true;
        value = c;
      }
      const key = bucketOf(e.spentAt ?? e.createdAt, opts.grain, opts.tz);
      sums.set(key, (sums.get(key) ?? 0) + sign * value);
      points.push({ key, value: sign * value, category: e.category });
    }
  }
  const today = today0;
  const selected = sel;
  me.net = me.paid - me.share;
  const keys = bucketsEnding(selected > today ? selected : today, opts.grain);
  const cats = new Map<string, number>();
  for (const p of points) if (p.key === selected) cats.set(p.category, (cats.get(p.category) ?? 0) + p.value);
  return {
    bars: keys.map((key) => ({ key, value: sums.get(key) ?? 0 })),
    selected,
    categories: [...cats].map(([id, amount]) => ({ id, amount })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount),
    converted,
    skipped,
    me,
  };
}
