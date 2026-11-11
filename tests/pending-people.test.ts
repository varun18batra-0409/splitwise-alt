import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { canSendTo, postcardPeople } from "@/lib/postcards/people";
import { createCollection, loadCollection, loopinFriends } from "@/lib/collect";
import { searchPeople } from "@/lib/invites";

// Someone added straight into a group by another person (and who hasn't opened it yet)
// isn't offered for postcards, collections or search, and can't be sent to.
// After they open the group (seenAt set) all of those allow them.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
const collectionIds: string[] = [];

const form = { title: "Farewell gift", note: "", currency: "INR", amount: "300", dueDate: "", upiId: "asha@okicici", payLink: "", names: "Meera" };

async function account(name: string) {
  const a = await db.account.create({ data: { email: `pp-${name}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}
// A group with the viewer (joined) and one other person who was added by someone and hasn't opened it.
async function setup(tag: string, viewerName: string, otherName: string) {
  const viewer = await account(viewerName);
  const other = await account(otherName);
  const g = await db.group.create({
    data: {
      name: `${tag} ${stamp}`,
      inviteCode: `pp-${tag}-${stamp}`,
      members: {
        create: [
          { name: viewerName, accountId: viewer.id, claimedAt: new Date() },
          { name: otherName, accountId: other.id, claimedAt: new Date(), addedBy: "someone", seenAt: null },
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const open = () => db.member.updateMany({ where: { groupId: g.id, accountId: other.id }, data: { seenAt: new Date() } });
  return { viewer, other, g, viewerMemberId: g.members.find((m) => m.accountId === viewer.id)!.id, open };
}

afterAll(async () => {
  await db.collection.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("postcards", () => {
  it("a pending person isn't in the list and can't be sent to; after they open the group they are", async () => {
    const s = await setup("cards", "Viewer1", "Pending1");
    expect((await postcardPeople(s.viewer.id)).flatMap((g) => g.people.map((p) => p.id))).not.toContain(s.other.id);
    expect((await canSendTo(s.viewer.id, [s.other.id])).size).toBe(0);
    await s.open();
    expect((await postcardPeople(s.viewer.id)).flatMap((g) => g.people.map((p) => p.id))).toContain(s.other.id);
    expect([...(await canSendTo(s.viewer.id, [s.other.id]))]).toEqual([s.other.id]);
  });

  it("when the sender is the pending one, they are offered nobody yet", async () => {
    const s = await setup("cards2", "Joined2", "Pending2");
    // Pending2 (added by someone) looks at their own list: the group isn't theirs yet.
    expect(await postcardPeople(s.other.id)).toEqual([]);
    expect((await canSendTo(s.other.id, [s.viewer.id])).size).toBe(0);
    await s.open();
    expect((await canSendTo(s.other.id, [s.viewer.id])).has(s.viewer.id)).toBe(true);
  });
});

describe("collections", () => {
  it("a picked pending friend isn't put on the list with their account; after seenAt they are", async () => {
    const s = await setup("collect", "Organiser3", "Pending3");
    expect((await loopinFriends(s.viewer.id)).map((f) => f.id)).not.toContain(s.other.id);

    const first = await createCollection(s.viewer, { ...form, friends: [s.other.id] });
    if (!first.ok) throw new Error(first.error);
    const c1 = (await loadCollection(first.code))!;
    collectionIds.push(c1.id);
    expect(c1.entries.map((e) => e.accountId)).toEqual([""]); // only the typed name Meera, nobody linked
    expect(first.notify).toEqual([]);

    await s.open();
    expect((await loopinFriends(s.viewer.id)).map((f) => f.id)).toContain(s.other.id);
    const second = await createCollection(s.viewer, { ...form, friends: [s.other.id] });
    if (!second.ok) throw new Error(second.error);
    const c2 = (await loadCollection(second.code))!;
    expect(c2.entries.map((e) => e.accountId).sort()).toEqual(["", s.other.id].sort());
  });

  it("entries already on a collection stay when a person is pending later (only new additions are filtered)", async () => {
    const s = await setup("collect2", "Organiser4", "Pending4");
    await s.open();
    const made = await createCollection(s.viewer, { ...form, friends: [s.other.id] });
    if (!made.ok) throw new Error(made.error);
    // Now they are somehow pending again (e.g. restored from an undo): the old entry is untouched.
    await db.member.updateMany({ where: { groupId: s.g.id, accountId: s.other.id }, data: { seenAt: null } });
    const c = (await loadCollection(made.code))!;
    expect(c.entries.some((e) => e.accountId === s.other.id)).toBe(true);
  });
});

describe("search when adding people", () => {
  it("finds a pending person only after they've opened the group", async () => {
    const s = await setup("search", "Searcher5", "Zebulon5");
    const ms = { [s.g.id]: s.viewerMemberId };
    // A second group for the viewer to be "in" while searching (the one being added to).
    const target = await db.group.create({ data: { name: `target ${stamp}`, inviteCode: `pp-target-${stamp}`, members: { create: [{ name: "Searcher5", accountId: s.viewer.id, claimedAt: new Date() }] } }, include: { members: true } });
    groupIds.push(target.id);
    const withTarget = { ...ms, [target.id]: target.members[0].id };
    expect(await searchPeople(withTarget, target.id, "zebulon")).toEqual([]);
    await s.open();
    expect((await searchPeople(withTarget, target.id, "zebulon")).map((f) => f.accountId)).toEqual([s.other.id]);
  });

  it("a viewer who was added and never opened a group doesn't find its people through it", async () => {
    const viewer = await account("Viewer6");
    const friend = await account("Quentin6");
    const g = await db.group.create({
      data: {
        name: `vp ${stamp}`,
        inviteCode: `pp-vp-${stamp}`,
        members: { create: [{ name: "Quentin6", accountId: friend.id, claimedAt: new Date() }, { name: "Viewer6", accountId: viewer.id, claimedAt: new Date(), addedBy: "x" }] },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const mine = g.members.find((m) => m.accountId === viewer.id)!.id;
    expect(await searchPeople({ [g.id]: mine }, g.id, "quentin")).toEqual([]);
    await db.member.update({ where: { id: mine }, data: { seenAt: new Date() } });
    expect((await searchPeople({ [g.id]: mine }, g.id, "quentin")).map((f) => f.accountId)).toEqual([friend.id]);
  });
});
