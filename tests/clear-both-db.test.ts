import { afterAll, describe, expect, it, vi } from "vitest";

// "Clear both" on the all-groups Settle page for someone you are even with across groups. It records through the SAME path as
// "Record payment" (settleAcrossCore: linked parts, `across`, the same guards), so no new money logic. Throwaway database; paise, worked by hand.
//
//   Flat:   Asha paid Dinner 100000, all of it Ravi's share. Ravi owes Asha 100000 (Ravi net -100000, Asha +100000).
//   Trip:   Ravi paid Taxi 100000, all of it Asha's share.   Asha owes Ravi 100000 (Ravi net +100000, Asha -100000).
//   Ravi's one item: -100000 + 100000 = 0, two parts. Clear both records both parts, and every person in both groups ends at 0.

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { settleAcrossCore } = await import("@/lib/cross-settle-db");
const { crossSettle, isEvenItem, evenCaption } = await import("@/lib/cross-settle");
const { parseUndo } = await import("@/lib/events");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
afterAll(async () => {
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `cb-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}
async function group(name: string, type: string, people: { name: string; accountId: string }[]) {
  const g = await db.group.create({
    data: { name: `${name} ${stamp}`, type, currency: "INR", inviteCode: `cb-${++n}-${stamp}`, members: { create: people.map((p, i) => ({ name: p.name, splitWeight: 100, createdAt: new Date(2026, 0, i + 1), accountId: p.accountId, claimedAt: new Date(2026, 0, i + 1) })) } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, name: g.name, member: (nm: string) => g.members.find((m) => m.name === nm)!.id };
}
const spend = (groupId: string, description: string, amount: number, paidById: string, forId: string) =>
  db.expense.create({
    data: { groupId, description, category: "other", amount, paidById, createdById: paidById, splitType: "exact", forMode: "selected", originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, spentAt: new Date("2026-11-01T12:00:00Z"), shares: { create: [{ memberId: forId, amount }] } },
  });
async function netOf(groupId: string) {
  const x = await db.group.findUniqueOrThrow({ where: { id: groupId }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
  return netBalances(x.members.map((m) => m.id), x.expenses, x.payments);
}

describe("Clear both: even across groups", () => {
  it("is one even item with two opposite parts, and Clear both records linked parts that net everyone to 0", async () => {
    const [aAcc, rAcc] = [await account("Asha"), await account("Ravi")];
    const flat = await group("Flat", "home", [{ name: "Asha", accountId: aAcc.id }, { name: "Ravi", accountId: rAcc.id }]);
    const trip = await group("Trip", "trip", [{ name: "Asha", accountId: aAcc.id }, { name: "Ravi", accountId: rAcc.id }]);
    const [Af, Rf, At, Rt] = [flat.member("Asha"), flat.member("Ravi"), trip.member("Asha"), trip.member("Ravi")];
    await spend(flat.id, "Dinner", 100000, Af, Rf);
    await spend(trip.id, "Taxi", 100000, Rt, At);
    expect(await netOf(flat.id)).toEqual({ [Af]: 100000, [Rf]: -100000 });
    expect(await netOf(trip.id)).toEqual({ [Rt]: 100000, [At]: -100000 });

    // What the Settle page builds from the groups: one item for Asha with net 0 (so "Even across groups", not "To pay").
    const { items } = crossSettle(
      [
        { groupId: flat.id, groupName: flat.name, currency: "INR", myId: Rf, members: [{ id: Af, name: "Asha", phone: "", accountId: aAcc.id }, { id: Rf, name: "Ravi", phone: "", accountId: rAcc.id }], transfers: [{ from: Rf, to: Af, amount: 100000 }] },
        { groupId: trip.id, groupName: trip.name, currency: "INR", myId: Rt, members: [{ id: At, name: "Asha", phone: "", accountId: aAcc.id }, { id: Rt, name: "Ravi", phone: "", accountId: rAcc.id }], transfers: [{ from: At, to: Rt, amount: 100000 }] },
      ],
      "INR",
      () => null,
    );
    expect(items).toHaveLength(1);
    expect(items[0].net).toBe(0);
    expect(isEvenItem(items[0])).toBe(true);
    expect(items[0].parts).toHaveLength(2);
    expect(evenCaption(items[0])).toMatch(/^Owed ₹1,000 in Trip .*, owe ₹1,000 in Flat .*\. Nothing to pay\.$/);

    // The very parts the page's form carries, through the existing path.
    const parts = items[0].parts.map((p) => ({ groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount }));
    expect(await settleAcrossCore(parts, { [flat.id]: Rf, [trip.id]: Rt }, `cb-${stamp}-key-abcdefgh`)).toBe("done");

    expect(Object.values(await netOf(flat.id)).every((v) => v === 0)).toBe(true);
    expect(Object.values(await netOf(trip.id)).every((v) => v === 0)).toBe(true);
    // Ravi: each group nets to 0 for him, so his overall position is 0 too (hand check: -100000 + 100000).
    expect((await netOf(flat.id))[Rf] + (await netOf(trip.id))[Rt]).toBe(0);

    // Two payments, linked to each other (`across`) so deleting one takes both off.
    const flatPay = await db.payment.findFirstOrThrow({ where: { groupId: flat.id, deletedAt: null } });
    const tripPay = await db.payment.findFirstOrThrow({ where: { groupId: trip.id, deletedAt: null } });
    expect([flatPay.fromId, flatPay.toId, flatPay.amount]).toEqual([Rf, Af, 100000]);
    expect([tripPay.fromId, tripPay.toId, tripPay.amount]).toEqual([At, Rt, 100000]);
    const a = parseUndo((await db.groupEvent.findFirstOrThrow({ where: { paymentId: flatPay.id, kind: "payment_recorded" } })).undo);
    const b = parseUndo((await db.groupEvent.findFirstOrThrow({ where: { paymentId: tripPay.id, kind: "payment_recorded" } })).undo);
    if (a?.type !== "payment_delete" || b?.type !== "payment_delete" || !a.across || !b.across) throw new Error("no link on the lines");
    expect(a.across.id).toBe(b.across.id);
    expect(a.across.parts.map((p) => p.paymentId).sort()).toEqual([flatPay.id, tripPay.id].sort());
  });

  it("keeps the same guards: a part that changed since the page loaded records nothing", async () => {
    const [aAcc, rAcc] = [await account("Asha"), await account("Ravi")];
    const flat = await group("Flat", "home", [{ name: "Asha", accountId: aAcc.id }, { name: "Ravi", accountId: rAcc.id }]);
    const trip = await group("Trip", "trip", [{ name: "Asha", accountId: aAcc.id }, { name: "Ravi", accountId: rAcc.id }]);
    const [Af, Rf, At, Rt] = [flat.member("Asha"), flat.member("Ravi"), trip.member("Asha"), trip.member("Ravi")];
    await spend(flat.id, "Dinner", 100000, Af, Rf);
    await spend(trip.id, "Taxi", 100000, Rt, At);
    // The page said 100000 each way; the trip's amount is now 90000 (stale): nothing at all is recorded.
    const parts = [
      { groupId: flat.id, fromId: Rf, toId: Af, amount: 100000 },
      { groupId: trip.id, fromId: At, toId: Rt, amount: 90000 },
    ];
    expect(await settleAcrossCore(parts, { [flat.id]: Rf, [trip.id]: Rt }, `cb-${stamp}-stale-abcdefgh`)).toBe("changed");
    expect(await db.payment.count({ where: { groupId: { in: [flat.id, trip.id] } } })).toBe(0);
  });
});
