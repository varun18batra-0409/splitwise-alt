import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { netBalances } from "@/lib/balances";
import type { RateAnswer } from "@/lib/rate-cache";

// Runs against the real SQLite database (run `npm run db:setup` first).
// Creates its own test group and deletes it afterwards.

let groupId = "";
let me = "", a = "", b = "";

const fixedRate = async (): Promise<RateAnswer> => ({ ok: true, rate: "2.5", date: "2026-10-14" });
const noRate = async (): Promise<RateAnswer> => ({ ok: false, reason: "unavailable", message: "No live rate" });

const input = (over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
  groupId,
  name: "Dinner",
  category: "",
  amount: "3000",
  currency: "THB",
  paidById: me,
  forMode: "everyone",
  selected: [],
  onePersonId: "",
  splitType: "equal",
  exact: {},
  percent: {},
  paymentMethod: "card",
  markupChoice: "group",
  markupCustom: "",
  rateMode: "auto",
  manualRate: "",
  ...over,
});

beforeAll(async () => {
  const g = await db.group.create({
    data: {
      name: "Test: Bangkok",
      currency: "INR",
      cardMarkupBp: 300,
      inviteCode: `test-${Date.now()}`,
      members: { create: [{ name: "Me" }, { name: "A" }, { name: "B" }] },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupId = g.id;
  [me, a, b] = g.members.map((m) => m.id);
});

afterAll(async () => {
  await db.expenseShare.deleteMany({ where: { expense: { groupId } } });
  await db.expense.deleteMany({ where: { groupId } });
  await db.member.deleteMany({ where: { groupId } });
  await db.group.delete({ where: { id: groupId } });
  await db.$disconnect();
});

describe("saving expenses to the database", () => {
  it("stores every currency detail of THB 3,000 on a card with 3% markup", async () => {
    const r = await saveExpense(input({}), me, fixedRate);
    expect(r.ok).toBe(true);
    const e = await db.expense.findUniqueOrThrow({ where: { id: r.ok ? r.id : "" }, include: { shares: true } });
    expect({
      originalAmount: e.originalAmount, originalCurrency: e.originalCurrency, baseCurrency: e.baseCurrency,
      exchangeRate: e.exchangeRate, rateDate: e.rateDate, rateSource: e.rateSource,
      convertedAmount: e.convertedAmount, paymentMethod: e.paymentMethod, markupBp: e.markupBp,
      markupAmount: e.markupAmount, amount: e.amount, category: e.category,
    }).toEqual({
      originalAmount: 300000, originalCurrency: "THB", baseCurrency: "INR",
      exchangeRate: "2.5", rateDate: "2026-10-14", rateSource: "api",
      convertedAmount: 750000, paymentMethod: "card", markupBp: 300,
      markupAmount: 22500, amount: 772500, category: "food",
    });
    expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(772500);
  });

  it("keeps the saved rate even when newer rates arrive later", async () => {
    const r = await saveExpense(input({ name: "Hotel", forMode: "one", onePersonId: a }), me, fixedRate);
    const id = r.ok ? r.id : "";
    await db.exchangeRate.create({ data: { base: "THB", quote: "INR", rate: "3.1", date: "2026-12-01" } });
    const e = await db.expense.findUniqueOrThrow({ where: { id } });
    expect([e.exchangeRate, e.amount, e.category]).toEqual(["2.5", 772500, "accommodation"]);
    await db.exchangeRate.deleteMany({ where: { rate: "3.1", date: "2026-12-01" } });
  });

  it("lets you type the rate yourself when no live rate exists", async () => {
    const blocked = await saveExpense(input({ currency: "VND", amount: "250000", paymentMethod: "cash" }), me, noRate);
    expect(blocked).toEqual({ ok: false, error: "No live rate" });

    const r = await saveExpense(
      input({ currency: "VND", amount: "250000", paymentMethod: "cash", rateMode: "manual", manualRate: "0.0035" }),
      me,
      noRate,
    );
    expect(r.ok).toBe(true);
    const e = await db.expense.findUniqueOrThrow({ where: { id: r.ok ? r.id : "" } });
    expect([e.rateSource, e.exchangeRate, e.convertedAmount, e.markupAmount, e.amount]).toEqual(["manual", "0.0035", 87500, 0, 87500]);
  });

  it("refuses people who haven't joined the group", async () => {
    expect((await saveExpense(input({}), "someone-else", fixedRate)).ok).toBe(false);
  });

  it("balances from saved expenses add up to zero", async () => {
    const expenses = await db.expense.findMany({ where: { groupId }, include: { shares: true } });
    const net = netBalances([me, a, b], expenses);
    expect(net[me] + net[a] + net[b]).toBe(0);
    // Dinner: me +7725 −2575, A −2575, B −2575 · Hotel: me +7725, A −7725 · VND: me +875 −291.67…
    expect(net[a]).toBe(-257500 - 772500 - 29167);
  });
});

describe("upgrading data saved by the older version", () => {
  it("fills in currency details and maps old categories, without losing anything", async () => {
    // Simulate an expense saved before this update (no currency details, old category name).
    const old = await db.expense.create({
      data: {
        groupId, description: "Beers", amount: 60000, splitType: "equal", category: "drinks", paidById: b,
        shares: { create: [{ memberId: a, amount: 30000 }, { memberId: b, amount: 30000 }] },
      },
    });
    execFileSync("node", ["prisma/upgrade-data.mjs"], { stdio: "pipe" });
    const e = await db.expense.findUniqueOrThrow({ where: { id: old.id }, include: { shares: true } });
    expect({
      category: e.category, amount: e.amount, originalAmount: e.originalAmount, originalCurrency: e.originalCurrency,
      convertedAmount: e.convertedAmount, exchangeRate: e.exchangeRate, markupAmount: e.markupAmount, shares: e.shares.length,
    }).toEqual({
      category: "food", amount: 60000, originalAmount: 60000, originalCurrency: "INR",
      convertedAmount: 60000, exchangeRate: "1", markupAmount: 0, shares: 2,
    });
  });
});
