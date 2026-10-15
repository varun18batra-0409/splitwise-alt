import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveExpense, setExpenseDeleted, setPaymentDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { undoEvent } from "@/lib/undo";
import { changeGroupCurrency, updateGroupBasics } from "@/lib/group-changes";
import { renameMember, setMemberLeft } from "@/lib/people";
import { planKey, settleAllAndClose } from "@/lib/settle-all";
import { addRegistered } from "@/lib/invites";
import { loadGroup } from "@/lib/group-data";
import type { RateAnswer } from "@/lib/rate-cache";

// Security: someone in another group can never read-modify this group's money.
// Integrity: the same request sent twice (retry, double tap, two at once)
// changes things once.

let A = "", B = "";
let a1 = "", a2 = "", a3 = "", b1 = "";
let expenseA = "", paymentA = "", eventA = "";
const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-10-16" });
const input = (over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
  groupId: A, name: "Dinner", category: "", amount: "900", currency: "INR", paidById: a1, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});
const key = () => `test-${Math.random().toString(36).slice(2)}-${Date.now()}`;

beforeAll(async () => {
  const s = Date.now();
  const ga = await db.group.create({
    data: { name: "Sec A", currency: "INR", inviteCode: `seca-${s}`, members: { create: [{ name: "A1" }, { name: "A2" }, { name: "A3" }] } },
    include: { members: true },
  });
  const gb = await db.group.create({ data: { name: "Sec B", currency: "INR", inviteCode: `secb-${s}`, members: { create: [{ name: "B1" }] } }, include: { members: true } });
  A = ga.id; B = gb.id;
  [a1, a2, a3] = ["A1", "A2", "A3"].map((n) => ga.members.find((m) => m.name === n)!.id);
  b1 = gb.members[0].id;
  const r = await saveExpense(input({}), a1, rate);
  if (!r.ok) throw new Error(r.error);
  expenseA = r.id;
  eventA = r.eventId!;
  paymentA = (await db.payment.create({ data: { groupId: A, fromId: a2, toId: a1, amount: 10000, createdById: a2 } })).id;
});
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: [A, B] } } });
});

describe("security: an outsider (B1, from another group) can't touch group A", () => {
  it("can't add an expense to A", async () => {
    expect((await saveExpense(input({ name: "Sneaky" }), b1, rate)).ok).toBe(false);
  });
  it("can't edit A's expense through their own group", async () => {
    const r = await saveExpense(input({ groupId: B, expenseId: expenseA, paidById: b1, rateMode: "keep" }), b1, rate);
    expect(r).toEqual({ ok: false, error: "That expense no longer exists." });
  });
  it("can't delete A's expense or payment", async () => {
    expect((await setExpenseDeleted(expenseA, b1, true)).ok).toBe(false);
    expect((await setPaymentDeleted(paymentA, b1, true)).ok).toBe(false);
  });
  it("can't undo A's changes", async () => {
    expect((await undoEvent(eventA, b1)).ok).toBe(false);
  });
  it("can't rename people, remove them, change settings or currency, settle, or add people", async () => {
    expect((await renameMember(A, b1, a2, "Hacked")).ok).toBe(false);
    expect((await setMemberLeft(A, b1, a2, true)).ok).toBe(false);
    expect((await updateGroupBasics(A, b1, { name: "Hacked" })).ok).toBe(false);
    expect((await changeGroupCurrency(A, b1, "USD", "0.012")).ok).toBe(false);
    const plan = planKey((await loadGroup(A))!.transfers);
    expect((await settleAllAndClose(A, b1, plan)).ok).toBe(false);
    const acc = await db.account.create({ data: { email: `sec-${Date.now()}@example.com` } });
    expect((await addRegistered(A, b1, acc.id, "https://x")).ok).toBe(false);
    await db.account.delete({ where: { id: acc.id } });
  });
  it("after all that, A is exactly as it was", async () => {
    const g = (await loadGroup(A))!;
    expect(g.group.name).toBe("Sec A");
    expect(g.group.currency).toBe("INR");
    expect(g.expenses.map((e) => e.id)).toEqual([expenseA]);
    expect(g.payments.map((p) => p.id)).toEqual([paymentA]);
    expect(g.group.members.map((m) => m.name).sort()).toEqual(["A1", "A2", "A3"]);
  });
  it("someone who left can't add expenses", async () => {
    await db.member.update({ where: { id: a3 }, data: { leftAt: new Date() } });
    expect((await saveExpense(input({ name: "After leaving" }), a3, rate)).ok).toBe(false);
    await db.member.update({ where: { id: a3 }, data: { leftAt: null } });
  });
});

