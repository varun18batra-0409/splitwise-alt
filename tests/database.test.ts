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
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  groupId = g.id;
  const idOf = (name: string) => g.members.find((m) => m.name === name)!.id;
  [me, a, b] = [idOf("Me"), idOf("A"), idOf("B")];
});

afterAll(async () => {
  await db.groupEvent.deleteMany({ where: { groupId } });
  await db.payment.deleteMany({ where: { groupId } });
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

describe("closing a group and recording payments", () => {
  it("records a settle-up payment that Smart Settle then accounts for", async () => {
    const { loadGroup } = await import("@/lib/group-data");
    const before = await loadGroup(groupId);
    const firstTransfer = before!.transfers[0];
    await db.payment.create({ data: { groupId, fromId: firstTransfer.from, toId: firstTransfer.to, amount: firstTransfer.amount } });
    const after = await loadGroup(groupId);
    expect(after!.transfers.length).toBe(before!.transfers.length - 1);
    expect(Object.values(after!.net).reduce((s, v) => s + v, 0)).toBe(0);
  });

  it("refuses new expenses while a group is closed, and accepts them again after reopening", async () => {
    await db.group.update({ where: { id: groupId }, data: { closed: true, closedAt: new Date() } });
    const blocked = await saveExpense(input({ name: "Late snack" }), me, fixedRate);
    expect(blocked).toEqual({ ok: false, error: "This group is closed. Reopen it to add or change expenses." });
    await db.group.update({ where: { id: groupId }, data: { closed: false, closedAt: null } });
    expect((await saveExpense(input({ name: "Late snack" }), me, fixedRate)).ok).toBe(true);
  });
});

describe("editing, deleting and notifications", () => {
  it("only the person who added an expense can change it, every field can change, and the change is logged", async () => {
    const { setExpenseDeleted } = await import("@/lib/save-expense");
    const r = await saveExpense(input({ name: "Taxi", currency: "INR", amount: "600", paymentMethod: "cash" }), me, fixedRate);
    const id = r.ok ? r.id : "";

    // Someone else can't edit or delete it.
    expect((await saveExpense(input({ expenseId: id, name: "Taxi", currency: "INR", amount: "999" }), a, fixedRate)).ok).toBe(false);
    expect((await setExpenseDeleted(id, a, true)).ok).toBe(false);

    // The person who added it changes name, amount, payer and who it was for.
    const edit = await saveExpense(
      input({ expenseId: id, name: "Airport taxi", currency: "INR", amount: "900", paidById: a, forMode: "selected", selected: [me, a], paymentMethod: "cash" }),
      me,
      fixedRate,
    );
    expect(edit.ok).toBe(true);
    const e = await db.expense.findUniqueOrThrow({ where: { id }, include: { shares: true } });
    expect([e.description, e.amount, e.paidById, e.forMode, e.createdById, Boolean(e.editedAt)]).toEqual(["Airport taxi", 90000, a, "selected", me, true]);
    expect(e.shares.map((x) => x.amount).sort()).toEqual([45000, 45000]);

    const ev = await db.groupEvent.findFirstOrThrow({ where: { expenseId: id, kind: "expense_edited" } });
    expect(JSON.parse(ev.details)).toEqual(
      expect.arrayContaining(["Name: Taxi → Airport taxi", "Amount: ₹600 → ₹900", "Paid by: Me → A", "For: everyone → selected people"]),
    );
  });

  it("editing keeps the saved exchange rate unless asked for today's", async () => {
    const r = await saveExpense(input({ name: "Boat", amount: "1000", paymentMethod: "cash" }), me, fixedRate); // saved at 2.5
    const id = r.ok ? r.id : "";
    const newer = async (): Promise<RateAnswer> => ({ ok: true, rate: "3", date: "2026-11-01" });
    await saveExpense(input({ expenseId: id, name: "Boat trip", amount: "1000", paymentMethod: "cash", rateMode: "keep" }), me, newer);
    const kept = await db.expense.findUniqueOrThrow({ where: { id } });
    expect([kept.exchangeRate, kept.amount, kept.description]).toEqual(["2.5", 250000, "Boat trip"]);
    await saveExpense(input({ expenseId: id, name: "Boat trip", amount: "1000", paymentMethod: "cash", rateMode: "auto" }), me, newer);
    const fresh = await db.expense.findUniqueOrThrow({ where: { id } });
    expect([fresh.exchangeRate, fresh.amount, fresh.rateDate]).toEqual(["3", 300000, "2026-11-01"]);
  });

  it("deleting stops an expense counting but keeps it in history; restoring brings it back", async () => {
    const { setExpenseDeleted } = await import("@/lib/save-expense");
    const { loadGroup } = await import("@/lib/group-data");
    const r = await saveExpense(input({ name: "Snacks", currency: "INR", amount: "300", paymentMethod: "cash" }), me, fixedRate);
    const id = r.ok ? r.id : "";
    const withIt = (await loadGroup(groupId))!.net[me];

    expect((await setExpenseDeleted(id, me, true)).ok).toBe(true);
    const after = await loadGroup(groupId);
    expect(after!.net[me]).toBe(withIt - 20000); // my ₹200 lent no longer counts
    expect(after!.group.expenses.some((x) => x.id === id && x.deletedAt)).toBe(true); // still in history

    expect((await setExpenseDeleted(id, me, false)).ok).toBe(true);
    expect((await loadGroup(groupId))!.net[me]).toBe(withIt);
    const kinds = (await db.groupEvent.findMany({ where: { expenseId: id }, orderBy: { createdAt: "asc" } })).map((x) => x.kind);
    expect(kinds).toEqual(["expense_added", "expense_deleted", "expense_restored"]);
  });

  it("everyone else gets notified; you don't get notified about your own changes", async () => {
    const { loadNotifications, markNotificationsSeen } = await import("@/lib/group-data");
    await db.member.update({ where: { id: a }, data: { seenEventsAt: new Date(Date.now() - 1000) } });
    await saveExpense(input({ name: "Coffee", currency: "INR", amount: "150", paymentMethod: "cash" }), me, fixedRate);

    const forA = await loadNotifications({ [groupId]: a });
    expect(forA.unread).toBeGreaterThan(0);
    expect(forA.items[0].event.text).toContain("added Coffee");
    expect(forA.items[0].actorName).toBe("Me");

    const forMe = await loadNotifications({ [groupId]: me });
    expect(forMe.items.some((n) => n.event.text.includes("Coffee"))).toBe(false);

    await markNotificationsSeen({ [groupId]: a });
    expect((await loadNotifications({ [groupId]: a })).unread).toBe(0);
  });

  it("renaming the group and changing its currency converts everything and notifies everyone", async () => {
    const { updateGroupBasics, changeGroupCurrency } = await import("@/lib/group-changes");
    const { loadGroup } = await import("@/lib/group-data");
    expect((await updateGroupBasics(groupId, a, { name: "Test: Bangkok 2026" })).ok).toBe(true);

    const before = (await loadGroup(groupId))!;
    const ok = await changeGroupCurrency(groupId, a, "USD", "0.012");
    expect(ok.ok).toBe(true);

    const after = (await loadGroup(groupId))!;
    expect([after.group.name, after.group.currency]).toEqual(["Test: Bangkok 2026", "USD"]);
    for (const e of after.group.expenses) {
      expect(e.baseCurrency).toBe("USD");
      expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(e.amount); // still exact
    }
    // Original receipt amounts unchanged.
    expect(after.group.expenses.map((e) => [e.id, e.originalAmount, e.originalCurrency]).sort())
      .toEqual(before.group.expenses.map((e) => [e.id, e.originalAmount, e.originalCurrency]).sort());
    expect(Object.values(after.net).reduce((s, v) => s + v, 0)).toBe(0);

    const kinds = (await db.groupEvent.findMany({ where: { groupId, actorId: a } })).map((x) => x.kind);
    expect(kinds).toEqual(expect.arrayContaining(["group_renamed", "currency_changed"]));
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
      category: "food", amount: 60000, originalAmount: 60000, originalCurrency: "USD", // the group's currency by now
      convertedAmount: 60000, exchangeRate: "1", markupAmount: 0, shares: 2,
    });
  });
});
