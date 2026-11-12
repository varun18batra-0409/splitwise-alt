import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { canSendTo, postcardPeople } from "@/lib/postcards/people";

// Postcards follow the passport rule: someone the admin removed (either way round) doesn't count
// as sharing a group; someone who left on their own still does.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function pair(tag: string) {
  const mk = async (name: string) => {
    const a = await db.account.create({ data: { email: `pc-${tag}-${name}-${stamp}@example.test`, name } });
    accountIds.push(a.id);
    return a;
  };
  const viewer = await mk("Viewer");
  const friend = await mk("Friend");
  const g = await db.group.create({
    data: {
      name: `pc ${tag} ${stamp}`,
      inviteCode: `pc-${tag}-${stamp}`,
      members: { create: [{ name: "Viewer", accountId: viewer.id, claimedAt: new Date() }, { name: "Friend", accountId: friend.id, claimedAt: new Date() }] },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const row = (accountId: string) => g.members.find((m) => m.accountId === accountId)!.id;
  return { viewer, friend, viewerRow: row(viewer.id), friendRow: row(friend.id) };
}
const offered = async (viewerId: string) => (await postcardPeople(viewerId)).flatMap((g) => g.people.map((p) => p.id));

describe("postcards and removed people", () => {
  it("a removed friend is not offered and can't be sent to; the removed person has no one to send to either", async () => {
    const s = await pair("removed");
    expect(await offered(s.viewer.id)).toEqual([s.friend.id]);
    await db.member.update({ where: { id: s.friendRow }, data: { removedAt: new Date(), leftAt: new Date() } });
    expect(await offered(s.viewer.id)).toEqual([]);
    expect((await canSendTo(s.viewer.id, [s.friend.id])).size).toBe(0);
    expect(await postcardPeople(s.friend.id)).toEqual([]);
    expect((await canSendTo(s.friend.id, [s.viewer.id])).size).toBe(0);
  });

  it("someone who left on their own is still offered (as before)", async () => {
    const s = await pair("left");
    await db.member.update({ where: { id: s.friendRow }, data: { leftAt: new Date() } });
    expect(await offered(s.viewer.id)).toEqual([s.friend.id]);
    expect([...(await canSendTo(s.viewer.id, [s.friend.id]))]).toEqual([s.friend.id]);
  });
});