describe("integrity: retries and simultaneous requests change things once", () => {
  it("the same expense sent twice (one after the other) is saved once", async () => {
    const k = key();
    const one = await saveExpense(input({ name: "Taxi retry", amount: "300" }), a1, rate, { requestKey: k });
    const two = await saveExpense(input({ name: "Taxi retry", amount: "300" }), a1, rate, { requestKey: k });
    expect(one.ok && two.ok && one.id === two.id).toBe(true);
    expect(await db.expense.count({ where: { groupId: A, description: "Taxi retry" } })).toBe(1);
  });
  it("the same expense sent 5 times at the same moment is saved once", async () => {
    const k = key();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => saveExpense(input({ name: "Burst", amount: "600" }), a2, rate, { requestKey: k })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await db.expense.count({ where: { groupId: A, description: "Burst" } })).toBe(1);
  });
  it("an edit sent twice is applied once (no false 'someone changed it')", async () => {
    const e = await db.expense.findUniqueOrThrow({ where: { id: expenseA } });
    const v = (e.editedAt ?? e.createdAt).toISOString();
    const k = key();
    const edit = input({ expenseId: expenseA, amount: "1200", rateMode: "keep", baseVersion: v });
    const one = await saveExpense(edit, a1, rate, { requestKey: k });
    const two = await saveExpense(edit, a1, rate, { requestKey: k });
    expect(one.ok).toBe(true);
    expect(two.ok).toBe(true);
    expect(await db.groupEvent.count({ where: { expenseId: expenseA, kind: "expense_edited" } })).toBe(1);
  });
  it("two different edits at the same moment: one wins, the other is warned (no silent overwrite)", async () => {
    const e = await db.expense.findUniqueOrThrow({ where: { id: expenseA } });
    const v = (e.editedAt ?? e.createdAt).toISOString();
    const [x, y] = await Promise.all([
      saveExpense(input({ expenseId: expenseA, amount: "1500", rateMode: "keep", baseVersion: v }), a1, rate, { requestKey: key() }),
      saveExpense(input({ expenseId: expenseA, amount: "1800", rateMode: "keep", baseVersion: v }), a2, rate, { requestKey: key() }),
    ]);
    expect([x.ok, y.ok].filter(Boolean).length).toBe(1);
    const after = await db.expense.findUniqueOrThrow({ where: { id: expenseA } });
    expect([150000, 180000]).toContain(after.amount);
  });
  it("deleting twice records one deletion", async () => {
    const r = await saveExpense(input({ name: "Delete me", amount: "100" }), a1, rate);
    if (!r.ok) throw new Error(r.error);
    await Promise.all([setExpenseDeleted(r.id, a1, true), setExpenseDeleted(r.id, a2, true)]);
    await setExpenseDeleted(r.id, a1, true);
    expect(await db.groupEvent.count({ where: { expenseId: r.id, kind: "expense_deleted" } })).toBe(1);
    expect((await db.expense.findUniqueOrThrow({ where: { id: r.id } })).deletedAt).not.toBeNull();
  });
  it("undo pressed twice at once undoes once", async () => {
    const r = await saveExpense(input({ name: "Undo me", amount: "200" }), a1, rate);
    if (!r.ok) throw new Error(r.error);
    const [x, y] = await Promise.all([undoEvent(r.eventId!, a1), undoEvent(r.eventId!, a2)]);
    expect([x.ok, y.ok].filter(Boolean).length).toBe(1);
    expect(await db.groupEvent.count({ where: { expenseId: r.id, kind: "expense_deleted" } })).toBe(1);
  });
  it("'settle everything & close' sent twice at once records the payments once", async () => {
    const plan = planKey((await loadGroup(A))!.transfers);
    const before = await db.payment.count({ where: { groupId: A } });
    const n = (await loadGroup(A))!.transfers.length;
    const [x, y] = await Promise.all([settleAllAndClose(A, a1, plan), settleAllAndClose(A, a2, plan)]);
    expect([x.ok, y.ok].filter(Boolean).length).toBe(1);
    expect(await db.payment.count({ where: { groupId: A } })).toBe(before + n);
    expect((await loadGroup(A))!.transfers).toEqual([]);
  });
});
