import { afterAll, describe, expect, it, vi } from "vitest";

// UISEQ-07: the all-groups Settle page must never say "All square" while a group is left out for want of an
// exchange rate. loadOverview now says which groups those are (name and id, for a link to settle inside the group).
//
// Fixture: two rupee groups with no spending (square), and one dollar group where B owes A $100 (10000 cents).
// Rupees are the common currency (2 groups to 1); no saved rate for USD -> INR, so the dollar group is left out.
vi.mock("@/lib/rate-cache", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-cache")>()), displayRate: async () => ({ ok: false, message: "no rate" }) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { loadOverview } = await import("@/lib/overview");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groups: string[] = [];
afterAll(async () => {
  await db.expenseShare.deleteMany({ where: { expense: { groupId: { in: groups } } } });
  await db.expense.deleteMany({ where: { groupId: { in: groups } } });
  await db.group.deleteMany({ where: { id: { in: groups } } });
});

async function make(tag: string, currency: string) {
  const g = await db.group.create({
    data: { name: `Rates ${tag} ${stamp}`, inviteCode: `sk-${tag}-${stamp}`, currency, members: { create: [{ name: "A" }, { name: "B" }] } },
    include: { members: true },
  });
  groups.push(g.id);
  return { id: g.id, a: g.members.find((m) => m.name === "A")!.id, b: g.members.find((m) => m.name === "B")!.id };
}

describe("global Settle with a group left out", () => {
  it("lists the left-out group (id and name) and has no payments to show", async () => {
    const r1 = await make("inr1", "INR");
    const r2 = await make("inr2", "INR");
    const usd = await make("usd", "USD");
    // A paid $100 (10000 cents) for A and B: B owes A 5000 cents.
    await db.expense.create({
      data: { groupId: usd.id, description: "Hotel", splitType: "equal", amount: 10000, originalAmount: 10000, convertedAmount: 10000, originalCurrency: "USD", baseCurrency: "USD", paidById: usd.a, createdById: usd.a, shares: { create: [{ memberId: usd.a, amount: 5000 }, { memberId: usd.b, amount: 5000 }] } },
    });
    const out = await loadOverview({ [r1.id]: r1.a, [r2.id]: r2.a, [usd.id]: usd.a });
    expect(out.common).toBe("INR");
    expect(out.settleItems).toEqual([]);
    expect(out.skippedLinks).toEqual([{ id: usd.id, name: `Rates usd ${stamp}` }]);
    expect(out.skippedGroups).toEqual([`Rates usd ${stamp}`]);
  });
});
