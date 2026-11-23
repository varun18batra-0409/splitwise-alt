import { afterAll, describe, expect, it, vi } from "vitest";

// Batch 2 of the outside-review fixes (G27): Settle up across groups makes one card per person AND currency, and the server refuses a
// bundle that mixes currencies. Throwaway database. Money is whole minor units (cents for USD, paise for INR), worked out by hand.
//
// The cast: me (Varun) and Asha, the same two accounts in every group. The display currency is INR; the test rate is 1 cent = 84 paise.

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { loadMyGroups } = await import("@/lib/group-data");
const { crossSettle, isEvenItem, crossPreview, settleRowId } = await import("@/lib/cross-settle");
const { settleAcrossCore } = await import("@/lib/cross-settle-db");
const { checkBooks } = await import("./helpers/money-invariants");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
const key = () => `xc-${stamp}-${++n}-abcdefgh`;
const rate = (amount: number, currency: string) => (currency === "USD" ? amount * 84 : null);

afterAll(async () => {
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `xc-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a.id;
}

async function world() {
  const [meAcc, ashaAcc] = [await account("Varun"), await account("Asha")];
  const group = async (name: string, currency: string) => {
    const g = await db.group.create({
      data: {
        name: `${name} ${++n} ${stamp}`, currency, inviteCode: `xc-${n}-${stamp}`,
        members: { create: [{ name: "Varun", accountId: meAcc, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Asha", accountId: ashaAcc, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) }] },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    return { id: g.id, me: g.members.find((m) => m.name === "Varun")!.id, asha: g.members.find((m) => m.name === "Asha")!.id };
  };
  return { group };
}
type G = Awaited<ReturnType<Awaited<ReturnType<typeof world>>["group"]>>;

// One expense of `amount` split half and half (the amount is even, so the shares add up exactly). `payer` pays; the other owes half.
const spend = (g: G, currency: string, amount: number, payer: "me" | "asha", description: string) => {
  expect(amount % 2).toBe(0);
  return db.expense.create({
    data: {
      groupId: g.id, description, category: "other", amount, paidById: payer === "me" ? g.me : g.asha, createdById: payer === "me" ? g.me : g.asha, splitType: "exact", forMode: "selected",
      originalAmount: amount, originalCurrency: currency, baseCurrency: currency, convertedAmount: amount, spentAt: new Date("2026-11-01T12:00:00Z"),
      shares: { create: [{ memberId: g.me, amount: amount / 2 }, { memberId: g.asha, amount: amount / 2 }] },
    },
  });
};

async function itemsFor(gs: G[]) {
  const mine = await loadMyGroups(Object.fromEntries(gs.map((g) => [g.id, g.me])));
  return crossSettle(mine.map((g) => ({ groupId: g.group.id, groupName: g.group.name, currency: g.group.currency, myId: g.myId, members: g.group.members, transfers: g.transfers })), "INR", rate).items;
}
const payments = (gid: string) => db.payment.findMany({ where: { groupId: gid, deletedAt: null } });

describe("G27: one card per person and currency", () => {
  // G1 (USD): Asha pays 10,000 cents for both: 5,000 + 5,000. I owe Asha 5,000 cents.
  // G2 (INR): I pay 840,000 paise for both: 420,000 + 420,000. Asha owes me 420,000 paise.
  // At 84 paise per cent, 5,000 cents is 420,000 paise: the old code netted them to 0 and called them even. Now they are two cards.
  async function mixed() {
    const w = await world();
    const g1 = await w.group("Trip", "USD");
    const g2 = await w.group("Flat", "INR");
    await spend(g1, "USD", 10000, "asha", "Hotel");
    await spend(g2, "INR", 840000, "me", "Groceries");
    return { g1, g2 };
  }

  it("shows two cards, USD -5,000 and INR +420,000, and neither is even", async () => {
    const { g1, g2 } = await mixed();
    const items = await itemsFor([g1, g2]);
    expect(items).toHaveLength(2);
    const usd = items.find((i) => i.currency === "USD")!;
    const inr = items.find((i) => i.currency === "INR")!;
    expect(usd.netOwn).toBe(-5000);
    expect(inr.netOwn).toBe(420000);
    expect(usd.net).toBe(-420000); // for sorting and the "≈" totals only
    expect(items.some(isEvenItem)).toBe(false);
    expect(usd.mixed && inr.mixed).toBe(true);
    // The display-currency card keeps the old anchor (Home links to it); the other one gets the currency added.
    expect(inr.id).toBe(inr.key);
    expect(usd.id).toBe(`${usd.key}|USD`);
    expect(settleRowId("pay", usd.id)).not.toBe(settleRowId("pay", inr.id));
    // The USD card's total is exact in dollars, never converted.
    expect(crossPreview(usd, "INR").total).toBe("Together: you pay Asha $50");
    expect(crossPreview(inr, "INR").total).toBe("Together: Asha pays you ₹4,200");
  });

  it("recording the USD card writes one payment of 5,000 in the USD group only; the INR group is untouched", async () => {
    const { g1, g2 } = await mixed();
    const usd = (await itemsFor([g1, g2])).find((i) => i.currency === "USD")!;
    const parts = usd.parts.map((p) => ({ groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount }));
    expect(await settleAcrossCore(parts, { [g1.id]: g1.me, [g2.id]: g2.me }, key())).toBe("done");
    expect((await payments(g1.id)).map((p) => [p.fromId, p.toId, p.amount])).toEqual([[g1.me, g1.asha, 5000]]);
    expect(await payments(g2.id)).toHaveLength(0);
    expect(await checkBooks(g1.id)).toEqual({ [g1.me]: 0, [g1.asha]: 0 });
    expect(await checkBooks(g2.id)).toEqual({ [g2.me]: 420000, [g2.asha]: -420000 }); // sums to 0
  });

  it("a bundle that mixes the two currencies, built by hand, is refused and records nothing", async () => {
    const { g1, g2 } = await mixed();
    const parts = [
      { groupId: g1.id, fromId: g1.me, toId: g1.asha, amount: 5000 },
      { groupId: g2.id, fromId: g2.asha, toId: g2.me, amount: 420000 },
    ];
    expect(await settleAcrossCore(parts, { [g1.id]: g1.me, [g2.id]: g2.me }, key())).toBe("error");
    expect(await payments(g1.id)).toHaveLength(0);
    expect(await payments(g2.id)).toHaveLength(0);
    await checkBooks(g1.id);
    await checkBooks(g2.id);
  });

  it("two groups in the same currency are still netted: 5,000 owed and 3,000 owed back is one card of -2,000, and recording clears both", async () => {
    const w = await world();
    const g1 = await w.group("Trip", "USD");
    const g3 = await w.group("Cabin", "USD");
    await spend(g1, "USD", 10000, "asha", "Hotel"); // I owe Asha 5,000
    await spend(g3, "USD", 6000, "me", "Food"); // Asha owes me 3,000
    const items = await itemsFor([g1, g3]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ currency: "USD", netOwn: -2000, mixed: false });
    expect(items[0].id).toBe(items[0].key);
    const parts = items[0].parts.map((p) => ({ groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount }));
    expect(await settleAcrossCore(parts, { [g1.id]: g1.me, [g3.id]: g3.me }, key())).toBe("done");
    expect((await payments(g1.id)).map((p) => p.amount)).toEqual([5000]);
    expect((await payments(g3.id)).map((p) => p.amount)).toEqual([3000]);
    expect(await checkBooks(g1.id)).toEqual({ [g1.me]: 0, [g1.asha]: 0 });
    expect(await checkBooks(g3.id)).toEqual({ [g3.me]: 0, [g3.asha]: 0 });
  });

  it("even in one currency: -5,000 and +5,000 is an even card, and Clear both leaves both groups at 0", async () => {
    const w = await world();
    const g1 = await w.group("Trip", "USD");
    const g4 = await w.group("Cabin", "USD");
    await spend(g1, "USD", 10000, "asha", "Hotel"); // I owe Asha 5,000
    await spend(g4, "USD", 10000, "me", "Food"); // Asha owes me 5,000
    const items = await itemsFor([g1, g4]);
    expect(items).toHaveLength(1);
    expect(items[0].netOwn).toBe(0);
    expect(isEvenItem(items[0])).toBe(true);
    const parts = items[0].parts.map((p) => ({ groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount }));
    expect(await settleAcrossCore(parts, { [g1.id]: g1.me, [g4.id]: g4.me }, key())).toBe("done");
    expect(await checkBooks(g1.id)).toEqual({ [g1.me]: 0, [g1.asha]: 0 });
    expect(await checkBooks(g4.id)).toEqual({ [g4.me]: 0, [g4.asha]: 0 });
  });
});
