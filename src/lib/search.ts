import { dayKey } from "./dates";
import { getCategory } from "./categories";

// Search across your groups by words, month or year — plus a small recap of
// the period (what was spent, your share, the top category).

export type Period = { year?: string; month?: string; week?: string }; // month = "2026-10", week = its Monday "2026-10-19"

export const monthKey = (d: Date, tz?: string) => dayKey(d, tz).slice(0, 7);

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).replace("Sept", "Sep");
}

export function cleanPeriod(year?: string, month?: string, week?: string): Period {
  const w = week && /^\d{4}-\d{2}-\d{2}$/.test(week) && weekKeyOfDay(week) === week ? week : undefined;
  const m = !w && month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined;
  const y = !w && !m && year && /^\d{4}$/.test(year) ? year : undefined;
  return { year: y, month: m, week: w };
}

// The Monday of the week a day falls in ("2026-10-21" → "2026-10-19").
export function weekKeyOfDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}
export const weekKey = (d: Date, tz?: string) => weekKeyOfDay(dayKey(d, tz));

export function inPeriod(d: Date, p: Period, tz?: string): boolean {
  if (p.week) return weekKey(d, tz) === p.week;
  const k = monthKey(d, tz);
  if (p.month) return k === p.month;
  if (p.year) return k.startsWith(p.year);
  return true;
}

// Months (newest first) and years that have something in them.
export function periodsOf(dates: Date[], tz?: string): { months: string[]; years: string[] } {
  const months = [...new Set(dates.map((d) => monthKey(d, tz)))].sort().reverse();
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  return { months, years };
}

type RecapExpense = { amount: number; category: string; currency: string; mine: number };

export function recap(expenses: RecapExpense[]) {
  const byCurrency = new Map<string, { spent: number; mine: number }>();
  const catCount = new Map<string, number>();
  const catAmount = new Map<string, number>();
  for (const e of expenses) {
    const t = byCurrency.get(e.currency) ?? { spent: 0, mine: 0 };
    t.spent += e.amount;
    t.mine += e.mine;
    byCurrency.set(e.currency, t);
    const c = getCategory(e.category).id;
    catCount.set(c, (catCount.get(c) ?? 0) + 1);
    catAmount.set(c, (catAmount.get(c) ?? 0) + e.amount);
  }
  // Top category by money when it's all one currency, otherwise by how often.
  const oneCurrency = byCurrency.size === 1;
  const top = [...(oneCurrency ? catAmount : catCount)].sort((a, b) => b[1] - a[1])[0];
  return {
    count: expenses.length,
    totals: [...byCurrency].map(([currency, t]) => ({ currency, ...t })),
    topCategory: top ? getCategory(top[0]) : null,
  };
}

// ---------- Insights: the chart on top of Search ----------

export type Grain = "w" | "m" | "y";

const shiftMonth = (key: string, n: number) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const shiftWeek = (key: string, n: number) => new Date(new Date(`${key}T12:00:00Z`).getTime() + n * 7 * 86_400_000).toISOString().slice(0, 10);

// Which bar a moment belongs to.
export function bucketOf(d: Date, grain: Grain, tz?: string): string {
  return grain === "w" ? weekKey(d, tz) : grain === "y" ? dayKey(d, tz).slice(0, 4) : monthKey(d, tz);
}

// The bars, oldest first, ending with `last` (6 weeks, 6 months or 4 years).
export function bucketsEnding(last: string, grain: Grain): string[] {
  const n = grain === "w" ? 6 : grain === "m" ? 6 : 4;
  return Array.from({ length: n }, (_, i) => {
    const back = n - 1 - i;
    return grain === "w" ? shiftWeek(last, -back) : grain === "m" ? shiftMonth(last, -back) : String(Number(last) - back);
  });
}

export function bucketLabel(key: string, grain: Grain): string {
  if (grain === "y") return key;
  if (grain === "m") return new Date(`${key}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }).replace("Sept", "Sep");
  // Weeks: "19 Oct" (months shortened to three letters, so six fit side by side).
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).replace("Sept", "Sep");
}

// "October 2026", "2026", "Week of 19 Oct".
export function bucketTitle(key: string, grain: Grain): string {
  if (grain === "y") return key;
  if (grain === "m") return new Date(`${key}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return `Week of ${bucketLabel(key, "w")}`;
}
