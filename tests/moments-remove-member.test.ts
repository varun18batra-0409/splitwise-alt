import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { removeMembers } from "@/lib/undo";

// Taking back an "added person" (removeMembers) is refused once they have a moment or a reaction, the same as for money: they are
// "already used", so nobody is hard-deleted with photos behind them. A person with nothing is still removed.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];

async function setup() {
  const owner = await db.account.create({ data: { email: `rm-owner-${stamp}-${groupIds.length}@example.test`, name: "Owner" } });
  accountIds.push(owner.id);
  const g = await db.group.create({
    data: { name: `Remove ${stamp}`, inviteCode: `rm-${stamp}-${groupIds.length}`, type: "trip", members: { create: [{ name: "Me" }, { name: "Author" }, { name: "Reactor" }, { name: "Nothing" }] } },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  const moment = await db.moment.create({ data: { groupId: g.id, authorId: id("Author"), authorAccountId: owner.id, data: new Uint8Array(), thumbData: new Uint8Array() } });
  return { gid: g.id, me: id("Me"), author: id("Author"), reactor: id("Reactor"), nothing: id("Nothing"), momentId: moment.id };
}

afterAll(async () => {
  const ids = (await db.moment.findMany({ where: { groupId: { in: groupIds } }, select: { id: true } })).map((m) => m.id);
  await db.momentReaction.deleteMany({ where: { momentId: { in: ids } } });
  await db.moment.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.groupEvent.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("removeMembers and moments", () => {
  it("refuses someone who added a moment, and keeps the member and the moment", async () => {
    const t = await setup();
    const r = await removeMembers(t.gid, t.me, [t.author], false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Author");
    expect(await db.member.count({ where: { id: t.author } })).toBe(1);
    expect(await db.moment.count({ where: { id: t.momentId } })).toBe(1);
  });

  it("refuses someone who only reacted to a moment", async () => {
    const t = await setup();
    await db.momentReaction.create({ data: { momentId: t.momentId, memberId: t.reactor, emoji: "😂" } });
    const r = await removeMembers(t.gid, t.me, [t.reactor], false);
    expect(r.ok).toBe(false);
    expect(await db.member.count({ where: { id: t.reactor } })).toBe(1);
    expect(await db.momentReaction.count({ where: { memberId: t.reactor } })).toBe(1);
  });

  it("one used person in the list stops the whole removal", async () => {
    const t = await setup();
    const r = await removeMembers(t.gid, t.me, [t.nothing, t.author], false);
    expect(r.ok).toBe(false);
    expect(await db.member.count({ where: { id: { in: [t.nothing, t.author] } } })).toBe(2);
  });

  it("still removes someone with no moments, no reactions and no money", async () => {
    const t = await setup();
    const r = await removeMembers(t.gid, t.me, [t.nothing], false);
    expect(r.ok).toBe(true);
    expect(await db.member.count({ where: { id: t.nothing } })).toBe(0);
  });
});
