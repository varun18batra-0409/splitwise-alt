import { afterAll, describe, expect, it, vi } from "vitest";

// Someone WITH AN ACCOUNT who left (or was removed) is never put back by another member. They are sent an ordinary invitation for
// their own row. The row stays left / removed (history, balance and ownership untouched, nobody else can claim it) until THEY
// accept; "Not now" only closes the invitation. Everything is made fresh (throwaway database).
//
// The money in every group below, worked by hand (amounts in paise, equal splits):
//   Dinner   paid by Ada   9000, split Ada / Bea / Asha  3000 each -> Ada +6000, Bea -3000, Asha -3000
//   Taxi     paid by Bea   4000, split Bea / Asha        2000 each -> Bea +2000, Asha -2000
//   Payment  Bea  -> Ada   3000                                     -> Bea +3000, Ada -3000
//   Payment  Asha -> Ada   3000                                     -> Asha +3000, Ada -3000
//   Totals   Ada 6000-3000-3000 = 0 (so she may leave), Bea -3000+2000+3000 = +2000, Asha -3000-2000+3000 = -2000.
//   (Everything adds to 0: 0 + 2000 - 2000.) Leaving, being invited, declining or accepting must never move these numbers.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
process.env.MAIL_OUTBOX = "1";

const { db } = await import("@/lib/db");
const { setMemberLeft, setMember } = await import("@/lib/people");
const { addRegistered, inviteByEmail } = await import("@/lib/invites");
const { acceptInvitation, declineInvitation, loadInvitations } = await import("@/lib/invitations");
const { joinExisting } = await import("@/lib/join");
const { confirmUsedPending } = await import("@/lib/membership");
const { undoEvent } = await import("@/lib/undo");
const { undoMoveOut } = await import("@/lib/home/moving-db");
const { netBalances } = await import("@/lib/balances");
const { canSeePassport } = await import("@/lib/passport-db");
const { addWishes, setShares, sharedWithMe, matches, currentFriends } = await import("@/lib/wishes-db");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const origin = "https://loopin.test";
const accountIds: string[] = [];
const groupIds: string[] = [];
let n = 0;

