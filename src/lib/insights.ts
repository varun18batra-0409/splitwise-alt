import { bucketOf, bucketsEnding, type Grain } from "./search";

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
};
export type InsightGroup = { currency: string; myId: string; expenses: Expense[] };

export type InsightsResult = {
  bars: { key: string; value: number }[]; // oldest first
  selected: string; // the bar being looked at
  categories: { id: string; amount: number }[]; // for the selected bar, biggest first (positive only)
  converted: boolean; // something was converted from another currency
  skipped: number; // expenses left out (no saved rate for their currency)
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
  for (const g of groups) {
    for (const e of g.expenses) {
      if (opts.include && !opts.include(e.id)) continue;
      const sign = e.kind === "refund" ? -1 : 1;
      const raw = opts.view === "share" ? (e.shares.find((s) => s.memberId === g.myId)?.amount ?? 0) : e.amount;
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
  const today = bucketOf(opts.now, opts.grain, opts.tz);
  const selected = opts.selected ?? today;
  const keys = bucketsEnding(selected > today ? selected : today, opts.grain);
  const cats = new Map<string, number>();
  for (const p of points) if (p.key === selected) cats.set(p.category, (cats.get(p.category) ?? 0) + p.value);
  return {
    bars: keys.map((key) => ({ key, value: sums.get(key) ?? 0 })),
    selected,
    categories: [...cats].map(([id, amount]) => ({ id, amount })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount),
    converted,
    skipped,
  };
}
