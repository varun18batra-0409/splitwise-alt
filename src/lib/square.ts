import { spentAmount } from "./payers";

// "All square": the numbers for the celebration card. Pure.
export function squareNumbers(g: {
  expenses: { amount: number; kind?: string | null; spentAt?: Date | null; createdAt: Date }[];
  payments: unknown[];
  people: number;
  tripStart?: string;
  tripEnd?: string;
}) {
  const spent = g.expenses.reduce((s, e) => s + spentAmount(e), 0);
  const days = (() => {
    if (g.tripStart && g.tripEnd) return Math.round((Date.parse(g.tripEnd) - Date.parse(g.tripStart)) / 86_400_000) + 1;
    const ts = g.expenses.map((e) => (e.spentAt ?? e.createdAt).getTime());
    return ts.length ? Math.round((Math.max(...ts) - Math.min(...ts)) / 86_400_000) + 1 : 0;
  })();
  return { spent, expenses: g.expenses.length, payments: g.payments.length, people: g.people, days, each: g.people ? Math.round(spent / g.people) : 0 };
}
