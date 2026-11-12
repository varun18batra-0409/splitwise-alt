import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// SEC-01: an old guest cookie must stop working once its name is linked to an email, and must not start working again
// after that email account is deleted. A guest grant in the cookie is "memberId~epoch" (a plain id = epoch 0); the member's
// grantEpoch goes up when the name is linked (signInAs, setMyMemberId) and when the account is deleted (deleteAccount).
//
// Hand-worked epochs for member X: starts 0. Phone 1 and phone 2 both hold the guest name (epoch 0).
//   phone 1 signs in with email A      -> X linked to A, epoch 1.  Phone 2's copy (0) is refused.
//   A deletes the account (phone 1)    -> X unlinked, epoch 2.      A copy that says 1 is refused; phone 1 is given "X~2".
//   phone 1 signs in again (email B)   -> X linked to B, epoch 3.   Phone 1's old "X~2" is refused.
const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined),
    set: (n: string, v: string) => {
      if (n === "sw_me") state.cookie = v;
    },
    delete: (n: string) => {
      if (n === "sw_me") state.cookie = "";
    },
  }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { encodeSession, decodeSession, today } = await import("@/lib/session");
const { getMemberships, getLinkedAwayGroups, signInAs, signOutOtherPhones, setMyMemberId, keepGroupsDropAccount, bumpGrantEpochs } = await import("@/lib/identity");
const { deleteAccount } = await import("@/lib/auth");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let G = "";
const id: Record<string, string> = {};
const acc: Record<string, string> = {};
const cookie = async (m: Record<string, string>, extra: { a?: string; v?: number } = {}) => encodeSession({ m, ...extra, t: today() });
const as = async (raw: string) => {
  state.cookie = raw;
  return getMemberships();
};
const epochOf = async (m: string) => (await db.member.findUniqueOrThrow({ where: { id: m } })).grantEpoch;

beforeAll(async () => {
  const g = await db.group.create({
    data: { name: `Grants ${stamp}`, inviteCode: `gg-${stamp}`, currency: "INR", members: { create: ["X", "Y", "Z", "W"].map((name, i) => ({ name, createdAt: new Date(Date.now() - 1000 * (10 - i)) })) } },
    include: { members: true },
  });
  G = g.id;
  for (const m of g.members) id[m.name] = m.id;
  for (const k of ["A", "B", "C", "D"]) acc[k] = (await db.account.create({ data: { email: `grant-${k}-${stamp}@example.com` } })).id;
});
afterAll(async () => {
  state.cookie = "";
  await db.group.deleteMany({ where: { id: G } });
  await db.account.deleteMany({ where: { email: { contains: stamp } } });
});

describe("a guest name that is not linked to anyone", () => {
  it("works as a plain id (older cookies) and with its epoch", async () => {
    expect(await as(await cookie({ [G]: id.X }))).toEqual({ [G]: id.X });
    expect(await as(await cookie({ [G]: `${id.X}~0` }))).toEqual({ [G]: id.X });
  });
  it("is refused for another group's slot, for a wrong epoch, and for a name that doesn't exist", async () => {
    expect(await as(await cookie({ other: id.X }))).toEqual({});
    expect(await as(await cookie({ [G]: `${id.X}~5` }))).toEqual({});
    expect(await as(await cookie({ [G]: "no-such-member~0" }))).toEqual({});
  });
});

describe("linking, sign-out-others and deleting the account, in order (member X)", () => {
  let oldGuest = "";
  let signedIn = "";
  it("signing in links X, and the old guest copy stops working with a clear reason", async () => {
    oldGuest = await cookie({ [G]: id.X });
    state.cookie = oldGuest;
    await signInAs(acc.A);
    signedIn = state.cookie;
    const linked = await db.member.findUniqueOrThrow({ where: { id: id.X } });
    expect(linked.accountId).toBe(acc.A);
    expect(linked.grantEpoch).toBe(1);
    expect(await decodeSession(signedIn)).toMatchObject({ a: acc.A, m: {} });
    expect(await as(signedIn)).toEqual({ [G]: id.X });
    expect(await as(oldGuest)).toEqual({});
    expect(await getLinkedAwayGroups()).toEqual([G]);
    expect(await as(await cookie({ [G]: `${id.X}~0` }))).toEqual({});
  });
  it("sign out on all other phones: a replayed copy, with or without X in it, gets nothing", async () => {
    state.cookie = signedIn;
    await signOutOtherPhones();
    const fresh = state.cookie;
    expect((await decodeSession(fresh))?.v).toBe(1);
    expect(await as(signedIn)).toEqual({}); // v=0 replay
    expect(await as(await cookie({ [G]: id.X }, { a: acc.A, v: 0 }))).toEqual({}); // v=0 replay that also names X
    expect(await as(await cookie({ [G]: id.X }, { a: acc.A, v: 1 }))).toEqual({ [G]: id.X }); // this phone, still current
    expect(await as(fresh)).toEqual({ [G]: id.X });
    signedIn = fresh;
  });
  it("deleting the account: this phone keeps X, another phone's copy stays dead (needs the bump in deleteAccount)", async () => {
    state.cookie = signedIn;
    const groups = await getMemberships();
    expect(groups).toEqual({ [G]: id.X });
    const before = await epochOf(id.X); // 1
    await deleteAccount(acc.A);
    const after = await db.member.findUniqueOrThrow({ where: { id: id.X } });
    expect(after.accountId).toBeNull();
    expect(after.grantEpoch).toBe(before + 1); // 2
    await keepGroupsDropAccount(groups);
    const phone1 = state.cookie;
    expect((await decodeSession(phone1))?.m[G]).toBe(`${id.X}~2`);
    expect(await as(phone1)).toEqual({ [G]: id.X });
    expect(await as(oldGuest)).toEqual({});
    expect(await as(await cookie({ [G]: `${id.X}~1` }))).toEqual({}); // a copy from while X was linked
    state.cookie = phone1;
  });
  it("signing in again on phone 1 still works, and the cookie it had before is then dead", async () => {
    const phone1 = state.cookie;
    await signInAs(acc.B);
    const again = state.cookie;
    expect((await db.member.findUniqueOrThrow({ where: { id: id.X } })).grantEpoch).toBe(3);
    expect(await as(again)).toEqual({ [G]: id.X });
    expect(await as(phone1)).toEqual({});
  });
});

