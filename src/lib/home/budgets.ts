// Monthly budgets per category (pure).

export type BudgetLevel = "ok" | "near" | "over";

export function budgetStatus(
  budgets: { category: string; amount: number }[],
  byCategory: { id: string; amount: number }[],
): { category: string; spent: number; amount: number; level: BudgetLevel }[] {
  return budgets.map((b) => {
    const spent = byCategory.find((c) => c.id === b.category)?.amount ?? 0;
    const level: BudgetLevel = spent > b.amount ? "over" : spent * 100 >= b.amount * 80 ? "near" : "ok";
    return { category: b.category, spent, amount: b.amount, level };
  });
}

// Which alert levels this much spending has reached ("80" = 80% used, "100" = over).
export function budgetLevelsCrossed(spent: number, amount: number): ("80" | "100")[] {
  if (amount <= 0) return [];
  const out: ("80" | "100")[] = [];
  if (spent * 100 >= amount * 80) out.push("80");
  if (spent > amount) out.push("100");
  return out;
}

// The categories a home or couple usually budgets for, in this order.
export const BUDGET_CATEGORIES = ["groceries", "food", "bills", "shopping", "transport", "activities", "other"];
