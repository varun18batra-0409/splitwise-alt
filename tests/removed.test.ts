import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setMemberLeft } from "@/lib/people";
import { joinExisting, joinNew, newInviteLink, waitingInvites, NEW_LINK_ADMIN_ONLY } from "@/lib/join";
import { undoEvent } from "@/lib/undo";
import { canSeePassport, passportFriends } from "@/lib/passport-db";

// Removed by the admin is not the same as left on your own.
// - removed: they can't rejoin by themselves, with the link, or by taking another name;
//   only the admin can bring them back; they stop counting for passport sharing.
// - left: they rejoin whenever they like, and still count for passports.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];

async function account(name: string) {
  const a = await db.account.create({ data: { email: `rm-${name}-${stamp}@example.test`, name, passportChoiceAt: new Date() } }); // each has tapped Show
  accountIds.push(a.id);
  return { id: a.id, name, email: a.email };
}

// Asha looks after the flat (first, claimed). Ravi and Sam are on Loopin. "Kiran" was added by name only.
async function flat(label: string) {
  const [asha, ravi, sam] = [await account(`Asha${label}`), await account(`Ravi${label}`), await account(`Sam${label}`)];
  const g = await db.group.create({
    data: {
      name: `Flat ${label}`, type: "home", currency: "INR", inviteCode: `rm-${label}-${stamp}`,
      members: {
        create: [
          { name: "Asha", accountId: asha.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, // first in, so she looks after the flat
          { name: "Ravi", accountId: ravi.id, claimedAt: new Date() },
          { name: "Sam", accountId: sam.id, claimedAt: new Date() },
          { name: "Kiran" },
        ],
      },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  return { groupId: g.id, code: g.inviteCode, accounts: { asha, ravi, sam }, asha: id("Asha"), ravi: id("Ravi"), sam: id("Sam"), kiran: id("Kiran") };
}

afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("removed by the admin", () => {
  it("the admin removes Ravi: removedAt and removedById are set (and he has left), and Activity says removed", async () => {
    const f = await flat("a");
    const r = await setMemberLeft(f.groupId, f.asha, f.ravi, true);
    expect(r.ok).toBe(true);
    const row = await db.member.findUniqueOrThrow({ where: { id: f.ravi } });
    expect(row.leftAt).not.toBeNull();
    expect(row.removedAt).not.toBeNull();
    expect(row.removedById).toBe(f.asha);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.groupId, kind: "member_left" } });
    expect(ev.text).toBe("removed Ravi from the group");
  });

  it("Ravi can't rejoin himself: he is told who removed him", async () => {
    const f = await flat("b");
    await setMemberLeft(f.groupId, f.asha, f.ravi, true);
    const r = await setMemberLeft(f.groupId, f.ravi, f.ravi, false);
    expect(r).toEqual({ ok: false, error: "Asha removed you from this group. Ask them to invite you again." });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.ravi } })).leftAt).not.toBeNull();
  });

  it("the link doesn't bring him back: not as himself, and not by taking another unclaimed name", async () => {
    const f = await flat("c");
    await setMemberLeft(f.groupId, f.asha, f.ravi, true);
    expect(await joinNew(f.code, f.accounts.ravi, "Ravi")).toEqual({ ok: false, reason: "removed", adminName: "Asha" });
    expect(await joinExisting(f.code, f.accounts.ravi, f.kiran)).toEqual({ ok: false, reason: "removed", adminName: "Asha" });
    const kiran = await db.member.findUniqueOrThrow({ where: { id: f.kiran } });
    expect(kiran.accountId).toBeNull(); // the name wasn't taken
    expect(await db.member.count({ where: { groupId: f.groupId, accountId: f.accounts.ravi.id } })).toBe(1); // no second row either
  });

  it("someone who left on their own rejoins fine, with the link", async () => {
    const f = await flat("d");
    expect((await setMemberLeft(f.groupId, f.sam, f.sam, true)).ok).toBe(true);
    const row = await db.member.findUniqueOrThrow({ where: { id: f.sam } });
    expect(row.leftAt).not.toBeNull();
    expect(row.removedAt).toBeNull();
    expect(await joinNew(f.code, f.accounts.sam, "Sam")).toEqual({ ok: true, memberId: f.sam });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.sam } })).leftAt).toBeNull();
    // ...or from People
    await setMemberLeft(f.groupId, f.sam, f.sam, true);
    expect((await setMemberLeft(f.groupId, f.sam, f.sam, false)).ok).toBe(true);
  });

  it("undoing the removal clears it, so he is simply back", async () => {
    const f = await flat("e");
    const removed = await setMemberLeft(f.groupId, f.asha, f.ravi, true);
    if (!removed.ok || !removed.eventId) throw new Error("no event");
    const u = await undoEvent(removed.eventId, f.asha);
    expect(u.ok).toBe(true);
    const row = await db.member.findUniqueOrThrow({ where: { id: f.ravi } });
    expect(row.leftAt).toBeNull();
    expect(row.removedAt).toBeNull();
    expect(row.removedById).toBe("");
  });

  it("only the admin can bring a removed person back; when they do, the removal is cleared", async () => {
    const f = await flat("f");
    await setMemberLeft(f.groupId, f.asha, f.ravi, true);
    const refused = await setMemberLeft(f.groupId, f.sam, f.ravi, false);
    expect(refused).toEqual({ ok: false, error: "Only the person who looks after this group can bring back someone they removed." });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.ravi } })).removedAt).not.toBeNull();
    const back = await setMemberLeft(f.groupId, f.asha, f.ravi, false);
    expect(back.ok).toBe(true);
    const row = await db.member.findUniqueOrThrow({ where: { id: f.ravi } });
    expect(row).toMatchObject({ leftAt: null, removedAt: null, removedById: "" });
    // and the link works for him again (he's already in)
    expect(await joinNew(f.code, f.accounts.ravi, "Ravi")).toEqual({ ok: true, memberId: f.ravi });
  });

  it("someone who still owes money isn't removed (settle up first), same as leaving", async () => {
    const f = await flat("g");
    await db.expense.create({
      data: {
        groupId: f.groupId, description: "Dinner", amount: 30000, paidById: f.asha, createdById: f.asha, splitType: "equal", forMode: "everyone",
        originalAmount: 30000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 30000,
        shares: { create: [{ memberId: f.asha, amount: 10000 }, { memberId: f.ravi, amount: 10000 }, { memberId: f.sam, amount: 10000 }] },
      },
    });
    const r = await setMemberLeft(f.groupId, f.asha, f.ravi, true);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Ravi still owes .*100\. Settle up first/);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.ravi } })).removedAt).toBeNull();
  });
});

