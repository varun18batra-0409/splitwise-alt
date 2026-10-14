import { CATEGORIES, getCategory } from "@/lib/categories";
import { dayKey, expenseDate } from "@/lib/dates";
import { niceDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { spentByCurrency } from "@/lib/secondary";
import { ColumnChart, HBarChart } from "@/components/Charts";
import type { GroupExpense, GroupView } from "./view";

// Category, currency, day-by-day, who paid, and each person's share.
export function ChartsTab({ v }: { v: GroupView }) {
  const { group, myId, expenses, money, spent } = v;
  if (expenses.length === 0) {
    return <p className="rounded-2xl bg-mist px-4 py-8 text-center text-sm text-gray-600">Charts appear once the group has expenses.</p>;
  }

  const sumBy = (keyOf: (e: GroupExpense) => string[], amountOf: (e: GroupExpense, k: string) => number) => {
    const m = new Map<string, number>();
    for (const e of expenses) for (const k of keyOf(e)) m.set(k, (m.get(k) ?? 0) + amountOf(e, k));
    return m;
  };

  const byCat = sumBy((e) => [getCategory(e.category).id], (e) => e.amount);
  const catData = CATEGORIES.filter((c) => byCat.has(c.id))
    .map((c) => {
      const value = byCat.get(c.id)!;
      return { key: c.id, label: c.label, icon: c.emoji, value, valueText: `${money(value)} · ${Math.round((value / spent) * 100)}%` };
    })
    .sort((a, b) => b.value - a.value);

  const paid = sumBy((e) => [e.paidById], (e) => e.amount);
  const shares = sumBy(
    (e) => e.shares.map((s) => s.memberId),
    (e, k) => e.shares.find((s) => s.memberId === k)?.amount ?? 0,
  );
  const people = (m: Map<string, number>) =>
    group.members
      .map((mem) => ({ key: mem.id, label: mem.id === myId ? "You" : mem.name, value: m.get(mem.id) ?? 0, valueText: money(m.get(mem.id) ?? 0) }))
      .sort((a, b) => b.value - a.value);

  // Spending per day (the day each expense was spent), from the first to the last, up to 21 days.
  const perDay = sumBy((e) => [dayKey(expenseDate(e))], (e) => e.amount);
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

  return (
    <div className="space-y-10">
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
      <HBarChart title="Each person’s share" data={people(shares)} />
    </div>
  );
}
