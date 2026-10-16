import { dayKey, expenseDate, DEFAULT_TIME_ZONE } from "../dates";
import { getCategory } from "../categories";
import { moneyLines, spentAmount } from "../payers";
import { addMonths } from "./month";

type ExpenseLike = {
  amount: number;
  paidById: string;
  payers?: string | null;
  kind?: string | null;
  category: string;
  spentAt?: Date | null;
  createdAt: Date;
  shares: { memberId: string; amount: number }[];
};

export type MonthSummary = {
  total: number; // spent by the group this month (money back taken off)
  mine: number; // my share of it
  paidByMe: number; // what I paid for the group
  net: number; // what this month did to my balance (+ owed to me)
  byCategory: { id: string; amount: number }[];
  lastTotal: number; // the group's total last month
};

// This month's numbers for one person, from the group's expenses.
export function monthSummary(expenses: ExpenseLike[], myId: string, key: string, tz: string = DEFAULT_TIME_ZONE): MonthSummary {
  const inMonth = (e: ExpenseLike, k: string) => dayKey(expenseDate(e), tz).startsWith(k);
  const last = addMonths(key, -1);
  let total = 0, mine = 0, paidByMe = 0, net = 0, lastTotal = 0;
  const cats = new Map<string, number>();
  for (const e of expenses) {
    if (inMonth(e, last)) lastTotal += spentAmount(e);
    if (!inMonth(e, key)) continue;
    const sign = e.kind === "refund" ? -1 : 1;
    const { credits, debits } = moneyLines(e);
    const share = e.shares.find((s) => s.memberId === myId)?.amount ?? 0;
    total += spentAmount(e);
    mine += sign * share;
    if (sign > 0) paidByMe += credits.find((c) => c.memberId === myId)?.amount ?? 0;
    net += (credits.find((c) => c.memberId === myId)?.amount ?? 0) - (debits.find((d) => d.memberId === myId)?.amount ?? 0);
    const cat = getCategory(e.category).id;
    cats.set(cat, (cats.get(cat) ?? 0) + spentAmount(e));
  }
  const byCategory = [...cats].map(([id, amount]) => ({ id, amount })).filter((c) => c.amount !== 0).sort((a, b) => b.amount - a.amount);
  return { total, mine, paidByMe, net, byCategory, lastTotal };
}

// Couples: "You're ₹2,300 ahead" (you've put in more than your share).
export function aheadBehind(net: number): "ahead" | "behind" | "even" {
  return net > 0 ? "ahead" : net < 0 ? "behind" : "even";
}