describe("the admin can turn 'left' into 'removed'", () => {
  it("Sam left on his own; Asha removes him: removedAt and removedById are set, the day he left is kept, and he can no longer rejoin himself", async () => {
    const f = await flat("m");
    expect((await setMemberLeft(f.groupId, f.sam, f.sam, true)).ok).toBe(true);
    const left = await db.member.findUniqueOrThrow({ where: { id: f.sam } });
    expect(left.removedAt).toBeNull();
    const r = await setMemberLeft(f.groupId, f.asha, f.sam, true);
    expect(r.ok).toBe(true);
    const row = await db.member.findUniqueOrThrow({ where: { id: f.sam } });
    expect(row.removedAt).not.toBeNull();
    expect(row.removedById).toBe(f.asha);
    expect(row.leftAt?.getTime()).toBe(left.leftAt?.getTime()); // still the day he left
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.groupId, text: "removed Sam from the group" } });
    expect(ev.kind).toBe("member_left");
    // He can't rejoin himself, or with the link.
    expect(await setMemberLeft(f.groupId, f.sam, f.sam, false)).toEqual({ ok: false, error: "Asha removed you from this group. Ask them to invite you again." });
    expect(await joinNew(f.code, f.accounts.sam, "Sam")).toEqual({ ok: false, reason: "removed", adminName: "Asha" });
  });

  it("only the admin can do it: Ravi can't take out Sam", async () => {
    const f = await flat("n");
    await setMemberLeft(f.groupId, f.sam, f.sam, true);
    const r = await setMemberLeft(f.groupId, f.ravi, f.sam, true);
    expect(r).toEqual({ ok: false, error: "Only the person who looks after this group can remove people." });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.sam } })).removedAt).toBeNull();
  });

  it("undoing it puts him back to 'left' (not in, not removed); removing someone already removed changes nothing", async () => {
    const f = await flat("o");
    await setMemberLeft(f.groupId, f.sam, f.sam, true);
    const before = (await db.member.findUniqueOrThrow({ where: { id: f.sam } })).leftAt!;
    const r = await setMemberLeft(f.groupId, f.asha, f.sam, true);
    if (!r.ok || !r.eventId) throw new Error("no event");
    expect(await setMemberLeft(f.groupId, f.asha, f.sam, true)).toEqual({ ok: true }); // already removed
    expect((await undoEvent(r.eventId, f.asha)).ok).toBe(true);
    const row = await db.member.findUniqueOrThrow({ where: { id: f.sam } });
    expect(row.removedAt).toBeNull();
    expect(row.removedById).toBe("");
    expect(row.leftAt?.getTime()).toBe(before.getTime()); // left, as before
  });
});

