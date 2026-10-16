import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { budgetLevelsCrossed, budgetStatus } from "@/lib/home/budgets";
import { checkBudgets, saveBudgetsFor } from "@/lib/home/budgets-db";

// Monthly budgets per category: a bar, and one alert at 80% and one at 100%.

describe("budget status", () => {
  it("ok, near (80%+) or over", () => {
    const s = budgetStatus(
      [
        { category: "groceries", amount: 1000000 },
        { category: "food", amount: 500000 },
        { category: "bills", amount: 100000 },
      ],
      [
        { id: "groceries", amount: 500000 },
        { id: "food", amount: 560000 },
        { id: "bills", amount: 85000 },
      ],
    );
    expect(s.map((b) => [b.category, b.spent, b.level])).toEqual([
      ["groceries", 500000, "ok"],
      ["food", 560000, "over"],
      ["bills", 85000, "near"],
    ]);
  });
  it("levels crossed", () => {
    expect(budgetLevelsCrossed(70, 100)).toEqual([]);
    expect(budgetLevelsCrossed(85, 100)).toEqual(["80"]);
    expect(budgetLevelsCrossed(112, 100)).toEqual(["80", "100"]);
  });
});

describe("saving budgets and alerts", () => {
  let groupId = "", you = "";
  beforeAll(async () => {
    const g = await db.group.create({
      data: { name: "Us", type: "couple", currency: "INR", inviteCode: `bud-${Date.now()}`, members: { create: [{ name: "You" }, { name: "Riya" }] } },
      include: { members: true },
    });
    groupId = g.id;
    you = g.members[0].id;
  });
  afterAll(async () => {
    await db.group.delete({ where: { id: groupId } }).catch(() => {});
  });
  it("saves amounts, ignores blanks, and removes a cleared one", async () => {
    expect((await saveBudgetsFor(groupId, you, { groceries: "10000", food: "5000", bills: "" })).ok).toBe(true);
    expect((await db.budget.findMany({ where: { groupId }, orderBy: { category: "asc" } })).map((b) => [b.category, b.amount])).toEqual([
      ["food", 500000],
      ["groceries", 1000000],
    ]);
    await saveBudgetsFor(groupId, you, { groceries: "10000", food: "" });
    expect(await db.budget.count({ where: { groupId } })).toBe(1);
    expect((await saveBudgetsFor(groupId, "stranger", { food: "1" })).ok).toBe(false);
    expect((await saveBudgetsFor(groupId, you, { food: "abc" })).ok).toBe(false);
  });
  it("each level alerts once a month", async () => {
    const now = new Date();
    await db.expense.create({
      data: {
        groupId, description: "Big shop", category: "groceries", amount: 900000, paidById: you, createdById: you, splitType: "equal", forMode: "everyone",
        originalAmount: 900000, originalCurrency: "INR", baseCurrency: "INR", exchangeRate: "1", rateDate: "2026-10-16", rateSource: "same",
        convertedAmount: 900000, paymentMethod: "cash", markupBp: 0, markupAmount: 0, spentAt: now, shares: { create: [{ memberId: you, amount: 900000 }] },
      },
    });
    expect(await checkBudgets(groupId, now)).toEqual(["groceries:80"]);
    expect(await checkBudgets(groupId, now)).toEqual([]);
  });
});
