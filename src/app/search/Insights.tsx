import Link from "@/components/Link";
import { formatMoney } from "@/lib/money";
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
  bars: { key: string; value: number; href: string }[];
  selected: string; // the lit bar
  categories: { id: string; amount: number }[]; // for the selected bar, biggest first
  bills: { id: string; href: string; name: string; group: string; amount: string; when: string; emoji: string }[];
  link: (over: { v?: string; p?: string }) => string;
};

// ₹30K, ₹1.2L, $4.5K: short enough for the chart's scale.
function compact(minor: number, currency: string): string {
  const digits = currency === "JPY" || currency === "KRW" || currency === "VND" || currency === "IDR" ? 0 : 2;
  const v = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(v);
  } catch {
    return `${currency} ${Math.round(v)}`;
  }
}

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
  const change = before !== null && before > 0 ? Math.round(((now - before) / before) * 100) : null;
  const top = niceMax(Math.max(...d.bars.map((b) => Math.max(0, b.value)), 0));
  const approx = d.converted ? "≈ " : "";
  const totalCat = d.categories.reduce((s, c) => s + Math.max(0, c.amount), 0);
  const pill = (on: boolean) =>
    `flex-1 rounded-full py-2 text-center text-sm font-semibold transition-colors ${on ? "bg-[linear-gradient(135deg,#ff9b52,#ff6a2b)] text-[#1a0d05] shadow-[0_6px_20px_-6px_rgba(255,110,40,0.7)]" : "text-gray-500"}`;
  const grainChip = (on: boolean) =>
    `flex h-8 w-11 items-center justify-center rounded-full text-xs font-semibold ${on ? "bg-[linear-gradient(135deg,#ff9b52,#ff6a2b)] text-[#1a0d05]" : "bg-fg/[0.06] text-gray-500"}`;

  return (
    <section aria-label="Insights" className="mb-8">
      {/* Your share | Group spend */}
      <div className="flex gap-1 rounded-full border border-line bg-white p-1" role="tablist" aria-label="What to show">
        <Link href={d.link({ v: "share" })} role="tab" aria-selected={d.view === "share"} className={pill(d.view === "share")}>
          Your share
        </Link>
        <Link href={d.link({ v: "spent" })} role="tab" aria-selected={d.view === "spent"} className={pill(d.view === "spent")}>
          Group spend
        </Link>
      </div>

      {/* The card: total, change, period, bars */}
      <div className="relative mt-4 overflow-hidden rounded-[26px] border border-line bg-[radial-gradient(120%_70%_at_100%_0%,rgba(255,120,50,0.16),transparent_60%),linear-gradient(170deg,#1b1a1f_0%,#121115_80%)] px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-fg/55">
              {d.view === "share" ? "Your share" : "Group spend"} · {bucketTitle(d.selected, d.grain)}
            </p>
            <p className="mt-1 font-display text-[34px] font-semibold leading-none tracking-tight tabular-nums">
              {approx}
              {formatMoney(Math.max(0, now), d.currency)}
            </p>
            <p className="mt-2 text-xs">
              {change === null ? (
                <span className="text-fg/45">Nothing to compare with yet</span>
              ) : (
                <span className={change > 0 ? "text-[#ff9b52]" : change < 0 ? "text-owed" : "text-fg/55"}>
                  {change > 0 ? "▲" : change < 0 ? "▼" : "•"} {Math.abs(change)}%{" "}
                  <span className="text-fg/45">vs {bucketLabel(d.bars[i - 1].key, d.grain)}</span>
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
        <div
          role="img"
          aria-label={d.bars.map((b) => `${bucketLabel(b.key, d.grain)}: ${formatMoney(Math.max(0, b.value), d.currency)}`).join(", ")}
          className="relative mt-5 h-[168px] pl-11"
        >
          {[1, 0.5, 0].map((f) => (
            <div key={f} aria-hidden className="absolute inset-x-0 flex items-center" style={{ bottom: `${f * 140 + 22}px` }}>
              <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-fg/35">{compact(Math.round(top * f), d.currency)}</span>
              <span className="ml-1 h-px flex-1 border-t border-dashed border-fg/10" />
            </div>
          ))}
          <div className="relative flex h-full items-end gap-2">
            {d.bars.map((b) => {
              const on = b.key === d.selected;
              const h = Math.max(4, Math.round((Math.max(0, b.value) / top) * 140));
              return (
                <Link key={b.key} href={b.href} aria-label={`${bucketTitle(b.key, d.grain)}: ${formatMoney(Math.max(0, b.value), d.currency)}`} className="group flex h-full flex-1 flex-col items-center justify-end">
                  <span
                    className={`lp-bar-up w-full max-w-[30px] rounded-full ${on ? "bg-[linear-gradient(180deg,#ffb36b,#ff6a2b)] shadow-[0_0_24px_-2px_rgba(255,110,40,0.65)]" : "bg-fg/[0.13] group-active:bg-fg/25"}`}
                    style={{ height: `${h}px` }}
                  />
                  <span className={`mt-2 h-3 whitespace-nowrap text-[10px] leading-3 ${on ? "font-semibold text-fg" : "text-fg/40"}`}>{bucketLabel(b.key, d.grain)}</span>
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
                <li key={c.id} className="flex items-center gap-3">
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-fg/[0.06] text-lg">
                    {cat.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{cat.label}</span>
                      <span className="shrink-0 tabular-nums text-fg/80">
                        {approx}
                        {formatMoney(Math.max(0, c.amount), d.currency)} <span className="text-xs text-fg/40">· {pct}%</span>
                      </span>
                    </span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-fg/[0.07]">
                      <span
                        className={`lp-bar-x block h-full rounded-full ${n === 0 ? "bg-[linear-gradient(90deg,#ff6a2b,#ffb36b)]" : "bg-fg/30"}`}
                        style={{ width: `${Math.max(3, pct)}%` }}
                      />
                    </span>
                  </span>
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
                <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-full bg-fg/[0.07] text-base">
                  {b.emoji}
                </span>
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