describe("redo after undoing 'left' -> 'removed'", () => {
  it("left, removed, Undo (back to left), Redo (removed again, not active)", async () => {
    const f = await flat("redo");
    await setMemberLeft(f.groupId, f.sam, f.sam, true);
    const leftAt = (await db.member.findUniqueOrThrow({ where: { id: f.sam } })).leftAt!;
    const removed = await setMemberLeft(f.groupId, f.asha, f.sam, true);
    if (!removed.ok || !removed.eventId) throw new Error("no event");
    const undone = await undoEvent(removed.eventId, f.asha);
    if (!undone.ok || !undone.eventId) throw new Error("undo failed");
    const mid = await db.member.findUniqueOrThrow({ where: { id: f.sam } });
    expect(mid.removedAt).toBeNull();
    expect(mid.leftAt?.getTime()).toBe(leftAt.getTime());
    const redone = await undoEvent(undone.eventId, f.asha); // Redo = undo the undo
    expect(redone.ok).toBe(true);
    const row = await db.member.findUniqueOrThrow({ where: { id: f.sam } });
    expect(row.removedAt).not.toBeNull(); // removed again, not active
    expect(row.removedById).toBe(f.asha);
    expect(row.leftAt).not.toBeNull();
    expect(row.leftAt?.getTime()).toBe(leftAt.getTime());
  });
});

