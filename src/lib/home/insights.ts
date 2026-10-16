import { dayKey, expenseDate } from "../dates";
import { normaliseName } from "../duplicates";
import { addMonths } from "./month";

// "Heads up" lines, next month's estimate and the monthly summary — simple
// rules, no AI.

// A bill that changes (electricity) more than 25% above its usual (the
// average of up to 3 earlier months).
export function utilityJumps(runs: { name: string; period: string; amount: number }[], month: string) {
  const out: { name: string; amount: number; usual: number; pct: number }[] = [];
  const names = [...new Set(runs.map((r) => r.name))];
  for (const name of names) {
    const now = runs.find((r) => r.name === name && r.period === month);
    if (!now) continue;
    const earlier = [1, 2, 3].map((n) => runs.find((r) => r.name === name && r.period === addMonths(month, -n))).filter(Boolean) as { amount: number }[];
    if (!earlier.length) continue;
    const usual = Math.round(earlier.reduce((s, r) => s + r.amount, 0) / earlier.length);
    if (usual > 0 && now.amount * 100 > usual * 125) out.push({ name, amount: now.amount, usual, pct: Math.round(((now.amount - usual) * 100) / usual) });
  }
  return out;
}

// A category up 30% or more on last month (and more than ₹1,000 / 1,000 units).
export function categoryJumps(thisMonth: { id: string; amount: number }[], lastMonth: { id: string; amount: number }[]) {
  const out: { id: string; amount: number; prev: number; pct: number }[] = [];
  for (const c of thisMonth) {
    const prev = lastMonth.find((x) => x.id === c.id)?.amount ?? 0;
    if (prev > 0 && c.amount > 100000 && c.amount * 100 >= prev * 130) out.push({ id: c.id, amount: c.amount, prev, pct: Math.round(((c.amount - prev) * 100) / prev) });
  }
  return out;
}

// The same thing, same amount, added twice on the same day.
export function sameDayDuplicates(expenses: { id: string; description: string; amount: number; spentAt?: Date | null; createdAt: Date }[], tz: string) {
  const groups = new Map<string, { name: string; amount: number; day: string; ids: string[] }>();
  for (const e of expenses) {
    const day = dayKey(expenseDate(e), tz);
    const k = `${normaliseName(e.description)}|${e.amount}|${day}`;
    const g = groups.get(k);
    if (g) g.ids.push(e.id);
    else groups.set(k, { name: e.description.trim(), amount: e.amount, day, ids: [e.id] });
  }
  return [...groups.values()].filter((g) => g.ids.length > 1);
}

// Next month, about: fixed bills + the usual for bills that change + daily
// bills for the month + the usual groceries (averages of recent months).
export function forecast(input: { fixed: number[]; varies: number[][]; daily: { rate: number; days: number }[]; groceries: number[] }): number {
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0);
  return (
    input.fixed.reduce((s, x) => s + x, 0) +
    input.varies.reduce((s, xs) => s + avg(xs), 0) +
    input.daily.reduce((s, d) => s + d.rate * d.days, 0) +
    avg(input.groceries)
  );
}

export function monthlySummaryText(
  s: { month: string; group: string; total: number; mine: number; top: string; unusual: string; couple?: boolean },
  money: (n: number) => string,
): { title: string; body: string } {
  const monthName = new Date(`${s.month}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
  const parts = [`${money(s.total)} spent${s.couple ? " together" : ""}, your share ${money(s.mine)}.`];
  if (s.top) parts.push(`Most went on ${s.top}.`);
  if (s.unusual) parts.push(`${s.unusual}.`);
  return { title: `${s.couple ? "💞" : "🏠"} ${s.group} · ${monthName}`, body: parts.join(" ") };
}
