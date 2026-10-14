import { dayKey } from "./dates";
import { getCategory } from "./categories";

// Search across your groups by words, month or year — plus a small recap of
// the period (what was spent, your share, the top category).

export type Period = { year?: string; month?: string }; // month = "2026-10"

export const monthKey = (d: Date) => dayKey(d).slice(0, 7);

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function cleanPeriod(year?: string, month?: string): Period {
  const m = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined;
  const y = !m && year && /^\d{4}$/.test(year) ? year : undefined;
  return { year: y, month: m };
}

export function inPeriod(d: Date, p: Period): boolean {
  const k = monthKey(d);
  if (p.month) return k === p.month;
  if (p.year) return k.startsWith(p.year);
  return true;
}

// Months (newest first) and years that have something in them.
export function periodsOf(dates: Date[]): { months: string[]; years: string[] } {
  const months = [...new Set(dates.map(monthKey))].sort().reverse();
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  return { months, years };
}

type RecapExpense = { amount: number; category: string; currency: string; mine: number };

export function recap(expenses: RecapExpense[]) {
  const byCurrency = new Map<string, { spent: number; mine: number }>();
  const catCount = new Map<string, number>();
  for (const e of expenses) {
    const t = byCurrency.get(e.currency) ?? { spent: 0, mine: 0 };
    t.spent += e.amount;
    t.mine += e.mine;
    byCurrency.set(e.currency, t);
    const c = getCategory(e.category).id;
    catCount.set(c, (catCount.get(c) ?? 0) + 1);
  }
  const top = [...catCount].sort((a, b) => b[1] - a[1])[0];
  return {
    count: expenses.length,
    totals: [...byCurrency].map(([currency, t]) => ({ currency, ...t })),
    topCategory: top ? getCategory(top[0]) : null,
  };
}
