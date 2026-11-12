import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { RECEIPT_GONE, saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import type { RateAnswer } from "@/lib/rate-cache";

// An expense, its item lines and its bill photo are saved together or not at all.
//
// Hand-worked: Dinner ₹1,000 (100000) paid by A, split by item:
//   Pizza 60000 shared by A and B  -> 30000 each
//   Beer  40000 for B only         -> 40000 to B
//   so A's share = 30000, B's share = 30000 + 40000 = 70000, total 100000.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
let groupId = "", otherGroupId = "";
let a = "", b = "";
const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-10-14" });
const input = (over: Partial<SaveExpenseInput> = {}): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "1000", currency: "INR", paidById: a, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "exact", exact: { [a]: "300", [b]: "700" }, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});
const lines = () => [
  { name: "Pizza", amount: 60000, people: [a, b] },
  { name: "Beer", amount: 40000, people: [b] },
];
const photo = (gid: string, blobKey = "") => db.receipt.create({ data: { groupId: gid, data: Buffer.from("photo"), blobKey } });
const expenseCount = () => db.expense.count({ where: { groupId } });

beforeAll(async () => {
  const mk = async (tag: string) => {
    const g = await db.group.create({
      data: { name: `Atomic ${tag} ${stamp}`, currency: "INR", inviteCode: `at-${tag}-${stamp}`, members: { create: [{ name: "A" }, { name: "B" }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    return g;
  };
  const g = await mk("main");
  groupId = g.id;
  a = g.members.find((m) => m.name === "A")!.id;
  b = g.members.find((m) => m.name === "B")!.id;
  otherGroupId = (await mk("other")).id;
});

afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await db.blobTrash.deleteMany({ where: { key: { contains: stamp } } });
  await db.receipt.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.groupEvent.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.expenseItem.deleteMany({ where: { expense: { groupId: { in: groupIds } } } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId: { in: groupIds } } } });
  await db.expense.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.member.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("expense + item lines + bill photo", () => {
  it("1. a new save: one expense, two item lines, the photo linked, shares add up to 100000", async () => {
    const r1 = await photo(groupId);
    const res = await saveExpense(input(), a, rate, { requestKey: `at-one-${stamp}`, attach: { items: lines(), receiptId: r1.id } });
    if (!res.ok) throw new Error(res.error);
    expect(await expenseCount()).toBe(1);
    const items = await db.expenseItem.findMany({ where: { expenseId: res.id }, orderBy: { position: "asc" } });
    expect(items.map((i) => [i.name, i.amount, JSON.parse(i.people)])).toEqual([["Pizza", 60000, [a, b]], ["Beer", 40000, [b]]]);
    expect((await db.receipt.findUniqueOrThrow({ where: { id: r1.id } })).expenseId).toBe(res.id);
    const shares = await db.expenseShare.findMany({ where: { expenseId: res.id } });
    const of = (id: string) => shares.find((s) => s.memberId === id)?.amount;
    expect([of(a), of(b)]).toEqual([30000, 70000]);
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(100000);
  });

  it("2. a photo from another group: refused, nothing saved (no expense, no lines, no key)", async () => {
    await db.expense.deleteMany({ where: { groupId } }); // start clean (items and shares cascade)
    const foreign = await photo(otherGroupId);
    const key = `at-foreign-${stamp}`;
    const res = await saveExpense(input(), a, rate, { requestKey: key, attach: { items: lines(), receiptId: foreign.id } });
    expect(res).toEqual({ ok: false, error: RECEIPT_GONE });
    expect(await expenseCount()).toBe(0);
    expect(await db.expenseItem.count({ where: { expense: { groupId } } })).toBe(0);
    expect(await db.requestKey.count({ where: { key } })).toBe(0);
    expect((await db.receipt.findUniqueOrThrow({ where: { id: foreign.id } })).expenseId).toBe(""); // untouched
  });

  it("3. a photo cleaned up before saving: the same, and the same key can be used again afterwards", async () => {
    const gone = await photo(groupId);
    await db.receipt.delete({ where: { id: gone.id } });
    const key = `at-gone-${stamp}`;
    const res = await saveExpense(input(), a, rate, { requestKey: key, attach: { items: lines(), receiptId: gone.id } });
    expect(res).toEqual({ ok: false, error: RECEIPT_GONE });
    expect(await expenseCount()).toBe(0);
    expect(await db.expenseItem.count({ where: { expense: { groupId } } })).toBe(0);
    expect(await db.requestKey.count({ where: { key } })).toBe(0);
    // The person adds the photo again and saves with the same form key: it works.
    const fresh = await photo(groupId);
    const ok = await saveExpense(input(), a, rate, { requestKey: key, attach: { items: lines(), receiptId: fresh.id } });
    expect(ok.ok).toBe(true);
    expect(await expenseCount()).toBe(1);
  });

  it("4. editing with a new photo (nothing else changed): the old photo row is gone, its file is on the to-delete list, the new one is linked", async () => {
    await db.expense.deleteMany({ where: { groupId } });
    const oldKey = `receipt/old-${stamp}`;
    const old = await photo(groupId, oldKey);
    const first = await saveExpense(input(), a, rate, { requestKey: `at-edit1-${stamp}`, attach: { items: lines(), receiptId: old.id } });
    if (!first.ok) throw new Error(first.error);
    const next = await photo(groupId, `receipt/new-${stamp}`);
    const edit = await saveExpense(input({ expenseId: first.id }), a, rate, { requestKey: `at-edit2-${stamp}`, attach: { items: lines(), receiptId: next.id } });
    expect(edit.ok).toBe(true);
    expect(await db.receipt.count({ where: { id: old.id } })).toBe(0);
    expect(await db.blobTrash.count({ where: { key: oldKey } })).toBe(1);
    expect((await db.receipt.findUniqueOrThrow({ where: { id: next.id } })).expenseId).toBe(first.id);
    expect(await db.expenseItem.count({ where: { expenseId: first.id } })).toBe(2); // identical lines: still two
    // "remove" takes the photo away and queues its file too.
    const gone = await saveExpense(input({ expenseId: first.id }), a, rate, { attach: { receiptId: "remove" } });
    expect(gone.ok).toBe(true);
    expect(await db.receipt.count({ where: { groupId, expenseId: first.id } })).toBe(0);
    expect(await db.blobTrash.count({ where: { key: `receipt/new-${stamp}` } })).toBe(1);
  });

  it("4b. editing only the item lines (nothing else changed) saves them", async () => {
    await db.expense.deleteMany({ where: { groupId } });
    const first = await saveExpense(input(), a, rate, { attach: { items: lines() } });
    if (!first.ok) throw new Error(first.error);
    const edit = await saveExpense(input({ expenseId: first.id }), a, rate, { attach: { items: [{ name: "Pizza", amount: 60000, people: [a, b] }, { name: "Beer and more", amount: 40000, people: [b] }] } });
    expect(edit.ok).toBe(true);
    expect((await db.expenseItem.findMany({ where: { expenseId: first.id } })).map((i) => i.name).sort()).toEqual(["Beer and more", "Pizza"]);
    // [] means "not split by item any more".
    await saveExpense(input({ expenseId: first.id }), a, rate, { attach: { items: [] } });
    expect(await db.expenseItem.count({ where: { expenseId: first.id } })).toBe(0);
  });

  it("5. the same key again: same expense, still two lines and one photo", async () => {
    await db.expense.deleteMany({ where: { groupId } });
    await db.receipt.deleteMany({ where: { groupId } });
    const key = `at-twice-${stamp}`;
    const r = await photo(groupId);
    const one = await saveExpense(input(), a, rate, { requestKey: key, attach: { items: lines(), receiptId: r.id } });
    const two = await saveExpense(input(), a, rate, { requestKey: key, attach: { items: lines(), receiptId: r.id } });
    if (!one.ok || !two.ok) throw new Error("save failed");
    expect(two.id).toBe(one.id);
    expect(await expenseCount()).toBe(1);
    expect(await db.expenseItem.count({ where: { expenseId: one.id } })).toBe(2);
    expect(await db.receipt.count({ where: { groupId, expenseId: one.id } })).toBe(1);
  });
});

describe("LC-04: item lines must agree with the shares", () => {
  it("INR 1000 with exact A300/B700 and one 100000 item for [A,B] is refused; nothing is saved", async () => {
    await db.expense.deleteMany({ where: { groupId } });
    // The item splits 100000 as 50000 / 50000, but the shares say 30000 / 70000.
    const bad = await saveExpense(input(), a, rate, { attach: { items: [{ name: "Everything", amount: 100000, people: [a, b] }] } });
    expect(bad.ok).toBe(false);
    expect(await expenseCount()).toBe(0);
  });
  it("500/500 with the same item is accepted, and the shares are 50000 each", async () => {
    await db.expense.deleteMany({ where: { groupId } });
    const good = await saveExpense(input({ exact: { [a]: "500", [b]: "500" } }), a, rate, { attach: { items: [{ name: "Everything", amount: 100000, people: [a, b] }] } });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    const shares = await db.expenseShare.findMany({ where: { expenseId: good.id } });
    expect(Object.fromEntries(shares.map((x) => [x.memberId, x.amount]))).toEqual({ [a]: 50000, [b]: 50000 });
  });
  it("items that add up to more than the bill are refused", async () => {
    await db.expense.deleteMany({ where: { groupId } });
    const bad = await saveExpense(input({ exact: { [a]: "500", [b]: "500" } }), a, rate, { attach: { items: [{ name: "Too much", amount: 150000, people: [a, b] }] } });
    expect(bad.ok).toBe(false);
    expect(await expenseCount()).toBe(0);
  });
});