describe("a new invite link", () => {
  it("the old link stops working and the new one works; only the admin can make it", async () => {
    const f = await flat("h");
    const nonAdmin = await newInviteLink(f.groupId, f.sam);
    expect(nonAdmin).toEqual({ ok: false, error: NEW_LINK_ADMIN_ONLY });
    expect((await db.group.findUniqueOrThrow({ where: { id: f.groupId } })).inviteCode).toBe(f.code);

    const made = await newInviteLink(f.groupId, f.asha);
    if (!made.ok) throw new Error(made.error);
    expect(made.code).not.toBe(f.code);
    expect(await db.group.findUnique({ where: { inviteCode: f.code } })).toBeNull(); // the join page shows "This invite link no longer works"
    const stranger = await account("Newcomer");
    expect(await joinNew(f.code, stranger, "Newcomer")).toEqual({ ok: false, reason: "gone" });
    const joined = await joinNew(made.code, stranger, "Newcomer");
    expect(joined.ok).toBe(true);
  });

  it("also closes the open email invitations in the same step; accepted ones stay accepted", async () => {
    const f = await flat("lc07");
    const open = await db.invite.create({ data: { groupId: f.groupId, email: `lc07-open-${stamp}@example.test`, invitedById: f.asha } });
    const accepted = await db.invite.create({ data: { groupId: f.groupId, email: `lc07-done-${stamp}@example.test`, invitedById: f.asha, acceptedAt: new Date() } });
    // A non-admin changes nothing.
    await newInviteLink(f.groupId, f.sam);
    expect((await db.invite.findUniqueOrThrow({ where: { id: open.id } })).declinedAt).toBeNull();
    const made = await newInviteLink(f.groupId, f.asha);
    expect(made.ok).toBe(true);
    expect((await db.invite.findUniqueOrThrow({ where: { id: open.id } })).declinedAt).not.toBeNull();
    const kept = await db.invite.findUniqueOrThrow({ where: { id: accepted.id } });
    expect(kept.declinedAt).toBeNull();
    expect(kept.acceptedAt).not.toBeNull();
  });

  it("knows when email invites are still waiting (they stop working with the old link)", async () => {
    const f = await flat("i");
    expect(await waitingInvites(f.groupId)).toBe(0);
    await db.invite.create({ data: { groupId: f.groupId, email: `waiting-${stamp}@example.test`, invitedById: f.asha } });
    expect(await waitingInvites(f.groupId)).toBe(1);
    await db.invite.updateMany({ where: { groupId: f.groupId }, data: { acceptedAt: new Date() } });
    expect(await waitingInvites(f.groupId)).toBe(0);
  });
});

describe("passports: removed stops counting, left still counts", () => {
  it("Sam sees Ravi's passport; after the admin removes Ravi he doesn't (and the other way round)", async () => {
    const f = await flat("j");
    expect((await canSeePassport(f.accounts.sam.id, f.accounts.ravi.id)).ok).toBe(true);
    expect((await passportFriends(f.accounts.sam.id)).some((x) => x.accountId === f.accounts.ravi.id)).toBe(true);
    await setMemberLeft(f.groupId, f.asha, f.ravi, true);
    expect(await canSeePassport(f.accounts.sam.id, f.accounts.ravi.id)).toMatchObject({ ok: false, reason: "stranger" });
    expect(await canSeePassport(f.accounts.ravi.id, f.accounts.sam.id)).toMatchObject({ ok: false, reason: "stranger" });
    expect((await passportFriends(f.accounts.sam.id)).some((x) => x.accountId === f.accounts.ravi.id)).toBe(false);
    expect((await passportFriends(f.accounts.ravi.id)).length).toBe(0);
    // Asha is still shared with Sam.
    expect((await canSeePassport(f.accounts.sam.id, f.accounts.asha.id)).ok).toBe(true);
  });

  it("someone who left on their own still counts", async () => {
    const f = await flat("k");
    await setMemberLeft(f.groupId, f.ravi, f.ravi, true);
    expect((await canSeePassport(f.accounts.sam.id, f.accounts.ravi.id)).ok).toBe(true);
  });

  it("removed from one group but still together in another: still allowed", async () => {
    const f = await flat("l");
    const other = await db.group.create({
      data: {
        name: `Trip l ${stamp}`, inviteCode: `rm-trip-l-${stamp}`,
        members: { create: [{ name: "Ravi", accountId: f.accounts.ravi.id, claimedAt: new Date() }, { name: "Sam", accountId: f.accounts.sam.id, claimedAt: new Date() }] },
      },
    });
    groupIds.push(other.id);
    await setMemberLeft(f.groupId, f.asha, f.ravi, true);
    expect((await canSeePassport(f.accounts.sam.id, f.accounts.ravi.id)).ok).toBe(true);
  });
});
