import { spentAmount } from "./payers";

// Is the group really square: nobody owes anybody, and there is at least one expense (an empty group isn't "square",
// it just hasn't started). The All square page and its shareable picture use the same rule.
export const isSquare = (g: { transfers: unknown[]; expenses: unknown[] }) => g.transfers.length === 0 && g.expenses.length > 0;

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

// The three tiles under "All square", as [big text, small label]. With "hide amounts" the money tile
// becomes a count, so the picture can be shared without showing what the group spent.
export function squareTiles(n: ReturnType<typeof squareNumbers>, o: { hide: boolean; formatSpent: (minor: number) => string }): [string, string][] {
  const expenses: [string, string] = [String(n.expenses), n.expenses === 1 ? "expense" : "expenses"];
  const crew: [string, string] = n.days > 1 ? [`${n.days} days`, `${n.people} of you`] : [`${n.people}`, "people"];
  if (!o.hide) return [[o.formatSpent(n.spent), "spent together"], expenses, crew];
  const payments: [string, string] = [String(n.payments), n.payments === 1 ? "payment made" : "payments made"];
  return n.payments > 0 ? [expenses, payments, crew] : [expenses, crew];
}
