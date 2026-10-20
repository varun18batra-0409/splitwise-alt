import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseExpiredGroups } from "@/lib/purge";

// Deleted groups are erased for good once their 30-day restore window is over;
// nothing else is touched.

const day = 86_400_000;
async function makeGroup(name: string, extra: { deletedAt?: Date | null; closed?: boolean } = {}) {
  const g = await db.group.create({
    data: { name, inviteCode: `${name}-${Date.now()}-${Math.random()}`, ...extra, members: { create: [{ name: "Ann" }, { name: "Ben" }] } },
    include: { members: true },
  });
  const [ann, ben] = g.members;
  const e = await db.expense.create({
    data: { groupId: g.id, description: "Tea", amount: 200, splitType: "equal", paidById: ann.id, shares: { create: [{ memberId: ann.id, amount: 100 }, { memberId: ben.id, amount: 100 }] } },
  });
  await db.payment.create({ data: { groupId: g.id, fromId: ben.id, toId: ann.id, amount: 100 } });
  await db.groupEvent.create({ data: { groupId: g.id, actorId: ann.id, kind: "expense_added", text: "added Tea", expenseId: e.id } });
  await db.bill.create({ data: { groupId: g.id, name: "Rent", amount: 1000, startMonth: "2026-10", runs: { create: [{ period: "2026-10", status: "added" }] } } });
  return g.id;
}

describe("erasing deleted groups after 30 days", () => {
  it("erases only groups deleted more than 30 days ago, with everything in them", async () => {
    const now = new Date();
    const old = await makeGroup("old-deleted", { deletedAt: new Date(now.getTime() - 31 * day) });
    const recent = await makeGroup("recent-deleted", { deletedAt: new Date(now.getTime() - 29 * day) });
    const closed = await makeGroup("closed", { closed: true });
    const live = await makeGroup("live");

    const n = await eraseExpiredGroups(now);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await db.group.findUnique({ where: { id: old } })).toBeNull();
    for (const t of [db.member, db.expense, db.payment, db.groupEvent, db.bill] as unknown as { count: (a: object) => Promise<number> }[]) {
      expect(await t.count({ where: { groupId: old } })).toBe(0);
    }
    expect(await db.expenseShare.count({ where: { expense: { groupId: old } } })).toBe(0);
    for (const id of [recent, closed, live]) {
      expect(await db.group.findUnique({ where: { id } })).not.toBeNull();
      expect(await db.expense.count({ where: { groupId: id } })).toBe(1);
    }
  });
});
