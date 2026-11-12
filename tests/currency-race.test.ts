import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { changeGroupCurrency } from "@/lib/group-changes";
import type { RateAnswer } from "@/lib/rate-cache";

// The currency change reads the group, then writes. Money added in between must not be missed: the write
// counts again inside its own transaction and refuses (asking for a rate) instead of converting wrongly.
// Every test makes its own group and erases it.

const groups: string[] = [];
afterAll(async () => {
  await eraseGroups(groups);
});
const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-11-11" });
const draft = (groupId: string, paidById: string, over: Partial<SaveExpenseInput> = {}): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "900", currency: "INR", paidById, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});
async function make() {
  const g = await db.group.create({
    data: { name: "Race flat", type: "other", currency: "INR", inviteCode: `race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, members: { create: [{ name: "A" }, { name: "B" }] } },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  groups.push(g.id);
  return { id: g.id, a: g.members.find((m) => m.name === "A")!.id };
}

describe("changing the currency while something is added at the same moment", () => {
  it("a group thought empty (rate 1) that gets an expense in the gap is refused with needsRate; nothing is converted", async () => {
    const g = await make();
    const r = await changeGroupCurrency(g.id, g.a, "USD", "1", {
      expectEmpty: true,
      afterRead: async () => {
        expect((await saveExpense(draft(g.id, g.a), g.a, rate)).ok).toBe(true); // ₹900 lands between the read and the write
      },
    });
    expect(r).toMatchObject({ ok: false, needsRate: true });
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).currency).toBe("INR");
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id } });
    expect(e.amount).toBe(90000); // still ₹900.00, not $900.00
    expect(await db.groupEvent.count({ where: { groupId: g.id, kind: "currency_changed" } })).toBe(0);
  });

  it("a group converted at a real rate that gets an expense in the gap is refused too: the new expense is not left in the old currency", async () => {
    const g = await make();
    expect((await saveExpense(draft(g.id, g.a, { name: "First" }), g.a, rate)).ok).toBe(true);
    const r = await changeGroupCurrency(g.id, g.a, "USD", "0.012", {
      afterRead: async () => {
        expect((await saveExpense(draft(g.id, g.a, { name: "Second", amount: "100" }), g.a, rate)).ok).toBe(true);
      },
    });
    expect(r.ok).toBe(false);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).currency).toBe("INR");
    expect((await db.expense.findMany({ where: { groupId: g.id }, orderBy: { amount: "asc" } })).map((e) => e.amount)).toEqual([10000, 90000]); // untouched
  });

  it("nothing added in the gap: the empty group changes at rate 1 as before", async () => {
    const g = await make();
    expect((await changeGroupCurrency(g.id, g.a, "USD", "1", { expectEmpty: true })).ok).toBe(true);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).currency).toBe("USD");
  });
});
