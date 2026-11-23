import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";

// Batch 8 (access): the phone's guest cookie never silently overflows (G06/L27), a join finishes in the group it joined and a lost reply
// can be sent again (L34), a join racing a removal can't slip in (G05), and one account never holds two names in one group (L31).
// Throwaway database only. Ids and keys below are made up.

const state = vi.hoisted(() => ({ cookie: "", ip: "10.88.0.1" }));
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
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": state.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  RedirectType: { replace: "replace", push: "push" },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const A = await import("@/app/actions");
const join = await import("@/lib/join");
const { GUEST_COOKIE_CAP, getMemberships, guestCookieFits, guestCookieRoom, moveGuestsToAccount, parseConfirmed, setMyMemberId, GuestCookieFull } = await import("@/lib/identity");
const { decodeSession, encodeSession, today } = await import("@/lib/session");
const { eraseGroups } = await import("@/lib/purge");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
process.env.MAIL_OUTBOX = "1";
const groupIds: string[] = [];
const accountIds: string[] = [];
const keys: string[] = [];
let n = 0;
afterAll(async () => {
  state.cookie = "";
  await db.rateLimit.deleteMany({ where: { OR: [{ key: { contains: state.ip } }, { key: { contains: stamp } }] } });
  await db.requestKey.deleteMany({ where: { key: { in: keys } } });
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

const cid = () => `c${randomBytes(12).toString("hex")}`; // 25 characters, like the real member and group ids
async function account(name: string) {
  const a = await db.account.create({ data: { email: `${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return { id: a.id, email: a.email, name };
}
const key = (tag: string) => {
  const k = `rid-${tag}-${stamp}-${++n}`.padEnd(20, "x");
  keys.push(k);
  return k;
};
// Varun looks after the group (an account). Ravi is a plain name nobody has joined as.
async function party(opts: { ravi?: boolean } = {}) {
  const varun = await account("Varun");
  const g = await db.group.create({
    data: {
      name: `B8 ${++n} ${stamp}`, inviteCode: `b8-${n}-${stamp}`,
      members: { create: [{ name: "Varun", accountId: varun.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, ...(opts.ravi === false ? [] : [{ name: "Ravi", createdAt: new Date(2026, 0, 2) }])] },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  return { g, code: g.inviteCode, varun, V: g.members[0].id, R: g.members.find((m) => m.name === "Ravi")?.id ?? "" };
}
const people = (groupId: string) => db.member.count({ where: { groupId } });
const rotate = (groupId: string) => async () => void (await db.group.update({ where: { id: groupId }, data: { inviteCode: `rotated-${cid()}` } })); // a removal or "new link" landing in the gap

// `count` groups, each with one member (25-character ids): an account's own rows (accountId given) or guest names (null).
async function manyGroups(count: number, accountId: string | null, tag: string) {
  const gs = Array.from({ length: count }, (_, i) => ({ id: cid(), name: `B8 ${tag} ${i} ${stamp}`, inviteCode: `b8-${tag}-${i}-${stamp}` }));
  await db.group.createMany({ data: gs });
  groupIds.push(...gs.map((g) => g.id));
  const ms = gs.map((g) => ({ id: cid(), name: "Me", groupId: g.id, accountId, claimedAt: new Date(2026, 0, 1) }));
  await db.member.createMany({ data: ms });
  return gs.map((g, i) => ({ groupId: g.id, memberId: ms[i].id }));
}
const asAccount = async (accountId: string, m: Record<string, string> = {}) => {
  state.cookie = await encodeSession({ m, a: accountId, v: 0, t: today() });
};
async function go(fn: (fd: FormData) => Promise<void>, fields: Record<string, string>): Promise<string> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  try {
    await fn(fd);
  } catch (e) {
    const m = String((e as Error).message);
    if (m.startsWith("NEXT_REDIRECT ")) return m.slice("NEXT_REDIRECT ".length);
    throw e;
  }
  return "";
}

// ---------------------------------------------------------------------------------------------------------------
describe("G06 / L27: the guest cookie never silently overflows", () => {
  // Hand-worked: one entry is "<25-char group id>":"<25-char member id>~1", comma included = 27 + 1 + 29 + 1 = 58 characters of JSON.
  // The rest of the value ({"m":{ ... },"t":20xxx}) is about 30. Base64 makes it 4/3 as long, and the signature adds 44 (43 + the dot).
  // So N entries are (58N + 30) * 4/3 + 44 <= 3,800 bytes -> N <= 48. That is why 40 fits and 60 does not (the spec's numbers still hold).
  const fakeMap = (count: number) => Object.fromEntries(Array.from({ length: count }, () => [cid(), `${cid()}~1`]));

  it("guestCookieFits: 40 names fit, 60 do not; the room it reports is the same 48 (hand-worked), and the cap is 3,800", async () => {
    expect(GUEST_COOKIE_CAP).toBe(3800);
    expect(await guestCookieFits({})).toBe(true);
    expect(await guestCookieFits(fakeMap(40))).toBe(true);
    expect((await encodeSession({ m: fakeMap(40), t: today() })).length).toBeLessThan(3800);
    expect(await guestCookieFits(fakeMap(60))).toBe(false);
    const room = await guestCookieRoom(fakeMap(60));
    expect(room).toBeGreaterThanOrEqual(46);
    expect(room).toBeLessThanOrEqual(50);
    // It really is the edge: that many fit, one more does not.
    const m = fakeMap(60);
    expect(await guestCookieFits(Object.fromEntries(Object.entries(m).slice(0, room)))).toBe(true);
    expect(await guestCookieFits(Object.fromEntries(Object.entries(m).slice(0, room + 1)))).toBe(false);
  });

  it("deleting an account that is in 60 groups is refused before anything is deleted, with the number this phone can keep", async () => {
    const me = await account("Maya");
    await manyGroups(60, me.id, "del60");
    await asAccount(me.id);
    expect(Object.keys(await getMemberships())).toHaveLength(60);
    const url = await go(A.deleteMyAccount, {});
    expect(url.startsWith("/account/data?")).toBe(true);
    const said = new URL(`http://x${url}`).searchParams.get("error") ?? "";
    const room = Number(/can keep (\d+) groups/.exec(said)?.[1]);
    expect(room).toBeGreaterThanOrEqual(46);
    expect(room).toBeLessThan(60);
    expect(said).toBe(`This phone can keep ${room} groups without a sign-in, and you’re in 60. Leave groups you’ve finished with, or keep your account.`);
    // Nothing was deleted: the account is still there and still holds all 60 names.
    expect(await db.account.count({ where: { id: me.id } })).toBe(1);
    expect(await db.member.count({ where: { accountId: me.id } })).toBe(60);
  });

  it("deleting an account in 40 groups works: the cookie is under 3,800 bytes and all 40 groups still resolve as guest names", async () => {
    const me = await account("Mira");
    const mine = await manyGroups(40, me.id, "del40");
    await asAccount(me.id);
    expect(await go(A.deleteMyAccount, {})).toBe("/?deleted=account");
    expect(await db.account.count({ where: { id: me.id } })).toBe(0);
    expect(state.cookie.length).toBeLessThan(3800);
    const s = await decodeSession(state.cookie);
    expect(Object.keys(s?.m ?? {})).toHaveLength(40);
    expect(s?.a).toBeUndefined();
    const held = await getMemberships();
    expect(Object.keys(held)).toHaveLength(40);
    for (const x of mine) expect(held[x.groupId]).toBe(x.memberId);
  });

  it("a guest join with a full cookie creates no member, as a new name or as 'That's me'", async () => {
    const f = await party();
    const held = await manyGroups(55, null, "cap55"); // 55 > 48: this phone is full
    state.cookie = await encodeSession({ m: Object.fromEntries(held.map((h) => [h.groupId, `${h.memberId}~0`])), t: today() });
    const before = await people(f.g.id);
    expect(await go(A.joinAsNew, { code: f.code, name: "Ben" })).toBe(`/join/${f.code}?step=name&error=phone`);
    expect(await go(A.joinAsExisting, { code: f.code, memberId: f.R })).toBe(`/join/${f.code}?step=name&error=phone`);
    expect(await people(f.g.id)).toBe(before);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.R } })).claimedAt).toBeNull();
    // The join page says it calmly (the one new line of wording).
    const page = readFileSync("src/app/join/[code]/page.tsx", "utf8");
    expect(page).toContain("This phone is holding a lot of groups without a sign-in. Sign in to join more. Your groups stay safe in your account.");
  });

  it("a guest join with room still works and the new group is in the cookie", async () => {
    const f = await party();
    const held = await manyGroups(3, null, "room3");
    state.cookie = await encodeSession({ m: Object.fromEntries(held.map((h) => [h.groupId, `${h.memberId}~0`])), t: today() });
    expect(await go(A.joinAsNew, { code: f.code, name: "Ben" })).toBe(`/groups/${f.g.id}`);
    expect(Object.keys((await decodeSession(state.cookie))?.m ?? {})).toHaveLength(4);
  });

  it("setMyMemberId itself refuses to write a cookie that would not fit, and leaves the old cookie as it was", async () => {
    const f = await party();
    const ben = (await join.joinNewAsGuest(f.code, "Ben")) as { memberId: string };
    const held = await manyGroups(55, null, "set55");
    state.cookie = await encodeSession({ m: Object.fromEntries(held.map((h) => [h.groupId, `${h.memberId}~0`])), t: today() });
    const before = state.cookie;
    await expect(setMyMemberId(f.g.id, ben.memberId)).rejects.toBeInstanceOf(GuestCookieFull);
    expect(state.cookie).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("L34: a join finishes with the group it joined, and a lost reply can be retried", () => {
  it("every answer carries the group id; the actions finish with it and no longer look the group up by the link again", () => {
    const src = readFileSync("src/app/actions.ts", "utf8");
    const body = (name: string) => src.slice(src.indexOf(`export async function ${name}`), src.indexOf("\n}\n", src.indexOf(`export async function ${name}`)));
    for (const name of ["joinAsNew", "joinAsExisting"]) {
      expect(body(name)).toContain("finishJoin(code, r.groupId");
      expect(body(name)).toContain("cleanKey(formData.get(\"rid\"))");
    }
    expect(body("joinAsNew").split("inviteCode: code").length - 1).toBe(1); // only the lookup BEFORE joining (for the phone's held name)
    const page = readFileSync("src/app/join/[code]/page.tsx", "utf8");
    expect(page.split("<form action={join").length - 1).toBe(page.split('<FreshKeyInput name="rid" />').length - 1); // every join form carries a key
  });

  it("the same key again (a lost reply) gives the same person back, even after the link was changed: no 'Ravi 2', members +1 only", async () => {
    const f = await party({ ravi: false });
    const rid = key("guest");
    const before = await people(f.g.id); // Varun
    const first = await join.joinNewAsGuest(f.code, "Ravi", undefined, { rid });
    expect(first).toMatchObject({ ok: true, groupId: f.g.id });
    expect(await people(f.g.id)).toBe(before + 1);
    // The reply never reached the phone: it sends the same form again (the phone holds no name yet), after the admin made a new link.
    const newCode = `b8-new-${cid()}`;
    await db.group.update({ where: { id: f.g.id }, data: { inviteCode: newCode } });
    const again = await join.joinNewAsGuest(f.code, "Ravi", undefined, { rid });
    expect(again).toEqual(first);
    expect(await people(f.g.id)).toBe(before + 1);
    expect(await db.member.count({ where: { groupId: f.g.id, name: "Ravi 2" } })).toBe(0);
  });

  it("the same for a signed-in join, and a key used for a different name or no key at all does not stop a join", async () => {
    const f = await party({ ravi: false });
    const bea = await account("Bea");
    const rid = key("acct");
    const first = await join.joinNew(f.code, bea, "Bea", { rid });
    expect(first).toMatchObject({ ok: true, groupId: f.g.id });
    expect(await join.joinNew(f.code, bea, "Bea", { rid })).toEqual(first);
    expect(await db.member.count({ where: { groupId: f.g.id, accountId: bea.id } })).toBe(1);
    // The key belongs to "Bea" in this group for this account. A guest using it for something else is just joined normally (no protection).
    const other = await join.joinNewAsGuest(f.code, "Cal", undefined, { rid });
    expect(other).toMatchObject({ ok: true });
    expect((other as { memberId: string }).memberId).not.toBe((first as { memberId: string }).memberId);
    // An older page sends no key: joining works exactly as before (a second "Cal" becomes "Cal 2").
    const old = await join.joinNewAsGuest(f.code, "Cal");
    expect(old).toMatchObject({ ok: true });
    expect((await db.member.findUniqueOrThrow({ where: { id: (old as { memberId: string }).memberId } })).name).toBe("Cal 2");
  });

  it("'That's me' with the same key twice claims the name once and answers the same both times", async () => {
    const f = await party();
    const rid = key("that");
    const first = await join.joinExistingAsGuest(f.code, f.R, undefined, { rid });
    expect(first).toMatchObject({ ok: true, memberId: f.R, groupId: f.g.id });
    expect(await join.joinExistingAsGuest(f.code, f.R, undefined, { rid })).toEqual(first); // without the key this would be "claimed"
    expect(await join.joinExistingAsGuest(f.code, f.R, undefined)).toMatchObject({ ok: false, reason: "claimed" });
    const g2 = await party();
    const bea = await account("Bea");
    const rid2 = key("that-acct");
    const a = await join.joinExisting(g2.code, bea, g2.R, { rid: rid2 });
    expect(a).toMatchObject({ ok: true, memberId: g2.R, groupId: g2.g.id });
    expect(await join.joinExisting(g2.code, bea, g2.R, { rid: rid2 })).toEqual(a);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("G05: a join racing a removal or a new link can't slip in (all four paths)", () => {
  it("joinNew: the link changes between the read and the write -> gone, no member", async () => {
    const f = await party();
    const bea = await account("Bea");
    const before = await people(f.g.id);
    expect(await join.joinNew(f.code, bea, "Bea", { afterRead: rotate(f.g.id) })).toEqual({ ok: false, reason: "gone" });
    expect(await people(f.g.id)).toBe(before);
  });
  it("joinNewAsGuest", async () => {
    const f = await party();
    const rid = key("g05-newguest");
    const before = await people(f.g.id);
    expect(await join.joinNewAsGuest(f.code, "Ben", undefined, { afterRead: rotate(f.g.id), rid })).toEqual({ ok: false, reason: "gone" });
    expect(await people(f.g.id)).toBe(before);
    expect(await db.requestKey.count({ where: { key: rid } })).toBe(0); // the key is not used up by a join that did not happen
  });
  it("joinExisting: the name stays unclaimed", async () => {
    const f = await party();
    const bea = await account("Bea");
    const before = await people(f.g.id);
    expect(await join.joinExisting(f.code, bea, f.R, { afterRead: rotate(f.g.id) })).toEqual({ ok: false, reason: "gone" });
    expect(await people(f.g.id)).toBe(before);
    expect(await db.member.findUniqueOrThrow({ where: { id: f.R } })).toMatchObject({ accountId: null, claimedAt: null, grantEpoch: 0 });
  });
  it("joinExistingAsGuest: the name stays unclaimed", async () => {
    const f = await party();
    const before = await people(f.g.id);
    expect(await join.joinExistingAsGuest(f.code, f.R, undefined, { afterRead: rotate(f.g.id) })).toEqual({ ok: false, reason: "gone" });
    expect(await people(f.g.id)).toBe(before);
    expect(await db.member.findUniqueOrThrow({ where: { id: f.R } })).toMatchObject({ accountId: null, claimedAt: null, grantEpoch: 0 });
  });
  it("a group deleted in the gap is gone too", async () => {
    const f = await party();
    const before = await people(f.g.id);
    expect(await join.joinNewAsGuest(f.code, "Ben", undefined, { afterRead: async () => void (await db.group.update({ where: { id: f.g.id }, data: { deletedAt: new Date() } })) })).toEqual({ ok: false, reason: "gone" });
    expect(await people(f.g.id)).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("L31: one account never holds two names in one group", () => {
  const guestNames = async () => {
    const f = await party({ ravi: false });
    const X = await db.member.create({ data: { name: "Xavi", groupId: f.g.id, claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3) } });
    const Y = await db.member.create({ data: { name: "Yash", groupId: f.g.id, claimedAt: new Date(2026, 0, 4), createdAt: new Date(2026, 0, 4) } });
    return { ...f, X: X.id, Y: Y.id };
  };

  it("two phones, two guest names of one group, one account, interleaved: exactly one is linked, the other is skipped and stays a guest", async () => {
    const f = await guestNames();
    const me = await account("Zed");
    // Phone A holds Xavi and moves it into the account. While it is checking, phone B links Yash to the same account.
    await asAccount(me.id, { [f.g.id]: `${f.X}~0` });
    const skipped: string[] = [];
    const moved = await moveGuestsToAccount(parseConfirmed([f.X]), {
      skipped,
      afterRead: async () => void (await db.member.update({ where: { id: f.Y }, data: { accountId: me.id, grantEpoch: { increment: 1 } } })),
    });
    expect(moved).toBe(0);
    expect(skipped).toEqual([f.X]);
    expect(await db.member.findUniqueOrThrow({ where: { id: f.X } })).toMatchObject({ accountId: null, grantEpoch: 0 }); // still a guest, epoch untouched
    expect(await db.member.count({ where: { groupId: f.g.id, accountId: me.id } })).toBe(1);
  });

  it("setMyMemberId: the second name of the same group is not linked (it stays a guest name on this phone)", async () => {
    const f = await guestNames();
    const me = await account("Zoe");
    await asAccount(me.id);
    await setMyMemberId(f.g.id, f.X);
    expect(await db.member.findUniqueOrThrow({ where: { id: f.X } })).toMatchObject({ accountId: me.id });
    await setMyMemberId(f.g.id, f.Y);
    expect(await db.member.findUniqueOrThrow({ where: { id: f.Y } })).toMatchObject({ accountId: null, grantEpoch: 0 });
    expect(await db.member.count({ where: { groupId: f.g.id, accountId: me.id } })).toBe(1);
  });

  it("joinNew: a second row for the account landing in the gap undoes the join (retry); members +1 only", async () => {
    const f = await party({ ravi: false });
    const bea = await account("Bea");
    const before = await people(f.g.id);
    const r = await join.joinNew(f.code, bea, "Bea", { afterRead: async () => void (await db.member.create({ data: { name: "Bea (other phone)", groupId: f.g.id, accountId: bea.id, claimedAt: new Date() } })) });
    expect(r).toEqual({ ok: false, reason: "retry" });
    expect(await people(f.g.id)).toBe(before + 1); // only the other phone's row
    expect(await db.member.count({ where: { groupId: f.g.id, accountId: bea.id } })).toBe(1);
  });

  it("joinExisting: same, and the name stays unclaimed", async () => {
    const f = await party();
    const bea = await account("Bea");
    const r = await join.joinExisting(f.code, bea, f.R, { afterRead: async () => void (await db.member.create({ data: { name: "Bea (other phone)", groupId: f.g.id, accountId: bea.id, claimedAt: new Date() } })) });
    expect(r).toEqual({ ok: false, reason: "retry" });
    expect(await db.member.findUniqueOrThrow({ where: { id: f.R } })).toMatchObject({ accountId: null, claimedAt: null });
    expect(await db.member.count({ where: { groupId: f.g.id, accountId: bea.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("G06 follow-up: every other path that calls setMyMemberId is account-only, so a full guest cookie never turns into a 500", () => {
  it("a guest at the cap can't create a group: they are sent to sign in and no group is made", async () => {
    const held = await manyGroups(55, null, "cg-guest");
    state.cookie = await encodeSession({ m: Object.fromEntries(held.map((h) => [h.groupId, `${h.memberId}~0`])), t: today() });
    const name = `B8 made ${stamp} guest`;
    const url = await go(A.createGroup, { groupName: name, yourName: "Gus" });
    expect(url.startsWith("/signin?")).toBe(true);
    expect(await db.group.count({ where: { name } })).toBe(0);
  });

  it("a signed-in person whose phone still holds 55 old guest names can create a group: it goes into the account, the cookie does not grow", async () => {
    const me = await account("Cleo");
    const held = await manyGroups(55, null, "cg-acct");
    const m = Object.fromEntries(held.map((h) => [h.groupId, `${h.memberId}~0`]));
    await asAccount(me.id, m);
    const name = `B8 made ${stamp} acct`;
    const url = await go(A.createGroup, { groupName: name, yourName: "Cleo" });
    const made = await db.group.findFirstOrThrow({ where: { name }, select: { id: true } });
    groupIds.push(made.id);
    expect(url).toBe(`/groups/${made.id}/invite?new=1`);
    const s = await decodeSession(state.cookie);
    expect(s?.a).toBe(me.id);
    expect(Object.keys(s?.m ?? {})).toHaveLength(55); // the same 55, the new group is not added to the cookie
    expect(s?.m[made.id]).toBeUndefined();
    expect(await db.member.count({ where: { groupId: made.id, accountId: me.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("review fixes: an old join key is not a way back in (H1), a lost reply still works after a link change (M3), a replay uses no limits (L5)", () => {
  const ipKey = () => `join-guest-ip:${state.ip}`;
  const ipCount = async () => (await db.rateLimit.findUnique({ where: { key: ipKey() } }))?.count ?? 0;
  const newLink = (groupId: string) => db.group.update({ where: { id: groupId }, data: { inviteCode: `b8-newlink-${cid()}` } });

  it("Ben claims Ravi with key R; the admin frees the name and makes a new link: replaying R from another phone gets nothing and changes nothing", async () => {
    const f = await party();
    const rid = key("h1-free");
    state.cookie = "";
    expect(await go(A.joinAsExisting, { code: f.code, memberId: f.R, rid })).toBe(`/groups/${f.g.id}`);
    expect(await join.releaseGuestName(f.g.id, f.V, f.R)).toMatchObject({ ok: true });
    await newLink(f.g.id);
    state.cookie = ""; // not Ben's phone
    expect(await go(A.joinAsExisting, { code: f.code, memberId: f.R, rid })).toBe(`/join/${f.code}`); // the old link is gone: refused
    expect(state.cookie).toBe("");
    expect(await db.member.findUniqueOrThrow({ where: { id: f.R } })).toMatchObject({ accountId: null, claimedAt: null });
    // And in the library: the key does not match the name any more (its epoch went up), so it is refused as gone too.
    expect(await join.joinExistingAsGuest(f.code, f.R, undefined, { rid })).toEqual({ ok: false, reason: "gone" });
  });

  it("Ben claims Ravi with key R, the name is freed and Cat claims it: replaying R is refused (claimed), Cat keeps it", async () => {
    const f = await party();
    const rid = key("h1-cat");
    const ben = await join.joinExistingAsGuest(f.code, f.R, undefined, { rid });
    expect(ben).toMatchObject({ ok: true, memberId: f.R });
    expect(await join.releaseGuestName(f.g.id, f.V, f.R)).toMatchObject({ ok: true });
    const cat = await join.joinExistingAsGuest(f.code, f.R);
    expect(cat).toMatchObject({ ok: true, memberId: f.R });
    const epochNow = (await db.member.findUniqueOrThrow({ where: { id: f.R } })).grantEpoch;
    expect(await join.joinExistingAsGuest(f.code, f.R, undefined, { rid })).toEqual({ ok: false, reason: "claimed" });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.R } })).grantEpoch).toBe(epochNow); // nothing was written
  });

  it("a key older than 2 minutes is refused, even for the same join", async () => {
    const f = await party();
    const rid = key("h1-stale");
    expect(await join.joinExistingAsGuest(f.code, f.R, undefined, { rid })).toMatchObject({ ok: true });
    await db.requestKey.update({ where: { key: rid }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    await newLink(f.g.id);
    expect(await join.joinExistingAsGuest(f.code, f.R, undefined, { rid })).toEqual({ ok: false, reason: "gone" });
    // Within the window the same replay still works (the normal lost reply), even after a new link:
    const g2 = await party();
    const rid2 = key("h1-fresh");
    const first = await join.joinExistingAsGuest(g2.code, g2.R, undefined, { rid: rid2 });
    await newLink(g2.g.id);
    expect(await join.joinExistingAsGuest(g2.code, g2.R, undefined, { rid: rid2 })).toEqual(first);
  });

  it("a typed name that looks like a picked row can't borrow its key (the prints start with new: and that:)", async () => {
    const f = await party();
    const rid = key("h1-print");
    expect(await join.joinExistingAsGuest(f.code, f.R, undefined, { rid })).toMatchObject({ ok: true });
    const r = await join.joinNewAsGuest(f.code, `that:${f.R}`, undefined, { rid });
    expect((r as { memberId?: string }).memberId).not.toBe(f.R); // never the picked row (a new person under the normal rules, or a plain refusal of the odd name)
  });

  it("M3 + L5: claim saved, reply lost, the link changed, retry lands in the group; the retry uses no network limit and no link count", async () => {
    const f = await party();
    const rid = key("m3");
    state.cookie = "";
    expect(await go(A.joinAsExisting, { code: f.code, memberId: f.R, rid })).toBe(`/groups/${f.g.id}`);
    const used = await ipCount();
    const linkKey = `join-guest-link:${f.code.slice(0, 60)}`;
    const linkBefore = (await db.rateLimit.findUnique({ where: { key: linkKey } }))?.count ?? 0;
    const before = await people(f.g.id);
    state.cookie = ""; // the reply never arrived
    await newLink(f.g.id); // somebody else was removed / a new link was made meanwhile
    expect(await go(A.joinAsExisting, { code: f.code, memberId: f.R, rid })).toBe(`/groups/${f.g.id}`);
    expect(Object.keys((await decodeSession(state.cookie))?.m ?? {})).toEqual([f.g.id]);
    expect(await people(f.g.id)).toBe(before);
    expect(await ipCount()).toBe(used);
    expect((await db.rateLimit.findUnique({ where: { key: linkKey } }))?.count ?? 0).toBe(linkBefore);
  });

  it("the same for a new name: members +1 only, no 'Ben 2'", async () => {
    const f = await party({ ravi: false });
    const rid = key("m3-new");
    const before = await people(f.g.id);
    state.cookie = "";
    expect(await go(A.joinAsNew, { code: f.code, name: "Ben", rid })).toBe(`/groups/${f.g.id}`);
    state.cookie = "";
    await newLink(f.g.id);
    expect(await go(A.joinAsNew, { code: f.code, name: "Ben", rid })).toBe(`/groups/${f.g.id}`);
    expect(await people(f.g.id)).toBe(before + 1);
    expect(await db.member.count({ where: { groupId: f.g.id, name: "Ben 2" } })).toBe(0);
  });

  it("L4: two taps with one key at the same moment give the same person, never 'claimed'", async () => {
    const f = await party();
    const rid = key("l4");
    const [a, b] = await Promise.all([join.joinExistingAsGuest(f.code, f.R, undefined, { rid }), join.joinExistingAsGuest(f.code, f.R, undefined, { rid })]);
    expect(a).toMatchObject({ ok: true, memberId: f.R });
    expect(b).toMatchObject({ ok: true, memberId: f.R });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("H2: deleting an account counts only the groups the person is really in, and keeps left groups as far as the cookie allows", () => {
  it("30 live + 20 left + 10 removed or deleted: delete is allowed; the cookie has all 30 live, the 18 most recently left that fit, none of the removed or deleted", async () => {
    // Hand-worked: each entry is 58 characters of JSON (25-char group id, 25-char member id, "~1"); the rest of the value is 17.
    // N entries: (58N + 17) * 4/3 (base64, no padding) + 44 (signature and dot) <= 3,800  ->  N <= 48. So 30 live + 18 left = 48 fit, 49 would not.
    const me = await account("Nia");
    const rows = await manyGroups(60, me.id, "h2");
    const live = rows.slice(0, 30);
    const left = rows.slice(30, 50); // left on day 1 + i: i = 19 is the most recent
    const removed = rows.slice(50, 55);
    const deleted = rows.slice(55, 60);
    for (const [i, r] of left.entries()) await db.member.update({ where: { id: r.memberId }, data: { leftAt: new Date(2026, 0, 1 + i) } });
    await db.member.updateMany({ where: { id: { in: removed.map((r) => r.memberId) } }, data: { removedAt: new Date() } });
    await db.group.updateMany({ where: { id: { in: deleted.map((r) => r.groupId) } }, data: { deletedAt: new Date() } });
    await asAccount(me.id);
    expect(await go(A.deleteMyAccount, {})).toBe("/?deleted=account");
    expect(await db.account.count({ where: { id: me.id } })).toBe(0);
    const s = await decodeSession(state.cookie);
    const kept = Object.keys(s?.m ?? {});
    for (const r of live) expect(kept).toContain(r.groupId);
    const keptLeft = left.filter((r) => kept.includes(r.groupId));
    expect(keptLeft).toHaveLength(18);
    expect(keptLeft.map((r) => r.groupId)).toEqual(left.slice(2).map((r) => r.groupId)); // the two left longest ago are the ones not kept
    for (const r of [...removed, ...deleted]) expect(kept).not.toContain(r.groupId);
    expect(kept).toHaveLength(48);
    expect(state.cookie.length).toBeLessThanOrEqual(3800);
  });

  it("a person whose live groups alone fit can always delete, however many left groups they have", async () => {
    const me = await account("Omar");
    const rows = await manyGroups(70, me.id, "h2b");
    await db.member.updateMany({ where: { id: { in: rows.slice(10).map((r) => r.memberId) } }, data: { leftAt: new Date() } }); // 10 live, 60 left
    await asAccount(me.id);
    expect(await go(A.deleteMyAccount, {})).toBe("/?deleted=account");
    expect(await db.account.count({ where: { id: me.id } })).toBe(0);
    const kept = Object.keys((await decodeSession(state.cookie))?.m ?? {});
    for (const r of rows.slice(0, 10)) expect(kept).toContain(r.groupId);
    expect(kept.length).toBeGreaterThanOrEqual(46);
    expect(kept.length).toBeLessThanOrEqual(50);
  });
});
