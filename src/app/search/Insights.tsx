import { ExpenseGlyph } from "@/components/ExpenseGlyph";
import Link from "@/components/Link";
import { formatMoney } from "@/lib/money";
import { compactMoney, signedMoney } from "@/lib/chart-labels";
import { getCategory } from "@/lib/categories";
import { bucketLabel, bucketTitle, type Grain } from "@/lib/search";

// The top of Search: your money over time, at a glance. A "Your share | Group
// spend" switch, Week · Month · Year, a bar for each period (the chosen one
// lit up), how it compares with the one before, where it went, and the
// bills that repeat. Everything is a plain link, so it works without waiting
// for any script.

export type InsightsData = {
  view: "share" | "spent";
  grain: Grain;
  currency: string;
  converted: boolean; // some groups were in other currencies (shown with ≈)
  me: { share: number; paid: number; net: number }; // the lit period: my cut, what I paid, the difference
  bars: { key: string; value: number; href: string }[];
  selected: string; // the lit bar
  categories: { id: string; amount: number }[]; // for the selected bar, biggest first
  bills: { id: string; href: string; name: string; group: string; amount: string; when: string; emoji: string }[];
  link: (over: { v?: string; p?: string }) => string;
  catHref?: (id: string) => string; // all the expenses in one category
};

