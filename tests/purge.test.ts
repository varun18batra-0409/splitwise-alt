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
    expect(n.erased).toBeGreaterThanOrEqual(1);
    expect(n.failed).toBe(0);
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

describe("erasing one group at a time", () => {
  it("one group failing does not stop the others: the other two are erased, the failing one stays, and it is counted", async () => {
    const now = new Date();
    // Oldest first: g1 (400 days), g2 (399), g3 (398). The test hook throws for g2 only.
    const g1 = await makeGroup("pg-1", { deletedAt: new Date(now.getTime() - 400 * day) });
    const g2 = await makeGroup("pg-2", { deletedAt: new Date(now.getTime() - 399 * day) });
    const g3 = await makeGroup("pg-3", { deletedAt: new Date(now.getTime() - 398 * day) });
    const r = await eraseExpiredGroups(now, 1000, () => false, async (id) => {
      if (id === g2) throw new Error("test: this group fails");
    });
    // (Other leftover groups from other tests may also be erased, so at least 2; exactly 1 failed.)
    expect(r.erased).toBeGreaterThanOrEqual(2);
    expect(r.failed).toBe(1);
    expect(await db.group.findUnique({ where: { id: g1 } })).toBeNull();
    expect(await db.group.findUnique({ where: { id: g3 } })).toBeNull();
    // g2 is whole: its group, people, expense and payment are all still there, so tomorrow's run can try again.
    expect(await db.group.findUnique({ where: { id: g2 } })).not.toBeNull();
    expect(await db.member.count({ where: { groupId: g2 } })).toBe(2);
    expect(await db.expense.count({ where: { groupId: g2 } })).toBe(1);
    expect(await db.payment.count({ where: { groupId: g2 } })).toBe(1);
    // The next run, with nothing failing, erases it.
    expect((await eraseExpiredGroups(now, 1000)).failed).toBe(0);
    expect(await db.group.findUnique({ where: { id: g2 } })).toBeNull();
  });

  it("stops starting new groups when the time budget says stop (the rest wait for tomorrow)", async () => {
    const now = new Date();
    const a = await makeGroup("st-1", { deletedAt: new Date(now.getTime() - 500 * day) });
    const b = await makeGroup("st-2", { deletedAt: new Date(now.getTime() - 499 * day) });
    let asked = 0;
    // Allowed to start one group, then "stop".
    const r = await eraseExpiredGroups(now, 1000, () => ++asked > 1);
    expect(r.failed).toBe(0);
    expect(r.stopped).toBe(true); // reported, so the daily email lists it
    expect((await eraseExpiredGroups(now, 1000)).stopped).toBe(false);
    // At most one of the two went (an older leftover group from another test may have used the one start).
    const gone = (await Promise.all([a, b].map((id) => db.group.findUnique({ where: { id } })))).filter((g) => g === null).length;
    expect(gone).toBeLessThanOrEqual(1);
    await eraseExpiredGroups(now, 1000);
    expect(await db.group.findUnique({ where: { id: a } })).toBeNull();
    expect(await db.group.findUnique({ where: { id: b } })).toBeNull();
  });
});
