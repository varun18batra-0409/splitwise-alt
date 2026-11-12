import { ExpenseGlyph } from "@/components/ExpenseGlyph";
import { payerIds, payersOf, spentAmount } from "@/lib/payers";
import { CATEGORIES, getCategory } from "@/lib/categories";
import { dayKey, expenseDate } from "@/lib/dates";
import { niceDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { spentByCurrency } from "@/lib/secondary";
import { ColumnChart, HBarChart } from "@/components/Charts";
import type { GroupExpense, GroupView } from "./view";
import Link from "@/components/Link";
import { spendingOnly } from "@/lib/chart-rows";
import { insightLines, tripReport } from "@/lib/trip-report";

// Category, currency, day-by-day, who paid, and each person's share.
export function ChartsTab({ v }: { v: GroupView }) {
  const { group, myId, expenses, money, spent, tz } = v;
  if (expenses.length === 0) {
    return <p className="rounded-2xl bg-mist px-4 py-8 text-center text-sm text-gray-600">Charts appear once the group has expenses.</p>;
  }

  const sumBy = (keyOf: (e: GroupExpense) => string[], amountOf: (e: GroupExpense, k: string) => number, rows: GroupExpense[] = expenses) => {
    const m = new Map<string, number>();
    for (const e of rows) for (const k of keyOf(e)) m.set(k, (m.get(k) ?? 0) + amountOf(e, k));
    return m;
  };

  const byCat = sumBy((e) => [getCategory(e.category).id], (e) => spentAmount(e));
  const catData = CATEGORIES.filter((c) => byCat.has(c.id))
    .map((c) => {
      const value = byCat.get(c.id)!;
      return { key: c.id, label: c.label, icon: <ExpenseGlyph title="" category={c.id} size={22} className="rounded-[7px]!" />, value, valueText: `${money(value)} · ${Math.round((value / spent) * 100)}%`, href: `/search?g=${group.id}&c=${c.id}` };
    })
    .sort((a, b) => b.value - a.value);

  const sign = (e: GroupExpense) => (e.kind === "refund" ? -1 : 1);
  const paid = sumBy((e) => payerIds(e), (e, k) => sign(e) * (payersOf(e).find((p) => p.memberId === k)?.amount ?? 0), spendingOnly(expenses));
  const people = (m: Map<string, number>) =>
    group.members
      .map((mem) => ({ key: mem.id, label: mem.id === myId ? "You" : mem.name, value: m.get(mem.id) ?? 0, valueText: money(m.get(mem.id) ?? 0) }))
      .sort((a, b) => b.value - a.value);

  // Each person's share, split by category: what each of us spent on stays, food, travel…
  const byPerson = group.members
    .map((mem) => {
      const cats = new Map<string, number>();
      for (const e of spendingOnly(expenses)) {
        const sh = e.shares.find((x) => x.memberId === mem.id)?.amount ?? 0;
        if (!sh) continue;
        const c = getCategory(e.category).id;
        cats.set(c, (cats.get(c) ?? 0) + sign(e) * sh);
      }
      const parts = CATEGORIES.filter((c) => (cats.get(c.id) ?? 0) > 0)
        .map((c) => ({ id: c.id, label: c.short, amount: cats.get(c.id)!, href: `/search?g=${group.id}&c=${c.id}` }))
        .sort((a, b) => b.amount - a.amount);
      return { id: mem.id, name: mem.id === myId ? "You" : mem.name, total: parts.reduce((t, x) => t + x.amount, 0), parts };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => Number(b.id === myId) - Number(a.id === myId) || b.total - a.total);

  // Spending per day (the day each expense was spent), from the first to the last, up to 21 days.
  const perDay = sumBy((e) => [dayKey(expenseDate(e), tz)], (e) => spentAmount(e));
  const keys = [...perDay.keys()].sort();
  const days: string[] = [];
  for (let d = new Date(`${keys[0]}T00:00:00Z`); d <= new Date(`${keys[keys.length - 1]}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const shownDays = days.slice(-21);
  const dayData = shownDays.map((k) => ({
    key: k,
    label: niceDate(k).replace(/ \d{4}$/, ""),
    value: perDay.get(k) ?? 0,
    valueText: money(perDay.get(k) ?? 0),
  }));

  // A few plain-English lines on top (trips and other groups; flats have their own on This month).
  const home = group.type === "home" || group.type === "couple";
  const report = tripReport({ name: group.name, type: group.type, currency: group.currency, members: group.members, expenses, transfers: v.transfers, tz });
  const lines = home ? [] : insightLines(report, myId);

  return (
    <div className="space-y-10">
      {!home && (
        <section aria-label="At a glance" className="rounded-2xl bg-mist px-4 py-4">
          {lines.length > 0 && (
            <ul className="mb-3 space-y-1.5 text-sm text-fg/85">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href={`/groups/${group.id}/wrapped`} className="inline-flex min-h-11 items-center text-sm font-semibold text-fg underline underline-offset-4">
              🎬 Watch the Wrapped ›
            </Link>
            <Link href={`/groups/${group.id}/report`} className="inline-flex min-h-11 items-center text-sm font-semibold text-fg underline underline-offset-4">
              {group.type === "trip" ? "Trip report, to share" : "Group report, to share"} ›
            </Link>
          </div>
        </section>
      )}
      <HBarChart title="Spending by category" data={catData} total={money(spent)} />
      <HBarChart
        title="Spent by currency"
        data={spentByCurrency(expenses).map((r) => ({
          key: r.currency,
          label: r.currency === group.currency ? `${r.currency} (group currency)` : r.currency,
          value: r.group,
          valueText: r.currency === group.currency ? money(r.group) : `${formatMoney(r.original, r.currency)} = ${money(r.group)}`,
        }))}
      />
      <ColumnChart title={shownDays.length < days.length ? "Spending by day (last 21 days)" : "Spending by day"} data={dayData} />
      <HBarChart title="Who paid" data={people(paid)} />
      <PersonByCategory rows={byPerson} money={money} />
    </div>
  );
}

// One quiet colour per category, used in the per-person bars and their keys.
const CAT_COLOUR: Record<string, string> = {
  accommodation: "#b8a3ea",
  food: "#e9b872",
  transport: "#86b8ea",
  activities: "#e6d47e",
  shopping: "#e7a0c6",
  groceries: "#9fceaa",
  bills: "#a9b2c0",
  other: "#6f6f7a",
};

function PersonByCategory({ rows, money }: { rows: { id: string; name: string; total: number; parts: { id: string; label: string; amount: number; href: string }[] }[]; money: (n: number) => string }) {
  if (!rows.length) return null;
  return (
    <section aria-label="Each person’s share by category" data-person-categories>
      <h3 className="mb-1 font-display text-base font-semibold tracking-tight">Each person’s share, by category</h3>
      <p className="mb-4 text-xs text-fg/50">What each of you spent on stays, food, travel and the rest. Tap a category to see its expenses.</p>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-[18px] border border-line bg-mist/40 px-4 py-3.5" data-person-row={r.name}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[15px] font-semibold">{r.name}</span>
              <span className="money shrink-0 text-[15px] font-semibold tabular-nums">{money(r.total)}</span>
            </div>
            {/* One bar, split by category */}
            <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-fg/[0.06]" aria-hidden>
              {r.parts.map((p) => (
                <span key={p.id} className="h-full" style={{ width: `${(p.amount / r.total) * 100}%`, background: CAT_COLOUR[p.id] ?? CAT_COLOUR.other }} />
              ))}
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
              {r.parts.map((p) => (
                <li key={p.id}>
                  <Link href={p.href} className="block text-[13px] leading-tight active:opacity-70">
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: CAT_COLOUR[p.id] ?? CAT_COLOUR.other }} />
                      <span className="min-w-0 break-words text-fg/60">{p.label}</span>
                    </span>
                    <span className="mt-0.5 block pl-3.5 tabular-nums text-fg/90">{money(p.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
