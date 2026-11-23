import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { deleteAccount } from "@/lib/auth";
import { eraseGroups } from "@/lib/purge";

// B7: the two lasting notes kept as one-time keys ("home-cleared:<account>" and "bill-replaced:<expense>") go away with what they belong to.
// Throwaway database.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("lasting keys are cleaned up with their owner", () => {
  it("deleting an account removes its 'Not set' note and no one else's", async () => {
    const a = await db.account.create({ data: { email: `lk-a-${stamp}@example.test`, name: "A" } });
    const b = await db.account.create({ data: { email: `lk-b-${stamp}@example.test`, name: "B" } });
    accountIds.push(a.id, b.id);
    await db.requestKey.createMany({ data: [{ key: `home-cleared:${a.id}`, result: "1" }, { key: `home-cleared:${b.id}`, result: "1" }] });
    await deleteAccount(a.id);
    expect(await db.requestKey.count({ where: { key: `home-cleared:${a.id}` } })).toBe(0);
    expect(await db.requestKey.count({ where: { key: `home-cleared:${b.id}` } })).toBe(1);
  });
  it("erasing a group removes the 'replaced' notes of its expenses and leaves another group's alone", async () => {
    const mk = async (label: string) => {
      const g = await db.group.create({ data: { name: `LK ${label} ${stamp}`, type: "home", currency: "INR", inviteCode: `lk-${label}-${stamp}`, members: { create: [{ name: "A" }] } }, include: { members: true } });
      groupIds.push(g.id);
      const e = await db.expense.create({
        data: { groupId: g.id, description: "Rent", amount: 1000, paidById: g.members[0].id, createdById: g.members[0].id, splitType: "equal", forMode: "everyone", originalAmount: 1000, convertedAmount: 1000, shares: { create: [{ memberId: g.members[0].id, amount: 1000 }] } },
      });
      await db.requestKey.create({ data: { key: `bill-replaced:${e.id}`, result: `new-${stamp}` } });
      return { gid: g.id, eid: e.id };
    };
    const one = await mk("one");
    const two = await mk("two");
    await eraseGroups([one.gid]);
    expect(await db.requestKey.count({ where: { key: `bill-replaced:${one.eid}` } })).toBe(0);
    expect(await db.requestKey.count({ where: { key: `bill-replaced:${two.eid}` } })).toBe(1);
    await db.requestKey.deleteMany({ where: { key: `bill-replaced:${two.eid}` } });
  });
});