// A round top for the scale (₹30K rather than ₹27,431).
function niceMax(n: number): number {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

export function Insights({ d }: { d: InsightsData }) {
  const i = Math.max(0, d.bars.findIndex((b) => b.key === d.selected));
  const now = d.bars[i]?.value ?? 0;
  const before = i > 0 ? d.bars[i - 1].value : null;
  // The newest bar is the week / month / year still going on: a % against a whole
  // finished one would always look like a big drop, so show "so far" and the last one instead.
  const running = i === d.bars.length - 1;
  const change = !running && before !== null && before > 0 ? Math.round(((now - before) / before) * 100) : null;
  const lastWord = d.grain === "w" ? "Last week" : d.grain === "m" ? "Last month" : "Last year";
  const top = niceMax(Math.max(...d.bars.map((b) => Math.max(0, b.value)), 0));
  const approx = d.converted ? "≈ " : "";
  const totalCat = d.categories.reduce((s, c) => s + Math.max(0, c.amount), 0);
  // Same look as the rest of Loopin: the group tabs' switch, off-white for what's chosen, green for money bars.
  const pill = (on: boolean) => `flex-1 rounded-full py-2 text-center text-sm ${on ? "shadow-[inset_0_0_0_1.5px_var(--color-fg)] font-semibold text-fg" : "text-gray-500"}`;
  const grainChip = (on: boolean) =>
    `flex h-8 w-11 items-center justify-center rounded-full border text-xs font-semibold ${on ? "border-fg shadow-[inset_0_0_0_0.5px_var(--color-fg)] text-fg" : "border-line text-gray-500 active:bg-mist"}`;

  return (
    <section aria-label="Insights" className="mb-8">
      {/* Your share | Group spend */}
      <div className="grid grid-cols-2 gap-1 rounded-full bg-mist p-1" role="tablist" aria-label="What to show">
        <Link href={d.link({ v: "share" })} role="tab" aria-selected={d.view === "share"} className={pill(d.view === "share")}>
          Your share
        </Link>
        <Link href={d.link({ v: "spent" })} role="tab" aria-selected={d.view === "spent"} className={pill(d.view === "spent")}>
          Group total
        </Link>
      </div>

      {/* The card: total, change, period, bars */}
      <div className="vault relative mt-4 rounded-[24px] px-5 pb-4 pt-5 text-fg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-fg/55">
              {d.view === "share" ? "Your share" : "Group total"} · {bucketTitle(d.selected, d.grain)}
            </p>
            <p className="mt-1 money text-[34px] font-semibold leading-none tracking-tight tabular-nums" data-insights-total>
              {approx}
              {signedMoney(now, d.currency)}
            </p>
            <p className="mt-2 text-xs">
              {running ? (
                <span className="text-fg/60">
                  So far{before !== null && before > 0 ? ` · ${lastWord.toLowerCase()} ${approx}${formatMoney(before, d.currency)}` : ""}
                </span>
              ) : change === null ? (
                <span className="text-fg/60">Nothing to compare with yet</span>
              ) : Math.abs(change) > 300 && before !== null ? (
                // A tiny last month makes percentages silly (▲5534%): show the two amounts instead.
                <span className="text-fg/55" data-insights-compare="amounts">
                  {approx}
                  {formatMoney(before, d.currency)} in {bucketLabel(d.bars[i - 1].key, d.grain)}
                </span>
              ) : (
                <span className={change > 0 ? "text-owe" : change < 0 ? "text-owed" : "text-fg/55"}>
                  {change > 0 ? "▲" : change < 0 ? "▼" : "•"} {Math.abs(change)}%{" "}
                  <span className="text-fg/60">vs {bucketLabel(d.bars[i - 1].key, d.grain)}</span>
                </span>
              )}
            </p>
          </div>
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fg/[0.07] text-fg/70">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 17l6-6 4 4 8-8" />
              <path d="M15 7h6v6" />
            </svg>
          </span>
        </div>

        {/* Where it leaves you: your cut of the costs vs what you paid. Answers "why isn't this what I owe?" */}
        {(d.me.share !== 0 || d.me.paid !== 0) && (
          <div className="mt-4 grid grid-cols-3 divide-x divide-fg/10 rounded-2xl bg-fg/[0.05] py-2.5 text-center" aria-label="Your share, what you paid, and where that leaves you">
            <p className="px-1">
              <span className="block text-[11px] text-fg/50">Your share</span>
              <span className="block text-sm font-semibold tabular-nums">
                {approx}
                {signedMoney(d.me.share, d.currency)}
              </span>
            </p>
            <p className="px-1">
              <span className="block text-[11px] text-fg/50">You paid</span>
              <span className="block text-sm font-semibold tabular-nums">
                {approx}
                {signedMoney(d.me.paid, d.currency)}
              </span>
            </p>
            <p className="px-1">
              <span className="block text-[11px] text-fg/50">{d.me.net < 0 ? "You owe" : d.me.net > 0 ? "You’re owed" : "Even"}</span>
              <span className={`block text-sm font-semibold tabular-nums ${d.me.net < 0 ? "text-owe" : d.me.net > 0 ? "text-owed" : ""}`}>
                {approx}
                {formatMoney(Math.abs(d.me.net), d.currency)}
              </span>
            </p>
          </div>
        )}

        {/* Week · Month · Year */}
        <div className="mt-4 flex gap-2" aria-label="Group by">
          {(
            [
              ["w", "W", "By week"],
              ["m", "M", "By month"],
              ["y", "Y", "By year"],
            ] as const
          ).map(([g, label, name]) => (
            <Link key={g} href={d.link({ p: g })} aria-label={name} aria-current={d.grain === g ? "true" : undefined} className={grainChip(d.grain === g)}>
              {label}
            </Link>
          ))}
        </div>

        {/* The bars, with a light scale behind them */}
        {/* A group, not an image: each bar is its own link (an image can't hold links). */}
        <div
          role="group"
          aria-label="Spending over time (tap a bar to open that period)"
          className="relative mt-5 h-[168px] pl-11"
        >
          {[1, 0.5, 0].map((f) => (
            <div key={f} aria-hidden className="absolute inset-x-0 flex items-center" style={{ bottom: `${f * 140 + 22}px` }}>
              <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-fg/60">{compactMoney(Math.round(top * f), d.currency)}</span>
              <span className="ml-1 h-px flex-1 border-t border-dashed border-fg/10" />
            </div>
          ))}
          <div className="relative flex h-full items-end gap-2">
            {d.bars.map((b) => {
              const on = b.key === d.selected;
              const h = b.value > 0 ? Math.max(4, Math.round((b.value / top) * 140)) : 0; // no bar at zero
              return (
                <Link key={b.key} href={b.href} aria-label={`${bucketTitle(b.key, d.grain)}: ${signedMoney(b.value, d.currency)}`} className="group flex h-full flex-1 flex-col items-center justify-end">
                  <span
                    className={`lp-bar-up w-full max-w-[30px] rounded-full ${on ? "bg-fg" : "bg-fg/[0.13] group-active:bg-fg/25"}`}
                    style={{ height: `${h}px` }}
                  />
                  <span className={`mt-2 h-3 whitespace-nowrap text-[10px] leading-3 tracking-tight ${on ? "font-semibold text-fg" : "text-fg/60"}`}>{bucketLabel(b.key, d.grain)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Where it went (the lit period) */}
      {d.categories.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 font-display text-lg font-semibold tracking-tight">Where it went</h2>
          <ul className="space-y-3">
            {d.categories.slice(0, 5).map((c, n) => {
              const cat = getCategory(c.id);
              const pct = totalCat > 0 ? Math.round((Math.max(0, c.amount) / totalCat) * 100) : 0;
              return (
                <li key={c.id}>
                  <Link href={d.catHref ? d.catHref(c.id) : "#"} className="lp-press -mx-2 flex items-center gap-3 rounded-[14px] px-2 py-1 active:bg-mist" data-category-link={c.id}>
                  <ExpenseGlyph title="" category={c.id} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="line-clamp-2 min-w-0 break-words font-medium leading-tight" data-category-name>{cat.label}</span>
                      <span className="shrink-0 tabular-nums text-fg/80">
                        {approx}
                        {formatMoney(c.amount, d.currency)} <span className="text-xs text-fg/60">· {pct}%</span>
                      </span>
                    </span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-fg/[0.07]">
                      <span
                        className={`lp-bar-x block h-full rounded-full ${n === 0 ? "bg-fg" : "bg-fg/30"}`}
                        style={{ width: `${Math.max(3, pct)}%` }}
                      />
                    </span>
                  </span>
                  <span aria-hidden className="text-fg/60">›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Bills on repeat */}
      {d.bills.length > 0 && (
        <div className="mt-7">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-lg font-semibold tracking-tight">Bills on repeat</h2>
            <span className="text-xs text-gray-400">{d.bills.length}</span>
          </div>
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {d.bills.map((b) => (
              <Link key={b.id} href={b.href} className="lp-press w-[132px] shrink-0 rounded-[20px] border border-line bg-white px-3.5 py-3.5 active:bg-mist">
                <ExpenseGlyph title={b.name} category="bills" emoji={b.emoji} size={36} />
                <span className="mt-3 block truncate text-sm font-semibold">{b.name}</span>
                <span className="block truncate text-xs tabular-nums text-fg/60">{b.amount}</span>
                <span className="mt-1 block truncate text-[11px] text-gray-400">
                  {b.when} · {b.group}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
