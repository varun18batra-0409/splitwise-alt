import { db } from "../db";
import { parseAmount, formatMoney } from "../money";
import { getCategory } from "../categories";
import { logEvent } from "../events";
import { claimOnce, sendPushTo } from "../push";
import { DEFAULT_TIME_ZONE } from "../dates";
import { BUDGET_CATEGORIES, budgetLevelsCrossed, budgetStatus } from "./budgets";
import { monthSummary } from "./summary";
import { monthKey } from "./month";

type Result = { ok: true } | { ok: false; error: string };

// Save the budget amounts (blank = no budget for that category).
export async function saveBudgetsFor(groupId: string, actorId: string, amounts: Record<string, string>): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can change budgets." };
  const set: { category: string; amount: number }[] = [];
  const clear: string[] = [];
  for (const [category, raw] of Object.entries(amounts)) {
    if (!BUDGET_CATEGORIES.includes(category)) continue;
    if (!raw.trim()) {
      clear.push(category);
      continue;
    }
    const amount = parseAmount(raw, group.currency);
    if (amount === null || amount <= 0) return { ok: false, error: `Enter ${getCategory(category).label} as a number, like 5000.` };
    set.push({ category, amount });
  }
  await db.$transaction(async (tx) => {
    await tx.budget.deleteMany({ where: { groupId, category: { in: clear } } });
    for (const b of set) await tx.budget.upsert({ where: { groupId_category: { groupId, category: b.category } }, create: { groupId, ...b }, update: { amount: b.amount } });
    await logEvent(tx, {
      groupId,
      actorId,
      kind: "bill_changed",
      text: "updated the monthly budgets",
      details: set.map((b) => `${getCategory(b.category).label}: ${formatMoney(b.amount, group.currency)}`),
    });
  });
  return { ok: true };
}

// This month's budgets for a group, with what's been spent.
export async function budgetsNow(groupId: string, expenses: Parameters<typeof monthSummary>[0], myId: string, tz: string, now = new Date()) {
  const budgets = await db.budget.findMany({ where: { groupId } });
  if (!budgets.length) return [];
  const s = monthSummary(expenses, myId, monthKey(now, tz), tz);
  return budgetStatus(
    BUDGET_CATEGORIES.flatMap((c) => budgets.filter((b) => b.category === c)),
    s.byCategory,
  );
}

// Tell everyone when a budget reaches 80% and when it goes over — once per month each.
// Returns what was sent ("groceries:80").
export async function checkBudgets(groupId: string, now = new Date()): Promise<string[]> {
  const budgets = await db.budget.findMany({ where: { groupId } });
  if (!budgets.length) return [];
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: { where: { leftAt: null }, select: { id: true } }, expenses: { where: { deletedAt: null }, include: { shares: true } } },
  });
  if (!group || group.deletedAt) return [];
  const month = monthKey(now, DEFAULT_TIME_ZONE);
  const s = monthSummary(group.expenses, "", month, DEFAULT_TIME_ZONE);
  const sent: string[] = [];
  for (const b of budgetStatus(budgets, s.byCategory)) {
    for (const level of budgetLevelsCrossed(b.spent, b.amount)) {
      if (!(await claimOnce(`budget:${groupId}:${b.category}:${month}:${level}`))) continue;
      const label = getCategory(b.category).label;
      const money = (n: number) => formatMoney(n, group.currency);
      await sendPushTo(
        group.members.map((m) => m.id),
        {
          title: `📊 ${group.name}`,
          body: level === "100" ? `${label} is over budget: ${money(b.spent)} of ${money(b.amount)} this month.` : `${label} is at ${Math.round((b.spent * 100) / b.amount)}% of this month’s budget (${money(b.spent)} of ${money(b.amount)}).`,
          url: `/groups/${groupId}`,
          tag: `budget-${groupId}-${b.category}`,
        },
      );
      sent.push(`${b.category}:${level}`);
    }
  }
  return sent;
}
