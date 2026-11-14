import { afterAll, describe, expect, it, vi } from "vitest";

// Batch R3: "Want to go". Every account and group is made fresh (throwaway database), and every check is on what a person can
// SEE, since the rules (who may see whose list) live in src/lib/wishes-db.ts.
// The cast: A (Ada) and B (Bea) are friends in a group. A wants {JP, IS}; B wants {JP, PE}.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
// The server actions: the signed-in account is whatever the test sets; a redirect is caught and its address handed back.
const session = vi.hoisted(() => ({ account: null as null | { id: string; name: string; email: string } }));
vi.mock("@/lib/identity", async (orig) => ({ ...(await orig<typeof import("@/lib/identity")>()), getAccount: async () => session.account }));
vi.mock("@/lib/fresh-redirect", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
process.env.MAIL_OUTBOX = "1";

const { db } = await import("@/lib/db");
const { COUNTRIES } = await import("@/lib/geo");
const { blockAccount, unblockAccount } = await import("@/lib/blocks");
const { deleteAccount } = await import("@/lib/auth");
const { loadInvitations, declineInvitation } = await import("@/lib/invitations");
const { addWishes, areCurrentFriends, currentFriends, findSharedTrip, loadMyWishes, matches, mySharing, planTogether, removeWish, setShares, sharedWithMe } = await import("@/lib/wishes-db");
const { addRegistered } = await import("@/lib/invites");
const { setMemberLeft } = await import("@/lib/people");
const { canSeePassport } = await import("@/lib/passport-db");
const { SHARE_ROW_LIMIT } = await import("@/lib/wishes");
const { addWishesAction, removeWishAction, shareWishesAction, planTogetherAction } = await import("@/app/wish-actions");
const { loadMyDataExtra } = await import("@/lib/my-data-extra");
const { myDataCsv } = await import("@/lib/csv");
const { mutualMatches, visibleTo, cleanCountry } = await import("@/lib/wishes");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
let n = 0;

async function account(name: string) {
  const a = await db.account.create({ data: { email: `wish-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}
type Row = { a: { id: string; name: string }; left?: boolean; removed?: boolean; pending?: boolean };
async function group(rows: Row[], extra: { deletedAt?: Date } = {}) {
  const g = await db.group.create({
    data: {
      name: `Wish group ${++n} ${stamp}`,
      inviteCode: `wish-${n}-${stamp}`,
      ...extra,
      members: {
        create: rows.map((r) => ({
          name: r.a.name,
          accountId: r.a.id,
          claimedAt: new Date(),
          addedBy: r.pending ? "someone-else" : "",
          seenAt: null,
          leftAt: r.left ? new Date() : null,
          removedAt: r.removed ? new Date() : null,
        })),
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  return g;
}
// A fresh pair who are friends, each with {JP}; the owner (first) has shown JP to the viewer (second).
async function pair() {
  const owner = await account("Olive");
  const viewer = await account("Vic");
  const g = await group([{ a: owner }, { a: viewer }]);
  await addWishes(owner.id, ["JP"]);
  await addWishes(viewer.id, ["JP"]);
  await setShares(owner.id, "JP", [viewer.id]);
  await setShares(viewer.id, "JP", [owner.id]); // both ways, so there is a match to lose
  return { owner, viewer, g };
}
// (Created in the same millisecond, so compared as a set: sorted.)
const mine = async (id: string) => (await loadMyWishes(id)).sort();
const seen = async (viewerId: string) => (await sharedWithMe(viewerId)).flatMap((s) => s.countries);

afterAll(async () => {
  await db.wishShare.deleteMany({ where: { OR: [{ ownerId: { in: accountIds } }, { friendId: { in: accountIds } }] } });
  await db.wishPlace.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.block.deleteMany({ where: { OR: [{ blockerId: { in: accountIds } }, { blockedId: { in: accountIds } }] } });
  await db.invite.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("the pure rules", () => {
  it("only real country codes, any case", () => {
    expect(cleanCountry("jp")).toBe("JP");
    expect(cleanCountry("Japan")).toBeNull();
    expect(cleanCountry("ZZ")).toBeNull();
    expect(cleanCountry("*")).toBeNull();
  });
  it("a friend sees what the rows cover: '*' is the whole list; not a friend, nothing", () => {
    expect(visibleTo(["JP", "IS", "PE"], ["JP"], true)).toEqual(["JP"]);
    expect(visibleTo(["JP", "IS", "PE"], ["*"], true)).toEqual(["IS", "JP", "PE"]); // by name: Iceland, Japan, Peru
    expect(visibleTo(["JP"], ["*"], false)).toEqual([]);
  });
  it("a match needs both lists AND both shares: one-sided is no match", () => {
    expect(mutualMatches(["JP", "IS"], ["JP"], ["JP", "PE"], ["*"])).toEqual(["JP"]);
    expect(mutualMatches(["JP"], [], ["JP"], ["JP"])).toEqual([]);
    expect(mutualMatches(["JP"], ["JP"], ["PE"], ["*"])).toEqual([]);
  });
});

describe("who sees what", () => {
  it("A {JP, IS} and B {JP, PE}: A shows JP, B shows the whole list; the match is JP both ways; stopping ends it", async () => {
    const A = await account("Ada");
    const B = await account("Bea");
    await group([{ a: A }, { a: B }]);
    await addWishes(A.id, ["JP", "IS"]);
    await addWishes(B.id, ["JP", "PE"]);
    expect((await setShares(A.id, "JP", [B.id])).ok).toBe(true);
    expect((await setShares(B.id, "*", [A.id])).ok).toBe(true);

    expect(await sharedWithMe(A.id)).toEqual([{ ownerId: B.id, name: "Bea", countries: ["JP", "PE"] }]); // everything B has
    expect(await sharedWithMe(B.id)).toEqual([{ ownerId: A.id, name: "Ada", countries: ["JP"] }]); // only JP, not Iceland
    expect(await matches(A.id)).toEqual([{ friendId: B.id, name: "Bea", countries: ["JP"] }]);
    expect(await matches(B.id)).toEqual([{ friendId: A.id, name: "Ada", countries: ["JP"] }]);

    // The whole list includes places added later.
    await addWishes(B.id, ["IT"]);
    expect(await seen(A.id)).toEqual(["IT", "JP", "PE"]);

    // A stops sharing JP: B sees nothing of A, and there is no match any more. (A still sees B's list.)
    await setShares(A.id, "JP", []);
    expect(await sharedWithMe(B.id)).toEqual([]);
    expect(await matches(A.id)).toEqual([]);
    expect(await matches(B.id)).toEqual([]);
    expect(await seen(A.id)).toEqual(["IT", "JP", "PE"]);
  });

  it("your own list is yours: the list loads only for the owner's id", async () => {
    const A = await account("Ada");
    await addWishes(A.id, ["JP"]);
    expect(await mine(A.id)).toEqual(["JP"]);
    expect(await mine("nobody")).toEqual([]);
  });

  const nothing: [string, (p: Awaited<ReturnType<typeof pair>>) => Promise<unknown>][] = [
    ["no share row", async (p) => db.wishShare.deleteMany({ where: { ownerId: p.owner.id } })],
    ["the friend left the only shared group", async (p) => db.member.updateMany({ where: { accountId: p.owner.id }, data: { leftAt: new Date() } })],
    ["you left the only shared group", async (p) => db.member.updateMany({ where: { accountId: p.viewer.id }, data: { leftAt: new Date() } })],
    ["the friend was removed", async (p) => db.member.updateMany({ where: { accountId: p.owner.id }, data: { removedAt: new Date() } })],
    ["the friend is only pending (added, never opened it)", async (p) => db.member.updateMany({ where: { accountId: p.owner.id }, data: { addedBy: "someone-else", seenAt: null } })],
    ["the group was deleted", async (p) => db.group.update({ where: { id: p.g.id }, data: { deletedAt: new Date() } })],
    ["you are only pending (added, never opened it)", async (p) => db.member.updateMany({ where: { accountId: p.viewer.id }, data: { addedBy: "someone-else", seenAt: null } })],
    ["you were removed", async (p) => db.member.updateMany({ where: { accountId: p.viewer.id }, data: { removedAt: new Date(), leftAt: new Date() } })],
  ];
  for (const [why, change] of nothing)
    it(`shows nothing when ${why}`, async () => {
      const p = await pair();
      expect(await seen(p.viewer.id)).toEqual(["JP"]); // it works before the change
      expect((await matches(p.viewer.id)).map((m) => m.countries)).toEqual([["JP"]]); // and so does the match
      await change(p);
      expect(await seen(p.viewer.id)).toEqual([]);
      expect(await matches(p.viewer.id)).toEqual([]);
    });

  it("a block either way ends the shares, and unblocking doesn't bring them back", async () => {
    for (const blocker of ["owner", "viewer"] as const) {
      const p = await pair();
      await setShares(p.viewer.id, "JP", [p.owner.id]); // a match both ways
      expect((await matches(p.viewer.id)).length).toBe(1);
      const [x, y] = blocker === "owner" ? [p.owner.id, p.viewer.id] : [p.viewer.id, p.owner.id];
      await blockAccount(x, y);
      expect(await db.wishShare.count({ where: { OR: [{ ownerId: p.owner.id, friendId: p.viewer.id }, { ownerId: p.viewer.id, friendId: p.owner.id }] } })).toBe(0); // rows deleted both ways
      expect(await seen(p.viewer.id)).toEqual([]);
      expect(await matches(p.viewer.id)).toEqual([]);
      // Even a row put back by hand shows nothing while the block stands.
      await db.wishShare.create({ data: { ownerId: p.owner.id, friendId: p.viewer.id, country: "JP" } });
      expect(await seen(p.viewer.id)).toEqual([]);
      expect(await areCurrentFriends(p.owner.id, p.viewer.id)).toBe(false);
      await db.wishShare.deleteMany({ where: { ownerId: p.owner.id } });
      await unblockAccount(x, y);
      expect(await seen(p.viewer.id)).toEqual([]); // not restored
    }
  });

  it("a share row inserted directly for a stranger shows nothing", async () => {
    const A = await account("Ada");
    const stranger = await account("Sam");
    await addWishes(A.id, ["JP"]);
    await db.wishShare.create({ data: { ownerId: A.id, friendId: stranger.id, country: "JP" } });
    await db.wishShare.create({ data: { ownerId: A.id, friendId: stranger.id, country: "*" } });
    expect(await sharedWithMe(stranger.id)).toEqual([]);
    expect(await matches(stranger.id)).toEqual([]);
  });
});

describe("writing", () => {
  it("sharing with a non-friend creates no row", async () => {
    const A = await account("Ada");
    const B = await account("Bea");
    const stranger = await account("Sam");
    await group([{ a: A }, { a: B }]);
    await addWishes(A.id, ["JP"]);
    const r = await setShares(A.id, "JP", [stranger.id, B.id]);
    expect(r).toMatchObject({ ok: true, shared: 1 });
    expect(await db.wishShare.count({ where: { ownerId: A.id, friendId: stranger.id } })).toBe(0);
    expect(await db.wishShare.count({ where: { ownerId: A.id, friendId: B.id } })).toBe(1);
    // A place that isn't on your list can't be shared.
    expect((await setShares(A.id, "PE", [B.id])).ok).toBe(false);
    expect(await db.wishShare.count({ where: { ownerId: A.id, country: "PE" } })).toBe(0);
  });

  it("removing a country only changes your own list (and stops sharing it)", async () => {
    const A = await account("Ada");
    const B = await account("Bea");
    await group([{ a: A }, { a: B }]);
    await addWishes(A.id, ["JP", "IS"]);
    await addWishes(B.id, ["JP", "PE"]);
    await setShares(A.id, "JP", [B.id]);
    expect(await removeWish(A.id, "JP")).toBe(true);
    expect(await mine(A.id)).toEqual(["IS"]);
    expect(await mine(B.id)).toEqual(["JP", "PE"]); // B's list is untouched
    expect(await db.wishShare.count({ where: { ownerId: A.id, country: "JP" } })).toBe(0);
    await removeWish(A.id, "PE"); // not on A's list: nothing happens to B's PE
    expect(await mine(B.id)).toEqual(["JP", "PE"]);
    expect(await removeWish(A.id, "Japan")).toBe(false);
  });

  it("at 198 places, adding 5 adds 2, makes 200 and says the list is full", async () => {
    const A = await account("Ada");
    const codes = COUNTRIES.map((c) => c.code);
    const first = codes.slice(0, 198);
    expect(await addWishes(A.id, first)).toEqual({ added: 198, full: false });
    const r = await addWishes(A.id, codes.slice(198, 203)); // 5 more
    expect(r).toEqual({ added: 2, full: true });
    expect((await loadMyWishes(A.id)).length).toBe(200);
    expect(await addWishes(A.id, [codes[210]])).toEqual({ added: 0, full: true });
    expect(await addWishes(A.id, [codes[0]])).toEqual({ added: 0, full: false }); // one already there is fine, not 'full'
  });

  it("adding the same place twice is success, once", async () => {
    const A = await account("Ada");
    expect(await addWishes(A.id, ["JP", "jp", "JP"])).toEqual({ added: 1, full: false });
    expect(await addWishes(A.id, ["JP"])).toEqual({ added: 0, full: false });
    expect(await addWishes(A.id, ["Narnia", "", "*"])).toEqual({ added: 0, full: false }); // no free text
    expect(await mine(A.id)).toEqual(["JP"]);
  });

  it("currentFriends is stricter than the old passport list: left or removed people are not friends", async () => {
    const A = await account("Ada");
    const left = await account("Lee");
    const gone = await account("Gus");
    const here = await account("Hal");
    await group([{ a: A }, { a: left, left: true }, { a: gone, removed: true }, { a: here }]);
    expect((await currentFriends(A.id)).map((f) => f.name)).toEqual(["Hal"]);
  });
});

describe("plan together", () => {
  async function matched() {
    const A = await account("Ada");
    const B = await account("Bea");
    await group([{ a: A }, { a: B }]);
    await addWishes(A.id, ["JP"]);
    await addWishes(B.id, ["JP"]);
    await setShares(A.id, "JP", [B.id]);
    await setShares(B.id, "JP", [A.id]);
    return { A, B };
  }
  const opts = (key?: string) => ({ origin: "https://loopin.test", key });
  const tripsFor = (accountId: string) => db.group.findMany({ where: { type: "trip", tripCountry: "JP", members: { some: { accountId } } } });
  const key = () => `plan-${stamp}-${++n}-aaaa`.slice(0, 40).padEnd(20, "a");

  it("makes one trip named Japan (country JP); the friend has a pending invitation, not a place in it", async () => {
    const { A, B } = await matched();
    const k = key();
    const r = await planTogether(A, B.id, "JP", opts(k));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    groupIds.push(r.groupId);
    const g = await db.group.findUniqueOrThrow({ where: { id: r.groupId }, include: { members: true } });
    expect([g.name, g.tripCountry, g.type]).toEqual(["Japan", "JP", "trip"]);
    // The friend is a name-only row until they tap Join; nothing joined them.
    expect(g.members.find((m) => m.accountId === B.id)).toBeUndefined();
    const invites = await loadInvitations(await db.account.findUniqueOrThrow({ where: { id: B.id } }));
    expect(invites.some((i) => i.groupId === r.groupId)).toBe(true);
    // The same request key again: the same group, not a second one.
    const again = await planTogether(A, B.id, "JP", opts(k));
    expect(again).toMatchObject({ ok: true, groupId: r.groupId, existing: true });
    expect((await tripsFor(A.id)).length).toBe(1);
  });

  it("two taps at the same instant with one request key still make one group", async () => {
    const { A, B } = await matched();
    const k = key();
    const rs = await Promise.all([planTogether(A, B.id, "JP", opts(k)), planTogether(A, B.id, "JP", opts(k))]);
    for (const r of rs) if (r.ok) groupIds.push(r.groupId);
    expect(rs.some((r) => r.ok)).toBe(true);
    expect((await tripsFor(A.id)).length).toBe(1);
  });

  it("if you two already have a Japan trip, it is returned (Open your Japan trip)", async () => {
    const { A, B } = await matched();
    const first = await planTogether(A, B.id, "JP", opts(key()));
    if (first.ok) groupIds.push(first.groupId);
    const second = await planTogether(A, B.id, "JP", opts(key())); // a different key: still the same trip
    expect(second.ok && second.existing).toBe(true);
    expect(second.ok && first.ok && second.groupId === first.groupId).toBe(true);
  });

  it("is refused with no match (only one of you shared), and makes nothing", async () => {
    const A = await account("Ada");
    const B = await account("Bea");
    await group([{ a: A }, { a: B }]);
    await addWishes(A.id, ["JP"]);
    await addWishes(B.id, ["JP"]);
    await setShares(A.id, "JP", [B.id]); // B never showed A
    const r = await planTogether(A, B.id, "JP", opts(key()));
    expect(r.ok).toBe(false);
    expect((await tripsFor(A.id)).length).toBe(0);
    expect((await planTogether(B, A.id, "JP", opts(key()))).ok).toBe(false); // B can't either: A's share is one-sided from B's view
  });

  it("is refused when blocked, and when you are not friends", async () => {
    const { A, B } = await matched();
    await blockAccount(B.id, A.id);
    expect((await planTogether(A, B.id, "JP", opts(key()))).ok).toBe(false);
    const stranger = await account("Sam");
    expect((await planTogether(A, stranger.id, "JP", opts(key()))).ok).toBe(false);
    expect((await planTogether(A, A.id, "JP", opts(key()))).ok).toBe(false);
    expect((await planTogether(A, B.id, "Japan", opts(key()))).ok).toBe(false);
    expect((await tripsFor(A.id)).length).toBe(0);
  });
});

describe("plan together: blocks, left friends, and 'not now'", () => {
  const opts = (key?: string) => ({ origin: "https://loopin.test", key });
  const k = () => `plan2-${stamp}-${++n}-bbbb`.slice(0, 40).padEnd(20, "b");
  async function matched() {
    const A = await account("Ada");
    const B = await account("Bea");
    await group([{ a: A }, { a: B }]);
    await addWishes(A.id, ["JP"]);
    await addWishes(B.id, ["JP"]);
    await setShares(A.id, "JP", [B.id]);
    await setShares(B.id, "JP", [A.id]);
    return { A, B };
  }

  it("a block alone refuses: shares put back by hand after the block still can't plan, and unblocking (with those rows) works again", async () => {
    const { A, B } = await matched();
    expect((await matches(A.id)).length).toBe(1); // a real match before the block
    await blockAccount(B.id, A.id);
    await db.wishShare.createMany({ data: [{ ownerId: A.id, friendId: B.id, country: "JP" }, { ownerId: B.id, friendId: A.id, country: "JP" }] });
    expect(await db.wishShare.count({ where: { OR: [{ ownerId: A.id }, { ownerId: B.id }] } })).toBe(2); // both rows exist; only the block stands in the way
    const r = await planTogether(A, B.id, "JP", opts(k()));
    expect(r.ok).toBe(false);
    expect((await planTogether(B, A.id, "JP", opts(k()))).ok).toBe(false);
    expect(await db.group.count({ where: { type: "trip", tripCountry: "JP", members: { some: { accountId: A.id } } } })).toBe(0);
    await unblockAccount(B.id, A.id);
    const ok = await planTogether(A, B.id, "JP", opts(k())); // proves the block was the only reason
    if (ok.ok) groupIds.push(ok.groupId);
    expect(ok.ok).toBe(true);
  });

  it("setShares leaves no row behind for someone blocked: nothing is created, and the count says 0 shared", async () => {
    const { A, B } = await matched();
    await db.wishShare.deleteMany({ where: { ownerId: A.id } });
    await blockAccount(B.id, A.id);
    const r = await setShares(A.id, "JP", [B.id]);
    expect(r).toMatchObject({ ok: true, shared: 0 });
    expect(await db.wishShare.count({ where: { ownerId: A.id } })).toBe(0);
  });

  it("findSharedTrip does not offer 'Open your Japan trip' for a trip the friend left", async () => {
    const { A, B } = await matched();
    const mk = async (bLeft: boolean) => {
      const g = await db.group.create({
        data: {
          name: `Japan ${++n} ${stamp}`, type: "trip", tripCountry: "JP", inviteCode: `trip-${n}-${stamp}`,
          members: { create: [{ name: "Ada", accountId: A.id, claimedAt: new Date() }, { name: "Bea", accountId: B.id, claimedAt: new Date(), leftAt: bLeft ? new Date() : null }] },
        },
      });
      groupIds.push(g.id);
      return g;
    };
    await mk(true);
    expect(await findSharedTrip(A.id, B.id, "JP")).toBeNull(); // she left it
    const live = await mk(false);
    expect((await findSharedTrip(A.id, B.id, "JP"))?.groupId).toBe(live.id); // positive control
  });

  it("if the friend said Not now to a Japan trip from you in the last 30 days, no new trip: a calm message; after 30 days it goes ahead", async () => {
    const { A, B } = await matched();
    const first = await planTogether(A, B.id, "JP", opts(k()));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    groupIds.push(first.groupId);
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: first.groupId } });
    const bRow = await db.account.findUniqueOrThrow({ where: { id: B.id } });
    expect((await declineInvitation(bRow, inv.token)).ok).toBe(true);
    const again = await planTogether(A, B.id, "JP", opts(k()));
    expect(again).toEqual({ ok: false, error: "Bea said not now to Japan. Try again later." });
    expect(await db.group.count({ where: { type: "trip", tripCountry: "JP", members: { some: { accountId: A.id } } } })).toBe(1); // no second trip
    await db.invite.update({ where: { id: inv.id }, data: { declinedAt: new Date(Date.now() - 31 * 86_400_000) } });
    const later = await planTogether(A, B.id, "JP", opts(k()));
    if (later.ok) groupIds.push(later.groupId);
    expect(later.ok).toBe(true);
  });
});

describe("someone who left is brought back by another member", () => {
  // A and B are friends with a match; A leaves on their own; B adds A again.
  async function leftThenReadded() {
    const A = await account("Ada");
    const B = await account("Bea");
    await db.account.update({ where: { id: A.id }, data: { passportChoiceAt: new Date() } }); // A has said yes to showing a passport
    const g = await group([{ a: A }, { a: B }]);
    const a = g.members.find((m) => m.accountId === A.id)!.id;
    const b = g.members.find((m) => m.accountId === B.id)!.id;
    await addWishes(A.id, ["JP"]);
    await addWishes(B.id, ["JP"]);
    await setShares(A.id, "JP", [B.id]);
    await setShares(B.id, "JP", [A.id]);
    expect((await canSeePassport(B.id, A.id)).ok).toBe(true); // before: B can open A's passport
    expect((await matches(B.id)).length).toBe(1);
    expect((await setMemberLeft(g.id, a, a, true)).ok).toBe(true); // A leaves on their own (nothing owed)
    return { A, B, g, a, b };
  }

  it("B re-adds A: A is pending, not a current member; B sees none of A's list, no match, no passport; A sees nothing of B's either", async () => {
    const { A, B, g, a, b } = await leftThenReadded();
    const r = await addRegistered(g.id, b, A.id, "https://loopin.test");
    expect(r.ok).toBe(true);
    const row = await db.member.findUniqueOrThrow({ where: { id: a } });
    expect(row).toMatchObject({ leftAt: null, addedBy: b, seenAt: null }); // pending, the same as a fresh invitation
    expect(await db.member.count({ where: { groupId: g.id, accountId: A.id } })).toBe(1); // same row: balances and history are untouched
    expect(await currentFriends(B.id)).toEqual([]);
    expect(await seen(B.id)).toEqual([]);
    expect(await matches(B.id)).toEqual([]);
    expect(await matches(A.id)).toEqual([]);
    expect(await seen(A.id)).toEqual([]);
    expect((await canSeePassport(B.id, A.id)).ok).toBe(false);
    // They have a normal invitation waiting.
    const invites = await loadInvitations(await db.account.findUniqueOrThrow({ where: { id: A.id } }));
    expect(invites.some((i) => i.groupId === g.id)).toBe(true);
    // The share rows are kept (paused), not deleted.
    expect(await db.wishShare.count({ where: { OR: [{ ownerId: A.id }, { ownerId: B.id }] } })).toBe(2);
  });

  it("when A opens the group (seenAt set) everything works again", async () => {
    const { A, B, g, a, b } = await leftThenReadded();
    await addRegistered(g.id, b, A.id, "https://loopin.test");
    await db.member.update({ where: { id: a }, data: { seenAt: new Date() } }); // what opening the group does
    expect(await seen(B.id)).toEqual(["JP"]);
    expect((await matches(B.id)).length).toBe(1);
    expect((await canSeePassport(B.id, A.id)).ok).toBe(true);
  });

  it("'bring back' from People by another member is pending too; A rejoining themself is not", async () => {
    const { A, B, g, a, b } = await leftThenReadded();
    expect((await setMemberLeft(g.id, b, a, false)).ok).toBe(true);
    expect(await db.member.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ leftAt: null, addedBy: b, seenAt: null });
    expect(await seen(B.id)).toEqual([]);
    // Another round: A leaves again... (pending people can still leave) and rejoins themself.
    await db.member.update({ where: { id: a }, data: { addedBy: "", seenAt: null, leftAt: new Date() } });
    expect((await setMemberLeft(g.id, a, a, false)).ok).toBe(true);
    expect(await db.member.findUniqueOrThrow({ where: { id: a } })).toMatchObject({ leftAt: null, addedBy: "" }); // unchanged: their own choice
    expect(await seen(B.id)).toEqual(["JP"]);
    void A;
  });

  it("the admin bringing back a REMOVED person: pending too (and the removal is cleared)", async () => {
    const A = await account("Ada"); // looks after the group (first in)
    const B = await account("Bea");
    const g = await db.group.create({
      data: {
        name: `Wish group ${++n} ${stamp}`, inviteCode: `wish-${n}-${stamp}`,
        members: { create: [{ name: "Ada", accountId: A.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Bea", accountId: B.id, claimedAt: new Date() }] },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const a = g.members.find((m) => m.accountId === A.id)!.id;
    const b = g.members.find((m) => m.accountId === B.id)!.id;
    expect((await setMemberLeft(g.id, a, b, true)).ok).toBe(true); // removed
    expect((await setMemberLeft(g.id, a, b, false)).ok).toBe(true); // brought back
    expect(await db.member.findUniqueOrThrow({ where: { id: b } })).toMatchObject({ leftAt: null, removedAt: null, removedById: "", addedBy: a, seenAt: null });
    expect(await currentFriends(A.id)).toEqual([]);
  });
});

describe("sharing: paused friends and the row limit", () => {
  it("mySharing lists a paused friend (now: false); saving the sheet does not delete the paused row; it shows again when they are back", async () => {
    const A = await account("Ada");
    const B = await account("Bea");
    const C = await account("Cat");
    const gb = await group([{ a: A }, { a: B }]);
    await group([{ a: A }, { a: C }]);
    await addWishes(A.id, ["JP"]);
    expect((await setShares(A.id, "JP", [B.id, C.id])).shared).toBe(2);
    await db.member.updateMany({ where: { groupId: gb.id, accountId: B.id }, data: { leftAt: new Date() } }); // Bea leaves the only group they share
    const mineNow = await mySharing(A.id);
    expect(mineNow.map((s) => [s.name, s.now]).sort()).toEqual([["Bea", false], ["Cat", true]]);
    // A saves the sheet with only Cat ticked (Bea is not in the sheet any more): Bea's paused row stays.
    expect((await setShares(A.id, "JP", [C.id])).ok).toBe(true);
    expect(await db.wishShare.count({ where: { ownerId: A.id, friendId: B.id } })).toBe(1);
    // ...but a current friend who is un-ticked does lose theirs.
    expect((await setShares(A.id, "JP", [])).ok).toBe(true);
    expect(await db.wishShare.count({ where: { ownerId: A.id, friendId: C.id } })).toBe(0);
    expect(await db.wishShare.count({ where: { ownerId: A.id, friendId: B.id } })).toBe(1);
    // Bea is back in the group: A's list shows to Bea again.
    await addWishes(B.id, ["JP"]);
    await db.member.updateMany({ where: { groupId: gb.id, accountId: B.id }, data: { leftAt: null } });
    expect(await seen(B.id)).toEqual(["JP"]);
  });

  it("at SHARE_ROW_LIMIT a new share is refused with a calm message and no row", async () => {
    const A = await account("Ada");
    const B = await account("Bea");
    await group([{ a: A }, { a: B }]);
    await addWishes(A.id, ["JP"]);
    const codes = COUNTRIES.map((c) => c.code).slice(0, 200);
    const fillers = [];
    for (let i = 0; i < SHARE_ROW_LIMIT / 200; i++) fillers.push(await account(`Fill${i}`));
    await db.wishShare.createMany({ data: fillers.flatMap((f) => codes.map((country) => ({ ownerId: A.id, friendId: f.id, country }))) });
    expect(await db.wishShare.count({ where: { ownerId: A.id } })).toBe(SHARE_ROW_LIMIT);
    const r = await setShares(A.id, "JP", [B.id]);
    expect(r).toEqual({ ok: false, shared: 0, error: "You’re sharing with a lot of people already." });
    expect(await db.wishShare.count({ where: { ownerId: A.id, friendId: B.id } })).toBe(0);
  });
});

describe("the actions: the owner is always the signed-in account", () => {
  const go = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return "";
    } catch (e) {
      const m = String((e as Error).message);
      if (!m.startsWith("REDIRECT ")) throw e;
      return m.slice("REDIRECT ".length);
    }
  };
  const errorOf = (url: string) => new URL(url, "http://x").searchParams.get("error");
  const form = (fields: Record<string, string | string[]>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
    return f;
  };
  const signInAs = (a: { id: string; name: string; email: string }) => void (session.account = a);

  it("forged owner fields are ignored: add, share and remove only ever change the signed-in account's own rows", async () => {
    const A = await account("Ada");
    const B = await account("Bea");
    await group([{ a: A }, { a: B }]);
    await addWishes(B.id, ["JP", "PE"]);
    await setShares(B.id, "JP", [A.id]);
    signInAs(A);
    // Add
    await go(() => addWishesAction(form({ country: ["IS"], accountId: B.id, ownerId: B.id, owner: B.id })));
    expect(await mine(A.id)).toEqual(["IS"]);
    expect(await mine(B.id)).toEqual(["JP", "PE"]);
    // Share: the row is A's, to B; none are made in B's name.
    await go(() => shareWishesAction(form({ scope: "IS", friend: [B.id], ownerId: B.id, accountId: B.id })));
    expect(await db.wishShare.count({ where: { ownerId: A.id, friendId: B.id, country: "IS" } })).toBe(1);
    expect(await db.wishShare.count({ where: { ownerId: B.id } })).toBe(1); // only B's own earlier row to A
    // Remove: only A's list is touched, B's JP stays (and its share row).
    await addWishes(A.id, ["JP"]);
    await go(() => removeWishAction(form({ country: "JP", accountId: B.id, ownerId: B.id })));
    expect(await mine(A.id)).toEqual(["IS"]);
    expect(await mine(B.id)).toEqual(["JP", "PE"]);
    expect(await db.wishShare.count({ where: { ownerId: B.id, country: "JP" } })).toBe(1);
  });

  it("nobody signed in is sent to sign in, and nothing is written", async () => {
    session.account = null;
    const url = await go(() => addWishesAction(form({ country: ["JP"] })));
    expect(url).toContain("/signin");
  });

  it("sharing is limited to 30 changes an hour", async () => {
    const A = await account("Ada");
    const B = await account("Bea");
    await group([{ a: A }, { a: B }]);
    await addWishes(A.id, ["JP"]);
    signInAs(A);
    for (let i = 0; i < 30; i++) expect(errorOf(await go(() => shareWishesAction(form({ scope: "JP", friend: [B.id] }))))).toBeNull();
    expect(errorOf(await go(() => shareWishesAction(form({ scope: "JP", friend: [B.id] }))))).toBe("You’ve changed sharing a lot just now. Try again in a bit.");
  });

  it("planning is limited to 5 a day (each tap counts, even a refused one)", async () => {
    const A = await account("Ada");
    const S = await account("Sam"); // not a friend: every try is refused, but still counted
    signInAs(A);
    for (let i = 0; i < 5; i++) expect(errorOf(await go(() => planTogetherAction(form({ country: "JP", friendId: S.id }))))).toBe("You can plan together once you both want to go and have shared it.");
    expect(errorOf(await go(() => planTogetherAction(form({ country: "JP", friendId: S.id }))))).toBe("You’ve planned a few trips today. Try again tomorrow.");
  });
});

describe("deleting an account, and download my data", () => {
  it("removes A's places and shares on both sides; B's list is untouched", async () => {
    const A = await account("Ada");
    const B = await account("Bea");
    await group([{ a: A }, { a: B }]);
    await addWishes(A.id, ["JP", "IS"]);
    await addWishes(B.id, ["JP", "PE"]);
    await setShares(A.id, "JP", [B.id]);
    await setShares(B.id, "*", [A.id]);
    await deleteAccount(A.id);
    expect(await db.wishPlace.count({ where: { accountId: A.id } })).toBe(0);
    expect(await db.wishShare.count({ where: { OR: [{ ownerId: A.id }, { friendId: A.id }] } })).toBe(0); // both directions
    expect(await mine(B.id)).toEqual(["JP", "PE"]);
    expect(await db.wishShare.count({ where: { ownerId: B.id } })).toBe(0); // B's share to A went with A
  });

  it("my data has A's list and who A showed each place to (first names), and nothing of B's list", async () => {
    const A = await account("Ada");
    const B = await account("Bea");
    await group([{ a: A }, { a: B }]);
    await addWishes(A.id, ["JP", "IS"]);
    await addWishes(B.id, ["JP", "PE"]);
    await setShares(A.id, "JP", [B.id]);
    await setShares(B.id, "*", [A.id]);
    const row = await db.account.findUniqueOrThrow({ where: { id: A.id } });
    const now = new Date("2026-11-13T10:00:00Z");
    const extra = await loadMyDataExtra(row, {}, {}, now, "UTC");
    expect(extra.wishes).toEqual([
      { country: "Iceland", sharedWith: [] },
      { country: "Japan", sharedWith: ["Bea"] },
    ]);
    const csv = myDataCsv({ email: row.email, name: "Ada", createdAt: now }, [], now, "UTC", [], extra);
    expect(csv).toContain("Places you want to go");
    expect(csv).toContain("Japan,Bea");
    expect(csv).not.toContain("Peru"); // B's list is B's
    expect(csv).not.toContain(B.email);
    // And the mutual share list shows B's list to A in the app, never in A's file.
    expect(await seen(A.id)).toEqual(["JP", "PE"]);
    expect((await mySharing(A.id)).map((s) => [s.name, s.country, s.now])).toEqual([["Bea", "JP", true]]);
  });
});
