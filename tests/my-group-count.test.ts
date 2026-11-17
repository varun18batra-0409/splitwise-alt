import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { countMyGroups, loadMyGroups } from "@/lib/group-data";

// MA-8: the You pages only need how many groups there are. countMyGroups reads just the member rows and gives the number loadMyGroups lists.
// This phone: one normal group, one deleted group, one pair group, and one group where the saved person belongs to a different group.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const groupIds: string[] = [];

async function group(name: string, extra: { type?: string; deletedAt?: Date } = {}) {
  const g = await db.group.create({ data: { name: `${name} ${stamp}`, inviteCode: `mg-${name}-${stamp}`, ...extra, members: { create: [{ name: "Me" }, { name: "Other" }] } }, include: { members: true } });
  groupIds.push(g.id);
  return g;
}
afterAll(async () => {
  await db.member.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("countMyGroups", () => {
  it("You page: 1. Your data page (pairs included): 2. Both the same as the list loadMyGroups gives", async () => {
    const normal = await group("normal");
    const deleted = await group("deleted", { deletedAt: new Date() });
    const pair = await group("pair", { type: "direct" });
    const wrong = await group("wrong");
    const elsewhere = await group("elsewhere");
    const memberships: Record<string, string> = {
      [normal.id]: normal.members[0].id,
      [deleted.id]: deleted.members[0].id,
      [pair.id]: pair.members[0].id,
      [wrong.id]: elsewhere.members[0].id, // a member id that belongs to a different group
    };
    expect(await countMyGroups(memberships)).toBe(1);
    expect(await countMyGroups(memberships, { includeDirect: true })).toBe(2);
    expect(await countMyGroups({})).toBe(0);
    expect((await loadMyGroups(memberships)).length).toBe(1);
    expect((await loadMyGroups(memberships, { includeDirect: true })).length).toBe(2);
  });

  it("someone who left still counts, as in the list", async () => {
    const g = await group("left");
    await db.member.update({ where: { id: g.members[0].id }, data: { leftAt: new Date() } });
    const memberships = { [g.id]: g.members[0].id };
    expect(await countMyGroups(memberships)).toBe(1);
    expect((await loadMyGroups(memberships)).length).toBe(1);
  });
});
