import { afterAll, describe, expect, it, vi } from "vitest";

// Batch R3: "Want to go". Every account and group is made fresh (throwaway database), and every check is on what a person can
// SEE, since the rules (who may see whose list) live in src/lib/wishes-db.ts.
// The cast: A (Ada) and B (Bea) are friends in a group. A wants {JP, IS}; B wants {JP, PE}.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
process.env.MAIL_OUTBOX = "1";

const { db } = await import("@/lib/db");
const { COUNTRIES } = await import("@/lib/geo");
const { blockAccount, unblockAccount } = await import("@/lib/blocks");
const { deleteAccount } = await import("@/lib/auth");
const { loadInvitations } = await import("@/lib/invitations");
const { addWishes, areCurrentFriends, currentFriends, loadMyWishes, matches, mySharing, planTogether, removeWish, setShares, sharedWithMe } = await import("@/lib/wishes-db");
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
  ];
  for (const [why, change] of nothing)
    it(`shows nothing when ${why}`, async () => {
      const p = await pair();
      expect(await seen(p.viewer.id)).toEqual(["JP"]); // it works before the change
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
