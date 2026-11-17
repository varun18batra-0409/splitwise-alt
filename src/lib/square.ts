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

// The three tiles under "All square", as [big text, small label]: always "spent together", the expenses and the people (or days).
// With "hide amounts" only the money is blanked ("₹ ••••"), so the tiles keep the same shape and nothing shows that a payment was made.
export const HIDDEN_AMOUNT = "••••";
export function squareTiles(n: ReturnType<typeof squareNumbers>, o: { hide: boolean; formatSpent: (minor: number) => string }): [string, string][] {
  const expenses: [string, string] = [String(n.expenses), n.expenses === 1 ? "expense" : "expenses"];
  const crew: [string, string] = n.days > 1 ? [`${n.days} days`, `${n.people} of you`] : [`${n.people}`, "people"];
  if (!o.hide) return [[o.formatSpent(n.spent), "spent together"], expenses, crew];
  // Only the currency's sign is kept (what the formatter writes for zero, without its digits), never an amount.
  const sign = o.formatSpent(0).replace(/[\d.,\s\u00a0\u202f]/g, "");
  return [[sign ? `${sign}\u00a0${HIDDEN_AMOUNT}` : HIDDEN_AMOUNT, "spent together"], expenses, crew];
}

// The words and switches of the square page. Someone who left only sees their own part of the ledger, so "All square" / "Not square yet"
// (words about the whole group) are not theirs to say: they always get one calm line, whatever they can see, with no share and no
// "Hide amounts" switch (there is no share for the switch to change). Everyone else is unchanged.
export const SQUARE_NEUTRAL = "You're settled up here.";
export function squareWords(o: { leaver: boolean; transfers: number; expenses: number }) {
  const square = o.leaver || (o.transfers === 0 && o.expenses > 0);
  return {
    square,
    title: o.leaver ? SQUARE_NEUTRAL : square ? "All square" : "Not square yet",
    heading: o.leaver ? SQUARE_NEUTRAL : "All square",
    confetti: square && !o.leaver,
    share: square && !o.leaver,
    hideSwitch: square && !o.leaver,
    tiles: square && (!o.leaver || o.expenses > 0),
  };
}
