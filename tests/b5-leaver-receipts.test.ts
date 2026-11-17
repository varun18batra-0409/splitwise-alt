import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { receiptsFor } from "@/lib/receipts-db";

// B5 GP-8: bill photos for someone who left. L left on 10 Nov 2026.
//   R1 was added on 5 Nov (while L was in the group): listed.   R2 was added on 12 Nov (after): not listed.
//   A person still in the group sees both. (The photo route itself already answers 404 for R2; this makes the list agree.)
// No money here: each receipt hangs on an expense of 30000, split A 15000 + L 15000 = 30000.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
afterAll(async () => {
  await db.receipt.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("GP-8: receiptsFor", () => {
  it("someone who left sees the bills up to the day they left, not newer ones", async () => {
    const g = await db.group.create({ data: { name: `B5 receipts ${stamp}`, inviteCode: `b5r-${stamp}`, members: { create: [{ name: "A" }, { name: "L" }] } }, include: { members: true } });
    groupIds.push(g.id);
    const a = g.members.find((m) => m.name === "A")!.id;
    const l = g.members.find((m) => m.name === "L")!.id;
    const leftAt = new Date("2026-11-10T12:00:00Z");
    await db.member.update({ where: { id: l }, data: { leftAt } });
    const e = await db.expense.create({
      data: { groupId: g.id, description: "Dinner", amount: 30000, splitType: "equal", paidById: a, createdById: a, originalAmount: 30000, convertedAmount: 30000, shares: { create: [{ memberId: a, amount: 15000 }, { memberId: l, amount: 15000 }] } },
      include: { shares: true },
    });
    expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(e.amount);
    const mk = (createdAt: Date) => db.receipt.create({ data: { groupId: g.id, expenseId: e.id, createdAt, type: "image/jpeg", data: new Uint8Array([1]) } });
    const r1 = await mk(new Date("2026-11-05T09:00:00Z"));
    const r2 = await mk(new Date("2026-11-12T09:00:00Z"));

    expect((await receiptsFor(g.id, leftAt)).map((r) => r.id)).toEqual([r1.id]);
    expect((await receiptsFor(g.id, null)).map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort());
    expect((await receiptsFor(g.id)).length).toBe(2);
  });
});
