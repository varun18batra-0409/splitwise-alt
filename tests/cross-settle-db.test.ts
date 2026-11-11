import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadMyGroups, loadGroup } from "@/lib/group-data";
import { crossSettle } from "@/lib/cross-settle";

// Two real groups with the same people; Smart Settle across groups must give
// one payment per person, and recording it must clear both groups.
const ids: string[] = [];

async function makeGroup(name: string) {
  const g = await db.group.create({
    data: {
      name,
      currency: "INR",
      inviteCode: `x-${name}-${Date.now()}`,
      members: { create: [{ name: "Varun" }, { name: "Asha", phone: "+91 98765 43210" }] },
    },
    include: { members: true },
  });
  ids.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  return { id: g.id, me: id("Varun"), asha: id("Asha") };
}

afterAll(async () => {
  await db.groupEvent.deleteMany({ where: { groupId: { in: ids } } });
  await db.payment.deleteMany({ where: { groupId: { in: ids } } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId: { in: ids } } } });
  await db.expense.deleteMany({ where: { groupId: { in: ids } } });
  await db.member.deleteMany({ where: { groupId: { in: ids } } });
  await db.group.deleteMany({ where: { id: { in: ids } } });
});

describe("Smart Settle across groups (real database)", () => {
  it("nets two groups into one payment and recording it clears both", async () => {
    const trip = await makeGroup("Trip");
    const flat = await makeGroup("Flat");
    // Trip: Asha paid ₹2,000 for both → I owe Asha ₹1,000
    await db.expense.create({
      data: { groupId: trip.id, description: "Hotel", amount: 200000, splitType: "equal", paidById: trip.asha, createdById: trip.asha,
        originalAmount: 200000, convertedAmount: 200000, shares: { create: [{ memberId: trip.me, amount: 100000 }, { memberId: trip.asha, amount: 100000 }] } },
    });
    // Flat: I paid ₹800 for both → Asha owes me ₹400
    await db.expense.create({
      data: { groupId: flat.id, description: "Groceries", amount: 80000, splitType: "equal", paidById: flat.me, createdById: flat.me,
        originalAmount: 80000, convertedAmount: 80000, shares: { create: [{ memberId: flat.me, amount: 40000 }, { memberId: flat.asha, amount: 40000 }] } },
    });

    const mine = await loadMyGroups({ [trip.id]: trip.me, [flat.id]: flat.me });
    const { items } = crossSettle(
      mine.map((g) => ({ groupId: g.group.id, groupName: g.group.name, currency: g.group.currency, myId: g.myId, members: g.group.members, transfers: g.transfers })),
      "INR",
      () => null,
    );
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Asha");
    expect(items[0].net).toBe(-60000); // one payment: I pay Asha ₹600
    expect(items[0].parts).toHaveLength(2);

    for (const p of items[0].parts) {
      await db.payment.create({ data: { groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount, createdById: trip.me } });
    }
    for (const gid of [trip.id, flat.id]) {
      const g = await loadGroup(gid);
      expect(Object.values(g!.net).every((v) => v === 0)).toBe(true);
      expect(g!.transfers).toEqual([]);
    }
  });
  // FIN-M19 from the outside review: the exact case, in two brand-new groups
  // only (no other groups in the mix). Group X: Asha owes me ₹500. Group Y:
  // I owe Asha ₹300. Expected by hand: one payment, Asha pays me ₹200.
  it("FIN-M19: ₹500 one way and ₹300 the other nets to one ₹200 payment", async () => {
    const x = await makeGroup("X");
    const y = await makeGroup("Y");
    await db.expense.create({
      data: { groupId: x.id, description: "Taxi", amount: 100000, splitType: "equal", paidById: x.me, createdById: x.me,
        originalAmount: 100000, convertedAmount: 100000, shares: { create: [{ memberId: x.me, amount: 50000 }, { memberId: x.asha, amount: 50000 }] } },
    });
    await db.expense.create({
      data: { groupId: y.id, description: "Lunch", amount: 60000, splitType: "equal", paidById: y.asha, createdById: y.asha,
        originalAmount: 60000, convertedAmount: 60000, shares: { create: [{ memberId: y.me, amount: 30000 }, { memberId: y.asha, amount: 30000 }] } },
    });
    const mine = await loadMyGroups({ [x.id]: x.me, [y.id]: y.me });
    expect(mine).toHaveLength(2);
    const { items } = crossSettle(
      mine.map((g) => ({ groupId: g.group.id, groupName: g.group.name, currency: g.group.currency, myId: g.myId, members: g.group.members, transfers: g.transfers })),
      "INR",
      () => null,
    );
    expect(items).toHaveLength(1);
    expect(items[0].net).toBe(20000); // + means they pay me: Asha pays me ₹200
    expect(items[0].parts).toHaveLength(2);
    const px = items[0].parts.find((p) => p.groupId === x.id)!;
    const py = items[0].parts.find((p) => p.groupId === y.id)!;
    expect([px.fromId, px.toId, px.amount]).toEqual([x.asha, x.me, 50000]);
    expect([py.fromId, py.toId, py.amount]).toEqual([y.me, y.asha, 30000]);

    for (const p of items[0].parts) {
      await db.payment.create({ data: { groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount, createdById: x.me } });
    }
    for (const gid of [x.id, y.id]) {
      const g = await loadGroup(gid);
      expect(Object.values(g!.net).every((v) => v === 0)).toBe(true);
      expect(g!.transfers).toEqual([]);
    }
  });
});
