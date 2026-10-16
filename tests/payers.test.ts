import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { netBalances } from "@/lib/balances";
import { moneyLines, parsePayers, payersLabel, payersOf } from "@/lib/payers";
import { buildExpense, type ExpenseDraft } from "@/lib/expense";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { undoEvent } from "@/lib/undo";
import { isMemberUsed } from "@/lib/people";
import { loadGroup } from "@/lib/group-data";
import { changeGroupCurrency } from "@/lib/group-changes";
import { removeMembers } from "@/lib/undo";
import type { RateAnswer } from "@/lib/rate-cache";

// More than one person paying for one expense.

const twoPayers = JSON.stringify([{ m: "you", a: 200000 }, { m: "asha", a: 100000 }]);
const dinner = {
  paidById: "you",
  amount: 300000,
  payers: twoPayers,
  shares: [{ memberId: "you", amount: 112500 }, { memberId: "asha", amount: 93750 }, { memberId: "rohan", amount: 93750 }],
};

describe("payersOf / moneyLines", () => {
  it("a single payer (no list saved) works exactly as before", () => {
    expect(payersOf({ paidById: "you", amount: 5000, payers: "" })).toEqual([{ memberId: "you", amount: 5000 }]);
    expect(payersOf({ paidById: "you", amount: 5000 })).toEqual([{ memberId: "you", amount: 5000 }]);
  });
  it("reads a saved list, and ignores a broken one", () => {
    expect(parsePayers(twoPayers)).toEqual([{ memberId: "you", amount: 200000 }, { memberId: "asha", amount: 100000 }]);
    expect(parsePayers("not json")).toEqual([]);
  });
  it("credits each payer and debits each share", () => {
    const l = moneyLines(dinner);
    expect(l.credits).toEqual([{ memberId: "you", amount: 200000 }, { memberId: "asha", amount: 100000 }]);
    expect(l.debits).toEqual(dinner.shares);
  });
  it("balances: You +875, Asha +62.50, Rohan −937.50, adding up to zero", () => {
    const net = netBalances(["you", "asha", "rohan"], [dinner]);
    expect(net).toEqual({ you: 87500, asha: 6250, rohan: -93750 });
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it("labels the payers", () => {
    expect(payersLabel(payersOf(dinner), (id) => (id === "you" ? "You" : "Asha"))).toBe("You + Asha");
  });
});

const draft = (over: Partial<ExpenseDraft>): ExpenseDraft => ({
  amount: "3000", currency: "INR", paidById: "you", forMode: "everyone", selected: [], onePersonId: "",
  splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", ...over,
});
const ctx = { memberIds: ["you", "asha", "rohan"], baseCurrency: "INR", groupMarkupBp: 0, rate: "1" };

describe("buildExpense with more than one payer", () => {
  it("payers must add up to the total", () => {
    const r = buildExpense(draft({ multiPay: true, payers: { you: "1500", asha: "1000" } }), ctx);
    expect(r).toEqual({ ok: false, error: "The payers add up to ₹2,500, but the total is ₹3,000." });
  });
  it("the biggest payer becomes the main payer", () => {
    const r = buildExpense(draft({ multiPay: true, payers: { you: "1000", asha: "2000" } }), ctx);
    expect(r.ok && r.expense.paidById).toBe("asha");
    expect(r.ok && r.expense.payers).toEqual([{ memberId: "you", amount: 100000 }, { memberId: "asha", amount: 200000 }]);
  });
  it("a foreign card expense converts the payers exactly (THB 600 + 400 at 2.5 with 3%)", () => {
    const r = buildExpense(
      draft({ amount: "1000", currency: "THB", paymentMethod: "card", multiPay: true, payers: { you: "600", asha: "400" } }),
      { ...ctx, groupMarkupBp: 300, rate: "2.5" },
    );
    expect(r.ok && r.expense.amount).toBe(257500);
    expect(r.ok && r.expense.payers).toEqual([{ memberId: "you", amount: 154500 }, { memberId: "asha", amount: 103000 }]);
  });
  it("one payer ticked under 'More than one' is just a normal expense", () => {
    const r = buildExpense(draft({ multiPay: true, payers: { you: "3000" } }), ctx);
    expect(r.ok && r.expense.payers).toEqual([]);
    expect(r.ok && r.expense.paidById).toBe("you");
  });
});

describe("saved with more than one payer", () => {
  let groupId = "", you = "", asha = "", rohan = "";
  const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-10-16" });
  const input = (over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
    groupId, name: "Dinner", category: "", amount: "3000", currency: "INR", paidById: you, forMode: "everyone",
    selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
    markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
  });
  beforeAll(async () => {
    const g = await db.group.create({
      data: { name: "Payers", currency: "INR", inviteCode: `payers-${Date.now()}`, members: { create: [{ name: "You" }, { name: "Asha" }, { name: "Rohan" }] } },
      include: { members: true },
    });
    groupId = g.id;
    const id = (n: string) => g.members.find((m) => m.name === n)!.id;
    [you, asha, rohan] = [id("You"), id("Asha"), id("Rohan")];
  });
  afterAll(async () => {
    await db.group.delete({ where: { id: groupId } }).catch(() => {});
  });

  it("balances count every payer", async () => {
    const r = await saveExpense(input({ multiPay: true, payers: { [you]: "2000", [asha]: "1000" } }), you, rate);
    expect(r.ok).toBe(true);
    const net = (await loadGroup(groupId))!.net;
    expect(net[you]).toBe(100000);
    expect(net[asha]).toBe(0);
    expect(net[rohan]).toBe(-100000);
  });

  it("someone who only paid a smaller part (no share) still counts as used, so can't be removed", async () => {
    const g = await db.member.create({ data: { name: "Guest", groupId } });
    await saveExpense(input({ name: "Cab", forMode: "selected", selected: [you, asha], multiPay: true, payers: { [you]: "2000", [g.id]: "1000" } }), you, rate);
    const cab = await db.expense.findFirstOrThrow({ where: { groupId, description: "Cab" } });
    expect(cab.paidById).toBe(you); // so only the payer list mentions the guest
    expect(await isMemberUsed(g.id)).toBe(true);
    const r = await removeMembers(groupId, you, [g.id], false);
    expect(r.ok).toBe(false);
  });

  it("undoing an edit that changed the payers puts the old payers back", async () => {
    const r = await saveExpense(input({ name: "Groceries", multiPay: true, payers: { [you]: "1500", [asha]: "1500" } }), you, rate);
    if (!r.ok) throw new Error(r.error);
    const e = await db.expense.findUniqueOrThrow({ where: { id: r.id } });
    const edit = await saveExpense(
      input({ name: "Groceries", expenseId: r.id, baseVersion: (e.editedAt ?? e.createdAt).toISOString(), rateMode: "keep", multiPay: false, paidById: rohan }),
      you,
      rate,
    );
    if (!edit.ok) throw new Error(edit.error);
    expect((await db.expense.findUniqueOrThrow({ where: { id: r.id } })).payers).toBe("");
    const u = await undoEvent(edit.eventId ?? "", you);
    expect(u.ok).toBe(true);
    const back = await db.expense.findUniqueOrThrow({ where: { id: r.id } });
    expect(parsePayers(back.payers)).toEqual([{ memberId: you, amount: 150000 }, { memberId: asha, amount: 150000 }]);
  });
});

describe("changing the group currency with more than one payer", () => {
  it("converts every payer's part too, and undo puts them back exactly", async () => {
    const rate1 = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-10-16" });
    const g = await db.group.create({
      data: { name: "Fx", currency: "INR", inviteCode: `fx-${Date.now()}`, members: { create: [{ name: "You" }, { name: "Asha" }, { name: "Rohan" }] } },
      include: { members: true },
    });
    const [you, asha] = [g.members.find((m) => m.name === "You")!.id, g.members.find((m) => m.name === "Asha")!.id];
    const r = await saveExpense(
      {
        groupId: g.id, name: "Dinner", category: "", amount: "3000", currency: "INR", paidById: you, forMode: "everyone", selected: [], onePersonId: "",
        splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "",
        multiPay: true, payers: { [you]: "2000", [asha]: "1000" },
      },
      you,
      rate1,
    );
    if (!r.ok) throw new Error(r.error);
    const changed = await changeGroupCurrency(g.id, you, "USD", "0.012");
    expect(changed.ok).toBe(true);
    const e = await db.expense.findUniqueOrThrow({ where: { id: r.id } });
    const payers = parsePayers(e.payers);
    expect(payers.reduce((s, p) => s + p.amount, 0)).toBe(e.amount);
    expect(payers).toEqual([{ memberId: you, amount: 2400 }, { memberId: asha, amount: 1200 }]);
    const net = (await loadGroup(g.id))!.net;
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
    expect(net[you]).toBe(1200);
    if (!changed.ok || !changed.eventId) throw new Error("no event");
    const u = await undoEvent(changed.eventId, you);
    expect(u.ok).toBe(true);
    const back = await db.expense.findUniqueOrThrow({ where: { id: r.id } });
    expect(parsePayers(back.payers)).toEqual([{ memberId: you, amount: 200000 }, { memberId: asha, amount: 100000 }]);
    await db.group.delete({ where: { id: g.id } });
  });
  it("payersOf never trusts a list that doesn't add up (scales it to the total)", () => {
    expect(payersOf({ paidById: "a", amount: 3600, payers: JSON.stringify([{ m: "a", a: 200000 }, { m: "b", a: 100000 }]) })).toEqual([
      { memberId: "a", amount: 2400 },
      { memberId: "b", amount: 1200 },
    ]);
  });
});
