import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { findLikelyDuplicate, normaliseName } from "@/lib/duplicates";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import type { RateAnswer } from "@/lib/rate-cache";

// "Looks like a duplicate": same amount, similar name or same category, within 2 days.

let groupId = "", you = "", asha = "";
const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-10-16" });
const input = (over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "3000", currency: "INR", paidById: asha, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  const g = await db.group.create({
    data: { name: "Dupes", currency: "INR", inviteCode: `dupes-${Date.now()}`, members: { create: [{ name: "You" }, { name: "Asha" }] } },
    include: { members: true },
  });
  groupId = g.id;
  you = g.members.find((m) => m.name === "You")!.id;
  asha = g.members.find((m) => m.name === "Asha")!.id;
  const r = await saveExpense(input({ date: yesterday() }), asha, rate);
  if (!r.ok) throw new Error(r.error);
});
afterAll(async () => {
  await db.group.delete({ where: { id: groupId } }).catch(() => {});
});

describe("normaliseName", () => {
  it("ignores case, spaces, order and small words", () => {
    expect(normaliseName("  Dinner at the Bastian ")).toBe(normaliseName("bastian dinner"));
    expect(normaliseName("Taxi")).not.toBe(normaliseName("Dinner"));
  });
});

describe("findLikelyDuplicate", () => {
  it("finds the same amount with a similar name a day apart", async () => {
    const hit = await findLikelyDuplicate(groupId, { amount: 300000, name: "dinner ", category: "", spentAt: new Date(), kind: "expense" });
    expect(hit?.description).toBe("Dinner");
    expect(hit?.by).toBe("Asha");
  });
  it("finds the same amount in the same category even with another name", async () => {
    const hit = await findLikelyDuplicate(groupId, { amount: 300000, name: "Pizza place", category: "food", spentAt: new Date(), kind: "expense" });
    expect(hit).not.toBeNull();
  });
  it("ignores a different amount, another category and name, or 3+ days apart", async () => {
    expect(await findLikelyDuplicate(groupId, { amount: 300100, name: "Dinner", category: "", spentAt: new Date(), kind: "expense" })).toBeNull();
    expect(await findLikelyDuplicate(groupId, { amount: 300000, name: "Cab", category: "transport", spentAt: new Date(), kind: "expense" })).toBeNull();
    expect(await findLikelyDuplicate(groupId, { amount: 300000, name: "Dinner", category: "", spentAt: new Date(Date.now() + 4 * 86_400_000), kind: "expense" })).toBeNull();
  });
  it("never flags money back", async () => {
    expect(await findLikelyDuplicate(groupId, { amount: 300000, name: "Dinner", category: "", spentAt: new Date(), kind: "refund" })).toBeNull();
  });
});

describe("saving a likely duplicate", () => {
  it("pauses with the match, and saves when told it's a different one", async () => {
    const first = await saveExpense(input({}), you, rate, { checkDuplicate: true });
    expect(first.ok).toBe(false);
    expect(!first.ok && first.duplicateOf?.description).toBe("Dinner");
    const second = await saveExpense(input({ allowDuplicate: true }), you, rate, { checkDuplicate: true });
    expect(second.ok).toBe(true);
  });
});