describe("the other order, and a name linked to a different account", () => {
  it("sign-out-others first, then the guest phone links: the new sign-in is current, the old ones are not", async () => {
    const v0 = await cookie({}, { a: acc.C, v: 0 });
    state.cookie = v0;
    await signOutOtherPhones(); // C's sign-in version is now 1
    const guestY = await cookie({ [G]: id.Y });
    state.cookie = guestY;
    await signInAs(acc.C);
    const now = state.cookie;
    expect((await decodeSession(now))?.v).toBe(1);
    expect(await as(now)).toEqual({ [G]: id.Y });
    expect(await as(v0)).toEqual({});
    expect(await as(guestY)).toEqual({});
  });
  it("a cookie signed in as one account can't use a name linked to another", async () => {
    // Y belongs to C; this phone is signed in as B, whose own name in the group is X.
    const got = await as(await cookie({ [G]: id.Y }, { a: acc.B, v: 0 }));
    expect(got).toEqual({ [G]: id.X });
    expect(await getLinkedAwayGroups()).toEqual([]); // B does have a name here, so nothing is "lost"
  });
  it("a stale guest copy can't be carried into a new sign-in", async () => {
    // Z is a guest name at epoch 0; a copy that says epoch 7 must not link Z to account D.
    state.cookie = await cookie({ [G]: `${id.Z}~7` });
    await signInAs(acc.D);
    const z = await db.member.findUniqueOrThrow({ where: { id: id.Z } });
    expect(z.accountId).toBeNull();
    expect(z.grantEpoch).toBe(0);
  });
  it("setMyMemberId: signed in, it links and raises the epoch; as a guest, it writes the current epoch", async () => {
    state.cookie = await cookie({}, { a: acc.D, v: 0 });
    await setMyMemberId(G, id.W);
    const w = await db.member.findUniqueOrThrow({ where: { id: id.W } });
    expect(w.accountId).toBe(acc.D);
    expect(w.grantEpoch).toBe(1);
    expect(await as(await cookie({ [G]: id.W }))).toEqual({}); // the old guest copy

    state.cookie = "";
    await setMyMemberId(G, id.Z);
    expect((await decodeSession(state.cookie))?.m[G]).toBe(`${id.Z}~0`);
    expect(await getMemberships()).toEqual({ [G]: id.Z });
  });
  it("bumpGrantEpochs raises each named member by one", async () => {
    const before = [await epochOf(id.Y), await epochOf(id.Z)];
    await db.$transaction(async (tx) => {
      await bumpGrantEpochs(tx, [id.Y, id.Z]);
    });
    expect([await epochOf(id.Y), await epochOf(id.Z)]).toEqual([before[0] + 1, before[1] + 1]);
    await db.$transaction(async (tx) => {
      await bumpGrantEpochs(tx, []);
    });
  });
});

describe("undoing a removal does not bring old phone-only copies back", () => {
  // Hand-worked: V is removed while at epoch 2 (the payload keeps 2). The undo recreates V one step ahead: 2 + 1 = 3.
  // So the copy a phone saved before ("V~2", or the plain id = epoch 0) is refused, and only "V~3" works.
  it("remove V (epoch 2), undo: V comes back at epoch 3 and 'V~2' no longer grants access", async () => {
    const { removeMembers, undoEvent } = await import("@/lib/undo");
    const v = await db.member.create({ data: { name: "V", groupId: G, grantEpoch: 2 } });
    expect(await as(await cookie({ [G]: `${v.id}~2` }))).toEqual({ [G]: v.id }); // before: the copy works

    const removed = await removeMembers(G, id.Y, [v.id], false);
    if (!removed.ok) throw new Error(removed.error);
    expect(await db.member.count({ where: { id: v.id } })).toBe(0);

    const undone = await undoEvent(removed.eventId!, id.Y);
    if (!undone.ok) throw new Error(undone.error);
    expect(await epochOf(v.id)).toBe(3);
    expect(await as(await cookie({ [G]: `${v.id}~2` }))).toEqual({});
    expect(await as(await cookie({ [G]: v.id }))).toEqual({});
    expect(await as(await cookie({ [G]: `${v.id}~3` }))).toEqual({ [G]: v.id });
  });

  it("an older payload with no epoch counts as 0, so the member comes back at epoch 1", async () => {
    const { undoEvent } = await import("@/lib/undo");
    const ghostId = `old-${stamp}`;
    const ev = await db.groupEvent.create({
      data: {
        groupId: G, actorId: id.Y, kind: "members_removed", text: "removed Old (old payload)",
        undo: JSON.stringify({ type: "members_restore", members: [{ id: ghostId, name: "Old", phone: "", createdAt: new Date().toISOString() }] }),
      },
    });
    const undone = await undoEvent(ev.id, id.Y);
    if (!undone.ok) throw new Error(undone.error);
    expect(await epochOf(ghostId)).toBe(1);
  });
});