async function account(name: string) {
  const a = await db.account.create({ data: { email: `bb-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name, passportChoiceAt: new Date() } });
  accountIds.push(a.id);
  return { id: a.id, name: a.name, email: a.email };
}

afterAll(async () => {
  await db.wishShare.deleteMany({ where: { OR: [{ ownerId: { in: accountIds } }, { friendId: { in: accountIds } }] } });
  await db.wishPlace.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.invite.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.outbox.deleteMany({ where: { to: { contains: stamp } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

// Asha looks after the group (first in). Ada (A, the leaver) and Bea (B) are members; Cy is on Loopin but not in the group; Kiran is a name only.
async function world() {
  const [asha, ada, bea, cy] = [await account("Asha"), await account("Ada"), await account("Bea"), await account("Cy")];
  const g = await db.group.create({
    data: {
      name: `Bring back ${++n} ${stamp}`, type: "trip", currency: "INR", inviteCode: `bb-${n}-${stamp}`,
      members: {
        create: [
          { name: "Asha", accountId: asha.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
          { name: "Ada", accountId: ada.id, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) },
          { name: "Bea", accountId: bea.id, claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3) },
          { name: "Kiran", createdAt: new Date(2026, 0, 4) },
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  const [A, B, S] = [id("Ada"), id("Bea"), id("Asha")];
  const exp = (description: string, amount: number, paidById: string, split: [string, number][]) =>
    db.expense.create({
      data: {
        groupId: g.id, description, amount, paidById, createdById: paidById, splitType: "equal", forMode: "selected",
        originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount,
        shares: { create: split.map(([memberId, a]) => ({ memberId, amount: a })) },
      },
    });
  await exp("Dinner", 9000, A, [[A, 3000], [B, 3000], [S, 3000]]);
  await exp("Taxi", 4000, B, [[B, 2000], [S, 2000]]);
  await db.payment.create({ data: { groupId: g.id, fromId: B, toId: A, amount: 3000, createdById: B } });
  await db.payment.create({ data: { groupId: g.id, fromId: S, toId: A, amount: 3000, createdById: S } });
  // Wishes: Ada and Bea both want Japan and show it to each other.
  await addWishes(ada.id, ["JP"]);
  await addWishes(bea.id, ["JP"]);
  await setShares(ada.id, "JP", [bea.id]);
  await setShares(bea.id, "JP", [ada.id]);
  return { g, code: g.inviteCode, asha, ada, bea, cy, S, A, B, K: id("Kiran") };
}
type World = Awaited<ReturnType<typeof world>>;

async function nets(w: World) {
  const g = await db.group.findUniqueOrThrow({ where: { id: w.g.id }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
  return netBalances(g.members.map((m) => m.id), g.expenses, g.payments);
}
const row = (id: string) => db.member.findUniqueOrThrow({ where: { id } });
const openInvite = (w: World, email: string) => db.invite.findFirstOrThrow({ where: { groupId: w.g.id, email, acceptedAt: null, declinedAt: null } });
const seen = async (viewerId: string) => (await sharedWithMe(viewerId)).flatMap((s) => s.countries);

describe("a leaver with history, invited back by another member", () => {
  it("the numbers are what the comment says before anything happens", async () => {
    const w = await world();
    expect(await nets(w)).toEqual({ [w.A]: 0, [w.B]: 2000, [w.S]: -2000, [w.K]: 0 });
  });

  it("B invites A back: A's row stays left and keeps its account, an invitation exists, B sees none of A, and the identity lookup does NOT make A a member; A accepts: same row, history intact, shares visible again; balances never move", async () => {
    const w = await world();
    const before = await nets(w);
    expect((await canSeePassport(w.bea.id, w.ada.id)).ok).toBe(true);
    expect((await matches(w.bea.id)).length).toBe(1);

    expect((await setMemberLeft(w.g.id, w.A, w.A, true)).ok).toBe(true); // A leaves on their own (zero balance)
    const leftRow = await row(w.A);
    expect(leftRow.leftAt).not.toBeNull();
    expect(await nets(w)).toEqual(before);

    const r = await addRegistered(w.g.id, w.B, w.ada.id, origin);
    expect(r.ok && r.invitedBack).toBe(true);
    // The row: still left, still Ada's, nothing "pending" on it.
    const afterInvite = await row(w.A);
    expect(afterInvite.leftAt?.getTime()).toBe(leftRow.leftAt?.getTime());
    expect(afterInvite).toMatchObject({ accountId: w.ada.id, removedAt: null, addedBy: "", claimedAt: leftRow.claimedAt });
    expect(afterInvite.seenAt?.getTime()).toBe(leftRow.seenAt?.getTime());
    expect(await db.member.count({ where: { groupId: w.g.id, accountId: w.ada.id } })).toBe(1); // no second row
    // An ordinary invitation, for that row, from B.
    expect(await openInvite(w, w.ada.email)).toMatchObject({ memberId: w.A, invitedById: w.B, token: expect.stringMatching(/.+/) });
    // The lookup that runs on every page for a signed-in account: it must not turn A back into a member.
    expect(await confirmUsedPending(w.ada.id)).toEqual([]);
    expect((await row(w.A)).leftAt).not.toBeNull();
    // B sees nothing of A's, and A sees nothing of B's.
    expect(await currentFriends(w.bea.id)).toEqual([]);
    expect(await seen(w.bea.id)).toEqual([]);
    expect(await matches(w.bea.id)).toEqual([]);
    expect((await canSeePassport(w.bea.id, w.ada.id)).ok).toBe(false);
    expect(await seen(w.ada.id)).toEqual([]);
    // A has one thing to answer.
    const invites = await loadInvitations(w.ada);
    expect(invites.map((i) => [i.groupId, i.memberId])).toEqual([[w.g.id, w.A]]);
    expect(await nets(w)).toEqual(before);

    // A accepts.
    expect((await acceptInvitation(w.ada, invites[0].key)).ok).toBe(true);
    const back = await row(w.A);
    expect(back).toMatchObject({ id: w.A, accountId: w.ada.id, leftAt: null, removedAt: null });
    expect(await db.member.count({ where: { groupId: w.g.id, accountId: w.ada.id } })).toBe(1);
    expect(await db.expenseShare.count({ where: { memberId: w.A } })).toBe(1); // her history is where it was
    expect(await db.expense.count({ where: { groupId: w.g.id, paidById: w.A } })).toBe(1);
    expect(await db.payment.count({ where: { groupId: w.g.id, toId: w.A } })).toBe(2);
    expect((await db.invite.findFirstOrThrow({ where: { groupId: w.g.id, email: w.ada.email } })).acceptedAt).not.toBeNull();
    expect(await seen(w.bea.id)).toEqual(["JP"]);
    expect((await matches(w.bea.id)).length).toBe(1);
    expect((await canSeePassport(w.bea.id, w.ada.id)).ok).toBe(true);
    expect(await nets(w)).toEqual(before); // leave -> invite -> accept: not one paisa moved
  });

  it("Not now: the row is still left and still Ada's (not unlinked), the invitation is closed, nobody else can claim the row, and she can still rejoin herself", async () => {
    const w = await world();
    const before = await nets(w);
    await setMemberLeft(w.g.id, w.A, w.A, true);
    const leftRow = await row(w.A);
    await addRegistered(w.g.id, w.B, w.ada.id, origin);
    const inv = (await loadInvitations(w.ada))[0];
    expect((await declineInvitation(w.ada, inv.key)).ok).toBe(true);
    expect(await row(w.A)).toMatchObject({ id: w.A, accountId: w.ada.id, claimedAt: leftRow.claimedAt, addedBy: "", removedAt: null });
    expect((await row(w.A)).leftAt?.getTime()).toBe(leftRow.leftAt?.getTime());
    expect((await db.invite.findFirstOrThrow({ where: { groupId: w.g.id, email: w.ada.email } })).declinedAt).not.toBeNull();
    expect(await loadInvitations(w.ada)).toEqual([]); // the card is gone
    // Cy (on Loopin, has the link) cannot take Ada's row with "That's me".
    expect(await joinExisting(w.code, w.cy, w.A)).toEqual({ ok: false, reason: "claimed" });
    expect((await row(w.A)).accountId).toBe(w.ada.id);
    expect(await db.member.count({ where: { groupId: w.g.id, accountId: w.cy.id } })).toBe(0);
    expect(await nets(w)).toEqual(before);
    // Declining again, or a stale accept, changes nothing more... and Ada can still come back herself.
    expect((await declineInvitation(w.ada, inv.key)).ok).toBe(true);
    expect((await acceptInvitation(w.ada, inv.key)).ok).toBe(false); // closed on purpose
    expect((await setMemberLeft(w.g.id, w.A, w.A, false)).ok).toBe(true);
    expect((await row(w.A)).leftAt).toBeNull();
  });

  it("nobody but the person puts them back directly: People's 'bring back' is refused for someone with an account, but works for a name nobody has claimed", async () => {
    const w = await world();
    await setMemberLeft(w.g.id, w.A, w.A, true);
    const refused = await setMemberLeft(w.g.id, w.B, w.A, false);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/accept an invitation/);
    expect((await row(w.A)).leftAt).not.toBeNull();
    expect(await db.groupEvent.count({ where: { groupId: w.g.id, kind: "member_rejoined" } })).toBe(0);
    // A name with no account: nobody to ask, so it is direct, as before.
    expect((await setMemberLeft(w.g.id, w.S, w.K, true)).ok).toBe(true);
    expect((await row(w.K)).leftAt).not.toBeNull();
    expect((await setMemberLeft(w.g.id, w.B, w.K, false)).ok).toBe(true);
    expect((await row(w.K)).leftAt).toBeNull();
    // Rejoining yourself is direct.
    expect((await setMember(w.g.id, w.A, w.A, { leftAt: null })).ok).toBe(true);
    expect((await row(w.A)).leftAt).toBeNull();
  });

  it("by email: the same invitation path (the row stays left until she accepts)", async () => {
    const w = await world();
    await setMemberLeft(w.g.id, w.A, w.A, true);
    const r = await inviteByEmail(w.g.id, w.B, w.ada.email, origin);
    expect(r.bad).toEqual([]);
    expect((await row(w.A)).leftAt).not.toBeNull();
    expect((await openInvite(w, w.ada.email)).memberId).toBe(w.A);
  });

  it("a race: A rejoined themself before the invitation was answered: nothing is overwritten, no second invitation, and a stale accept changes nothing", async () => {
    const w = await world();
    await setMemberLeft(w.g.id, w.A, w.A, true);
    await addRegistered(w.g.id, w.B, w.ada.id, origin);
    const token = (await openInvite(w, w.ada.email)).token;
    expect((await setMemberLeft(w.g.id, w.A, w.A, false)).ok).toBe(true); // she rejoined on her own meanwhile
    expect(await loadInvitations(w.ada)).toEqual([]); // nothing left to answer
    const late = await addRegistered(w.g.id, w.B, w.ada.id, origin); // B's late second tap
    expect(late).toEqual({ ok: false, error: "Ada is already in this group." });
    expect((await acceptInvitation(w.ada, token)).ok).toBe(true); // harmless
    expect(await row(w.A)).toMatchObject({ leftAt: null, removedAt: null, addedBy: "", accountId: w.ada.id });
  });
});

describe("the admin and a removed person", () => {
  it("the removal stays until the person accepts; only the admin can invite; the admin cannot reinstate directly; Not now keeps the row removed and owned; accepting clears it on the same row", async () => {
    const w = await world();
    const before = await nets(w);
    expect((await setMemberLeft(w.g.id, w.S, w.A, true)).ok).toBe(true); // Asha removes Ada
    const removed = await row(w.A);
    expect(removed).toMatchObject({ removedById: w.S, accountId: w.ada.id });
    expect(removed.removedAt).not.toBeNull();

    // Not the admin: refused, no invitation.
    const byBea = await addRegistered(w.g.id, w.B, w.ada.id, origin);
    expect(byBea).toEqual({ ok: false, error: "Only the person who looks after the group can bring Ada back." });
    expect(await db.invite.count({ where: { groupId: w.g.id, email: w.ada.email } })).toBe(0);
    // The admin cannot put her back directly either.
    expect((await setMemberLeft(w.g.id, w.S, w.A, false)).ok).toBe(false);
    expect((await row(w.A)).removedAt).not.toBeNull();

    // The admin invites her: still removed.
    const r = await addRegistered(w.g.id, w.S, w.ada.id, origin);
    expect(r.ok && r.invitedBack).toBe(true);
    expect(await row(w.A)).toMatchObject({ removedById: w.S, accountId: w.ada.id });
    expect((await row(w.A)).removedAt).not.toBeNull();
    expect(await confirmUsedPending(w.ada.id)).toEqual([]);
    expect((await row(w.A)).removedAt).not.toBeNull();
    expect(await seen(w.bea.id)).toEqual([]);

    // Not now: still removed, still hers, Cy can't claim it.
    const first = (await loadInvitations(w.ada))[0];
    expect(first.memberId).toBe(w.A);
    expect((await declineInvitation(w.ada, first.key)).ok).toBe(true);
    expect(await row(w.A)).toMatchObject({ accountId: w.ada.id, removedById: w.S });
    expect((await row(w.A)).removedAt).not.toBeNull();
    expect(await joinExisting(w.code, w.cy, w.A)).toMatchObject({ ok: false });
    expect((await acceptInvitation(w.ada, first.key)).ok).toBe(false); // closed

    // A new invitation from the admin, accepted: the same row, cleared.
    expect((await addRegistered(w.g.id, w.S, w.ada.id, origin)).ok).toBe(true);
    const second = (await loadInvitations(w.ada))[0];
    expect((await acceptInvitation(w.ada, second.key)).ok).toBe(true);
    expect(await row(w.A)).toMatchObject({ id: w.A, accountId: w.ada.id, leftAt: null, removedAt: null, removedById: "" });
    expect(await db.member.count({ where: { groupId: w.g.id, accountId: w.ada.id } })).toBe(1);
    expect(await seen(w.bea.id)).toEqual(["JP"]);
    expect(await nets(w)).toEqual(before);
  });

  it("an invitation that did not come from the admin (an older one) cannot bring a removed person back", async () => {
    const w = await world();
    await setMemberLeft(w.g.id, w.S, w.A, true);
    await db.invite.create({ data: { groupId: w.g.id, email: w.ada.email, invitedById: w.B, token: `stale-${stamp}-${n}`, memberId: w.A } });
    expect(await loadInvitations(w.ada)).toEqual([]);
    expect((await acceptInvitation(w.ada, `stale-${stamp}-${n}`)).ok).toBe(false);
    expect((await row(w.A)).removedAt).not.toBeNull();
  });
});

describe("undo can't be used to put someone back", () => {
  it("only the person themself can undo their own 'left the group'; someone else is refused with a calm message", async () => {
    const w = await world();
    const left = await setMemberLeft(w.g.id, w.A, w.A, true);
    if (!left.ok || !left.eventId) throw new Error("no event");
    const byBea = await undoEvent(left.eventId, w.B);
    expect(byBea.ok).toBe(false);
    expect(!byBea.ok && byBea.error).toBe("Only Ada can undo leaving the group. You can invite them back from People.");
    const byAdmin = await undoEvent(left.eventId, w.S);
    expect(byAdmin.ok).toBe(false);
    expect((await row(w.A)).leftAt).not.toBeNull();
    // Ada herself can (even though she has left).
    const byAda = await undoEvent(left.eventId, w.A);
    expect(byAda.ok).toBe(true);
    expect((await row(w.A)).leftAt).toBeNull();
  });

  it("if the admin removed her since, she cannot undo her way back in", async () => {
    const w = await world();
    const left = await setMemberLeft(w.g.id, w.A, w.A, true);
    if (!left.ok || !left.eventId) throw new Error("no event");
    await db.member.update({ where: { id: w.A }, data: { removedAt: new Date(), removedById: w.S } });
    expect((await undoEvent(left.eventId, w.A)).ok).toBe(false);
    expect((await row(w.A)).removedAt).not.toBeNull();
    expect((await row(w.A)).leftAt).not.toBeNull();
  });

  it("a move-out: someone else cannot undo it for a person with an account (refused before anything is touched)", async () => {
    const w = await world();
    await db.member.update({ where: { id: w.A }, data: { leftAt: new Date() } });
    const r = await undoMoveOut(w.g.id, w.B, w.A, { bills: [] } as never);
    expect(r).toEqual({ ok: false, error: "Only Ada can undo moving out. You can invite them back from People." });
    expect((await row(w.A)).leftAt).not.toBeNull();
  });
});
