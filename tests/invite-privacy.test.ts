import { afterAll, describe, expect, it, vi } from "vitest";

// AS-1 (16 Nov line review): any member could read the private email of anyone they share a group with. They added that person (from the
// "Add people" form, with an account id) to a group they had just made themselves, and the People screen then showed "Invited at <email>" to the
// adder, who is that group's admin. Two fixes, both tested here:
//   1. An invitation made from someone's Loopin account is marked `fromAccount`; the People screen never shows an email for those
//      ("Invited on Loopin. Cancel the invitation if it's the wrong person."). A typed address is still shown to whoever typed it, and to the admin.
//   2. Adding by account is only for people the adder could have found in search: someone who already has a row in THIS group (invite back), or
//      someone who shares another group with them (not a pair, not deleted, both really joined). Anyone else gets "That person isn't on Loopin."
//      (the same reply as an account that doesn't exist), and nothing is written.
// Throwaway database.

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

process.env.MAIL_OUTBOX = "1";
const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { addRegistered, inviteByEmail, inviteRowLabel, INVITED_ON_LOOPIN, sharesGroupWith, waitingNote } = await import("@/lib/invites");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const origin = "https://loopin.test";
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
afterAll(async () => {
  await eraseGroups(groupIds);
  await db.outbox.deleteMany({ where: { to: { contains: stamp } } });
  await db.accountNote.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `ip-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}
// A group with these people in it, all really joined.
async function group(label: string, people: { id: string; name: string }[], type = "trip") {
  const g = await db.group.create({
    data: { name: `${label} ${++n} ${stamp}`, type, currency: "INR", inviteCode: `ip-${n}-${stamp}`, members: { create: people.map((p, i) => ({ name: p.name, accountId: p.id, claimedAt: new Date(), createdAt: new Date(2026, 0, i + 1) })) } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, member: (accountId: string) => g.members.find((m) => m.accountId === accountId)!.id };
}
const openInvites = (gid: string) => db.invite.findMany({ where: { groupId: gid, acceptedAt: null, declinedAt: null }, orderBy: { createdAt: "desc" } });

describe("AS-1: nobody's email is shown for someone picked from their Loopin account", () => {
  it("Mallory shares a trip with Asha, adds her to a group of her own: the invite is marked fromAccount, and neither Mallory nor the admin is shown the email", async () => {
    const [mallory, asha] = [await account("Mallory"), await account("Asha")];
    await group("Trip", [mallory, asha]); // they share this
    const solo = await group("Solo", [mallory]); // the one Mallory just made: she is its admin
    const r = await addRegistered(solo.id, solo.member(mallory.id), asha.id, origin);
    expect(r.ok).toBe(true);
    const invites = await openInvites(solo.id);
    expect(invites).toHaveLength(1);
    expect(invites[0].fromAccount).toBe(true);
    expect(invites[0].email).toBe(asha.email); // stored (it is how the invitation reaches her), never shown
    const list = invites.map((i) => ({ fromAccount: i.fromAccount, email: i.email }));
    // The admin / the inviter (Mallory is both): the new wording, with no address in it.
    const forMallory = waitingNote({ invites: list, by: "Mallory", mayCancel: true, mayInvite: true });
    expect(forMallory).toBe(INVITED_ON_LOOPIN);
    expect(forMallory).not.toContain(asha.email);
    expect(forMallory).not.toContain("@");
    // Anyone who can't cancel never saw an address, and still doesn't.
    const forOther = waitingNote({ invites: list, by: "Mallory", mayCancel: false, mayInvite: false });
    expect(forOther).toBe("Invited by Mallory. They can change it if the address is wrong.");
    expect(forOther).not.toContain("@");
    // The Add people screen's label for an invitation with no name row of its own, too.
    expect(inviteRowLabel(invites[0], solo.member(mallory.id), "Mallory")).toBe("Invited on Loopin");
    expect(inviteRowLabel(invites[0], "someone-else", "Mallory")).toBe("Invited by Mallory");
    // The person is in the group as a plain name, as before.
    const row = await db.member.findUniqueOrThrow({ where: { id: invites[0].memberId } });
    expect(row.accountId).toBeNull();
  });

  it("the wording is exactly what the founder approved", () => {
    expect(INVITED_ON_LOOPIN).toBe("Invited on Loopin. Cancel the invitation if it’s the wrong person.");
  });

  it("a typed email is still shown to the person who typed it and to the admin, with the old wording (cancel, or invite a different email)", async () => {
    const [mallory, asha] = [await account("Mallory2"), await account("Asha2")];
    const solo = await group("Solo", [mallory]);
    const r = await inviteByEmail(solo.id, solo.member(mallory.id), asha.email, origin);
    expect(r.bad).toEqual([]);
    const invites = await openInvites(solo.id);
    expect(invites).toHaveLength(1);
    expect(invites[0].fromAccount).toBe(false);
    const list = invites.map((i) => ({ fromAccount: i.fromAccount, email: i.email }));
    expect(waitingNote({ invites: list, by: "Mallory2", mayCancel: true, mayInvite: true })).toBe(
      `Invited at ${asha.email}. Wrong address, or they sign in with another one? Cancel the invitation, or invite a different email below.`,
    );
    expect(waitingNote({ invites: list, by: "Mallory2", mayCancel: true, mayInvite: false })).toBe(
      `Invited at ${asha.email}. Wrong address, or they sign in with another one? Cancel the invitation.`,
    );
    expect(inviteRowLabel(invites[0], solo.member(mallory.id), "Mallory2")).toBe(asha.email);
    expect(inviteRowLabel(invites[0], "someone-else", "Mallory2")).toBe("Invited by Mallory2");
  });

  it("an invitation that stays 'from an account' while open: a second person typing the same address doesn't turn the email back on for the first", async () => {
    const [mallory, bob, asha] = [await account("Mallory3"), await account("Bob3"), await account("Asha3")];
    await group("Trip", [mallory, asha]);
    const solo = await group("Solo", [mallory, bob]);
    expect((await addRegistered(solo.id, solo.member(mallory.id), asha.id, origin)).ok).toBe(true);
    expect((await inviteByEmail(solo.id, solo.member(bob.id), asha.email, origin)).bad).toEqual([]);
    const invites = await openInvites(solo.id);
    expect(invites).toHaveLength(1);
    expect(invites[0].invitedById).toBe(solo.member(mallory.id)); // stays with whoever sent it first
    expect(invites[0].fromAccount).toBe(true);
  });

  it("inviting someone back who has a row here (left) is also marked fromAccount", async () => {
    const [mallory, ada] = [await account("Mallory4"), await account("Ada4")];
    const g = await group("Back", [mallory, ada]);
    await db.member.update({ where: { id: g.member(ada.id) }, data: { leftAt: new Date() } });
    const r = await addRegistered(g.id, g.member(mallory.id), ada.id, origin);
    expect(r.ok && r.invitedBack).toBe(true);
    const invites = await openInvites(g.id);
    expect(invites.map((i) => i.fromAccount)).toEqual([true]);
  });
});

describe("AS-1: adding by account needs a shared group (or a row in this group)", () => {
  it("someone Mallory shares no group with: the same reply as 'no such account', and no member or invitation is written", async () => {
    const [mallory, stranger] = [await account("Mallory5"), await account("Stranger5")];
    const solo = await group("Solo", [mallory]);
    const before = { members: await db.member.count({ where: { groupId: solo.id } }), invites: await db.invite.count({ where: { groupId: solo.id } }), events: await db.groupEvent.count({ where: { groupId: solo.id } }) };
    const refused = await addRegistered(solo.id, solo.member(mallory.id), stranger.id, origin);
    const missing = await addRegistered(solo.id, solo.member(mallory.id), `no-such-account-${stamp}`, origin);
    expect(refused).toEqual({ ok: false, error: "That person isn't on Loopin." });
    expect(missing).toEqual(refused); // nobody can use this to test whether an account exists
    expect({ members: await db.member.count({ where: { groupId: solo.id } }), invites: await db.invite.count({ where: { groupId: solo.id } }), events: await db.groupEvent.count({ where: { groupId: solo.id } }) }).toEqual(before);
    expect(await db.outbox.count({ where: { to: stranger.email } })).toBe(0);
    expect(await db.accountNote.count({ where: { accountId: stranger.id } })).toBe(0);
  });

  it("a pair (two people, no group) doesn't count as sharing a group, and neither does a deleted group or someone who was only added and never joined", async () => {
    const [mallory, pairmate, ghost, pending] = [await account("Mallory6"), await account("Pairmate6"), await account("Ghost6"), await account("Pending6")];
    await group("Pair", [mallory, pairmate], "direct");
    const gone = await group("Gone", [mallory, ghost]);
    await db.group.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
    const added = await group("Added", [mallory]);
    await db.member.create({ data: { groupId: added.id, name: "Pending6", accountId: pending.id, addedBy: added.member(mallory.id) } }); // added by someone, never opened it
    expect(await sharesGroupWith(pairmate.id, mallory.id)).toBe(false);
    expect(await sharesGroupWith(ghost.id, mallory.id)).toBe(false);
    expect(await sharesGroupWith(pending.id, mallory.id)).toBe(false);
    const solo = await group("Solo", [mallory]);
    for (const who of [pairmate, ghost, pending]) {
      expect(await addRegistered(solo.id, solo.member(mallory.id), who.id, origin)).toEqual({ ok: false, error: "That person isn't on Loopin." });
    }
    expect(await db.invite.count({ where: { groupId: solo.id } })).toBe(0);
    expect(await db.member.count({ where: { groupId: solo.id } })).toBe(1);
  });

  it("people who do share a group are found: both ways round, and an actor with no account of their own finds nobody", async () => {
    const [a, b] = [await account("Share7a"), await account("Share7b")];
    await group("Trip", [a, b]);
    expect(await sharesGroupWith(b.id, a.id)).toBe(true);
    expect(await sharesGroupWith(a.id, b.id)).toBe(true);
    expect(await sharesGroupWith(b.id, null)).toBe(false);
    expect(await sharesGroupWith(b.id, undefined)).toBe(false);
    expect(await sharesGroupWith("", a.id)).toBe(false);
  });
});

describe("S3: someone removed from the only shared group is no longer found", () => {
  it("Vik shares G with Asha, then is removed from it: Asha can't be found from H, and sharesGroupWith is false", async () => {
    const [vik, asha] = [await account("Vik"), await account("Asha")];
    const g = await group("G", [vik, asha]);
    const h = await group("H", [vik]);
    expect(await sharesGroupWith(asha.id, vik.id)).toBe(true);
    await db.member.update({ where: { id: g.member(vik.id) }, data: { removedAt: new Date() } });
    expect(await sharesGroupWith(asha.id, vik.id)).toBe(false);
    expect(await sharesGroupWith(vik.id, asha.id)).toBe(false);
    // Inviting Asha by account from H is refused (nothing is written), as for any stranger.
    const r = await addRegistered(h.id, h.member(vik.id), asha.id, origin);
    expect(r.ok).toBe(false);
    expect(await openInvites(h.id)).toHaveLength(0);
  });
  it("someone who left on their own is not found either, and 'invite back' into the same group still works for the admin", async () => {
    const [adm, bo] = [await account("Adm"), await account("Bo")];
    const g = await group("G", [adm, bo]);
    await db.member.update({ where: { id: g.member(bo.id) }, data: { leftAt: new Date() } }); // left on their own: leftAt only, no removedAt
    expect(await sharesGroupWith(bo.id, adm.id)).toBe(false);
    expect(await sharesGroupWith(adm.id, bo.id)).toBe(false);
    const r = await addRegistered(g.id, g.member(adm.id), bo.id, origin); // has a row in THIS group: the invite-back path
    expect(r.ok).toBe(true);
    expect((await openInvites(g.id)).length).toBe(1);
  });
});
