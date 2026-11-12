import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// M4: a phone that loses a name (its grant epoch goes up) also stops getting that name's phone notifications.
// L2: the move pass reads cookie grants ("id~epoch") properly.
// L6: every group page sends a stranger to the same place, through one helper.
// web-push is replaced by a stand-in that records who was sent to; nothing leaves this machine.
const state = vi.hoisted(() => ({ cookie: "", set: {} as Record<string, string> }));
const push = vi.hoisted(() => ({ send: vi.fn(async (_s: { endpoint: string }, _p?: unknown, _o?: unknown) => ({})) }));
vi.mock("web-push", () => ({ default: { sendNotification: push.send, generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }) } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: (n: string, v: string) => { state.set[n] = v; if (n === "sw_me") state.cookie = v; }, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/fresh-redirect", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { grantValue, signInAs, setMyMemberId, bumpGrantEpochs, privatePath } = await import("@/lib/identity");
const { sendEventPush } = await import("@/lib/push");
const { createMovePass, peekMovePass } = await import("@/lib/move");
const { acceptInvitation } = await import("@/lib/invitations");
const { joinExisting } = await import("@/lib/join");
const { copyPushTo } = await import("@/lib/invites");
const { savePushFor } = await import("@/lib/push-subs");
const { getMemberships } = await import("@/lib/identity");
const { PUSH_RESYNC_COOKIE, pushSyncPlan, hasResyncCookie, clearResyncCookieString } = await import("@/lib/push-resync");
const { signOutThisPhone } = await import("@/app/actions");
const { GOOD_AUTH, GOOD_P256DH, goodEndpoint } = await import("./helpers/push-keys");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
const hadKeys = Boolean(await db.appSetting.findUnique({ where: { key: "vapid" } }));

const sentTo = () => new Set(push.send.mock.calls.map((c) => c[0].endpoint));
const sub = (memberId: string, endpoint: string) => db.pushSubscription.create({ data: { memberId, endpoint, p256dh: GOOD_P256DH, auth: GOOD_AUTH } });
const rowsFor = async (memberId: string) => (await db.pushSubscription.findMany({ where: { memberId }, select: { endpoint: true } })).map((r) => r.endpoint).sort();
async function account(label: string) {
  const a = await db.account.create({ data: { email: `pg-${label.toLowerCase()}-${stamp}@example.test`, name: label } });
  accountIds.push(a.id);
  return a;
}
// A group with X (a guest name nobody has linked), Y (who makes the change) and Z (a bystander).
async function group(label: string) {
  const g = await db.group.create({
    data: { name: `PG ${label} ${stamp}`, inviteCode: `pg-${label}-${stamp}`, members: { create: [{ name: "X" }, { name: "Y" }, { name: "Z" }] } },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  const by = (n: string) => g.members.find((m) => m.name === n)!;
  return { g, x: by("X"), y: by("Y"), z: by("Z") };
}
const change = (groupId: string, actorId: string) => db.groupEvent.create({ data: { groupId, actorId, kind: "expense_added", text: "added Lunch (₹300)" } });
const phone1 = (memberships: Record<string, string>, accountId?: string) =>
  encodeSession({ m: memberships, ...(accountId ? { a: accountId, v: 0 } : {}), t: today() });

beforeEach(() => {
  state.cookie = "";
  state.set = {};
  push.send.mockClear();
});
afterAll(async () => {
  if (!hadKeys) await db.appSetting.deleteMany({ where: { key: "vapid" } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("M4: a phone that loses a name stops getting its notifications", () => {
  // What production does: nobody passes the phone's own address. Every row for the linked name goes, a short-lived note
  // is left for the app, and the phone that just signed in puts its own back; the other phone is not in the session.
  it("phone 2 holds a guest copy of X and is subscribed; phone 1 signs in and links X: X's rows go, the resync note is set, phone 1 re-registers, phone 2 stays cut off", async () => {
    const t = await group("si");
    const ep1 = goodEndpoint(`p1-${stamp}-si`);
    const ep2 = goodEndpoint(`p2-${stamp}-si`);
    await sub(t.x.id, ep1);
    await sub(t.x.id, ep2);
    // Control: before anyone signs in, a change by Y reaches both of X's phones.
    await sendEventPush((await change(t.g.id, t.y.id)).id);
    expect(sentTo()).toEqual(new Set([ep1, ep2]));
    push.send.mockClear();

    const me = await account("Xavier");
    state.cookie = await phone1({ [t.g.id]: grantValue(t.x.id, 0) });
    await signInAs(me.id);

    expect((await db.member.findUniqueOrThrow({ where: { id: t.x.id } })).accountId).toBe(me.id);
    expect(await rowsFor(t.x.id)).toEqual([]); // both phones' rows are gone
    expect(state.set[PUSH_RESYNC_COOKIE]).toBe("1"); // the note for this phone's app
    await sendEventPush((await change(t.g.id, t.y.id)).id);
    expect(push.send).not.toHaveBeenCalled();

    // Phone 1's app sees the note and re-registers itself for all its names (what PushSync's request does).
    expect(Object.values(await getMemberships())).toContain(t.x.id);
    await savePushFor(await getMemberships(), { endpoint: ep1, keys: { p256dh: GOOD_P256DH, auth: GOOD_AUTH } });
    await sendEventPush((await change(t.g.id, t.y.id)).id);
    expect(sentTo()).toEqual(new Set([ep1]));
    expect(sentTo().has(ep2)).toBe(false);
    // Phone 2 still holds the old guest copy, but that copy no longer counts, so it can't re-register.
    state.cookie = await phone1({ [t.g.id]: grantValue(t.x.id, 0) });
    expect(Object.values(await getMemberships())).not.toContain(t.x.id);
    expect((await savePushFor(await getMemberships(), { endpoint: ep2, keys: { p256dh: GOOD_P256DH, auth: GOOD_AUTH } })).groups).toBe(0);
    expect(await rowsFor(t.x.id)).toEqual([ep1]);
  });

  it("only the linked name loses its rows: another, unlinked name's row stays, and a phone that linked nothing sets no note", async () => {
    const t = await group("sn");
    const epX = goodEndpoint(`x-${stamp}-sn`);
    const epZ = goodEndpoint(`z-${stamp}-sn`);
    await sub(t.x.id, epX);
    await sub(t.z.id, epZ);
    const me = await account("Xena");
    state.cookie = await phone1({ [t.g.id]: grantValue(t.x.id, 0) }); // this phone holds X only
    await signInAs(me.id);
    expect(await rowsFor(t.x.id)).toEqual([]);
    expect(await rowsFor(t.z.id)).toEqual([epZ]);
    expect(state.set[PUSH_RESYNC_COOKIE]).toBe("1");
    state.set = {};
    const other = await account("Xenia");
    state.cookie = await phone1({});
    await signInAs(other.id); // holds no names: nothing linked, nothing dropped
    expect(await rowsFor(t.z.id)).toEqual([epZ]);
    expect(state.set[PUSH_RESYNC_COOKIE]).toBeUndefined();
  });

  it("a stale guest copy (old epoch) links nothing and so removes nothing", async () => {
    const t = await group("st");
    const ep = goodEndpoint(`x-${stamp}-st`);
    await sub(t.x.id, ep);
    await db.member.update({ where: { id: t.x.id }, data: { grantEpoch: 2 } });
    const me = await account("Stale");
    state.cookie = await phone1({ [t.g.id]: grantValue(t.x.id, 1) });
    await signInAs(me.id);
    expect((await db.member.findUniqueOrThrow({ where: { id: t.x.id } })).accountId).toBeNull();
    expect(await rowsFor(t.x.id)).toEqual([ep]);
  });

  it("choosing a free name while signed in links it, drops every row and leaves the resync note", async () => {
    const t = await group("sm");
    await sub(t.x.id, goodEndpoint(`one-${stamp}-sm`));
    await sub(t.x.id, goodEndpoint(`two-${stamp}-sm`));
    const me = await account("Pick");
    state.cookie = await phone1({}, me.id);
    await setMyMemberId(t.g.id, t.x.id);
    expect(await rowsFor(t.x.id)).toEqual([]);
    expect(state.set[PUSH_RESYNC_COOKIE]).toBe("1");
  });

  it("choosing a name already linked to the same account changes nothing: same epoch, rows kept, no note", async () => {
    const t = await group("sk");
    const me = await account("Again");
    await db.member.update({ where: { id: t.x.id }, data: { accountId: me.id, grantEpoch: 4 } });
    const ep = goodEndpoint(`k-${stamp}-sk`);
    await sub(t.x.id, ep);
    state.cookie = await phone1({}, me.id);
    await setMyMemberId(t.g.id, t.x.id);
    expect(await rowsFor(t.x.id)).toEqual([ep]);
    expect((await db.member.findUniqueOrThrow({ where: { id: t.x.id } })).grantEpoch).toBe(4);
    expect(state.set[PUSH_RESYNC_COOKIE]).toBeUndefined();
  });

  it("joining from an invitation: an account with two subscribed phones keeps both phones' rows for the new name", async () => {
    const old = await group("iv0");
    const t = await group("iv1");
    const me = await account("Joiner");
    await db.member.update({ where: { id: old.x.id }, data: { accountId: me.id } });
    const ep1 = goodEndpoint(`j1-${stamp}-iv`);
    const ep2 = goodEndpoint(`j2-${stamp}-iv`);
    await sub(old.x.id, ep1);
    await sub(old.x.id, ep2);
    await db.invite.create({ data: { groupId: t.g.id, email: me.email, invitedById: t.y.id, token: `tok-${stamp}`, memberId: t.x.id } });
    state.cookie = await phone1({}, me.id);
    const r = await acceptInvitation(me, `tok-${stamp}`);
    if (!r.ok) throw new Error(r.error);
    await setMyMemberId(r.groupId, r.memberId); // what answerInvitation does next
    expect(r.memberId).toBe(t.x.id);
    expect(await rowsFor(t.x.id)).toEqual([ep1, ep2].sort());
    expect(state.set[PUSH_RESYNC_COOKIE]).toBeUndefined();
    await sendEventPush((await change(t.g.id, t.y.id)).id);
    expect(sentTo()).toEqual(new Set([ep1, ep2]));
  });

  it("another account wins a free name that a guest phone still holds: the guest phone's rows go, the joiner's phones get rows, only they are sent to", async () => {
    const old = await group("jx0");
    const t = await group("jx1");
    const joiner = await account("Rival");
    await db.member.update({ where: { id: old.x.id }, data: { accountId: joiner.id } });
    const j1 = goodEndpoint(`j1-${stamp}-jx`);
    const j2 = goodEndpoint(`j2-${stamp}-jx`);
    const guestPhone = goodEndpoint(`g-${stamp}-jx`);
    await sub(old.x.id, j1);
    await sub(old.x.id, j2);
    await sub(t.x.id, guestPhone); // phone G holds "X" as a guest (the name is free: nobody has claimed it)
    await sendEventPush((await change(t.g.id, t.y.id)).id);
    expect(sentTo()).toEqual(new Set([guestPhone])); // control
    push.send.mockClear();
    state.cookie = await phone1({}, joiner.id);
    const r = await joinExisting(t.g.inviteCode, joiner, t.x.id);
    if (!r.ok) throw new Error(r.reason);
    await copyPushTo(joiner.id, r.memberId); // what both callers do next
    expect((await db.member.findUniqueOrThrow({ where: { id: t.x.id } })).grantEpoch).toBe(1);
    expect(state.set[PUSH_RESYNC_COOKIE]).toBe("1");
    expect(await rowsFor(t.x.id)).toEqual([j1, j2].sort());
    await sendEventPush((await change(t.g.id, t.y.id)).id);
    expect(sentTo()).toEqual(new Set([j1, j2]));
    expect(sentTo().has(guestPhone)).toBe(false);
    // G's old copy no longer counts either.
    state.cookie = await phone1({ [t.g.id]: grantValue(t.x.id, 0) });
    expect(Object.values(await getMemberships())).not.toContain(t.x.id);
  });

  it("a name that was already the joiner's own is not touched by joining again", async () => {
    const t = await group("jy");
    const me = await account("Again2");
    await db.member.update({ where: { id: t.x.id }, data: { accountId: me.id, claimedAt: new Date(), grantEpoch: 3 } });
    const ep = goodEndpoint(`k-${stamp}-jy`);
    await sub(t.x.id, ep);
    const r = await joinExisting(t.g.inviteCode, me, t.x.id);
    expect(r.ok).toBe(true);
    expect(await rowsFor(t.x.id)).toEqual([ep]);
    expect((await db.member.findUniqueOrThrow({ where: { id: t.x.id } })).grantEpoch).toBe(3);
  });

  it("bumpGrantEpochs raises the epoch and removes the rows (all, or all but a kept address)", async () => {
    const t = await group("bg");
    const a = goodEndpoint(`a-${stamp}-bg`);
    const b = goodEndpoint(`b-${stamp}-bg`);
    await sub(t.x.id, a);
    await sub(t.x.id, b);
    await sub(t.z.id, a);
    await db.$transaction((tx) => bumpGrantEpochs(tx, [t.x.id], { keepEndpoint: a }));
    expect(await rowsFor(t.x.id)).toEqual([a]);
    expect((await db.member.findUniqueOrThrow({ where: { id: t.x.id } })).grantEpoch).toBe(1);
    await db.$transaction((tx) => bumpGrantEpochs(tx, [t.x.id]));
    expect(await rowsFor(t.x.id)).toEqual([]);
    expect(await rowsFor(t.z.id)).toEqual([a]); // another name, not bumped
    expect((await db.member.findUniqueOrThrow({ where: { id: t.x.id } })).grantEpoch).toBe(2);
  });

  it("'sign out this phone' removes this phone's address for every name it holds or belonged to; other phones keep theirs", async () => {
    const t = await group("so");
    const mine = goodEndpoint(`mine-${stamp}-so`);
    const theirs = goodEndpoint(`theirs-${stamp}-so`);
    const me = await account("Leaver");
    await db.member.update({ where: { id: t.z.id }, data: { accountId: me.id } }); // a name linked to the signed-in account
    await sub(t.x.id, mine); // a name this phone holds as a guest
    await sub(t.z.id, mine);
    await sub(t.z.id, theirs);
    state.cookie = await phone1({ [t.g.id]: grantValue(t.x.id, 0) }, me.id);
    const f = new FormData();
    f.set("endpoint", mine);
    await expect(signOutThisPhone(f)).rejects.toThrow("REDIRECT /");
    expect(await db.pushSubscription.count({ where: { endpoint: mine } })).toBe(0);
    expect(await rowsFor(t.z.id)).toEqual([theirs]);
  });

  it("'sign out this phone' with no session, or an address that is none of the session's, deletes nothing", async () => {
    const t = await group("sx");
    const other = await group("sy");
    const ep = goodEndpoint(`o-${stamp}-sx`);
    await sub(other.x.id, ep);
    const f = new FormData();
    f.set("endpoint", ep);
    state.cookie = ""; // no session at all
    await expect(signOutThisPhone(f)).rejects.toThrow("REDIRECT /");
    expect(await rowsFor(other.x.id)).toEqual([ep]);
    state.cookie = await phone1({ [t.g.id]: grantValue(t.x.id, 0) }); // a session, but for other names
    await expect(signOutThisPhone(f)).rejects.toThrow("REDIRECT /");
    expect(await rowsFor(other.x.id)).toEqual([ep]);
    const me = await account("Nobody"); // signed in with no groups, still not this address's owner
    state.cookie = await phone1({}, me.id);
    await expect(signOutThisPhone(f)).rejects.toThrow("REDIRECT /");
    expect(await rowsFor(other.x.id)).toEqual([ep]);
  });
});

describe("PushSync's decision (the app's re-register after the resync note)", () => {
  const base = { granted: true, cookieHeader: "a=b", nowMs: 10 * 3600_000 };
  it("the note skips the 6-hour throttle; without it a sync inside 6 hours waits; without permission nothing runs", () => {
    const recent = 9 * 3600_000;
    expect(pushSyncPlan({ ...base, lastSyncMs: recent })).toEqual({ run: false, resync: false });
    expect(pushSyncPlan({ ...base, lastSyncMs: 0 })).toEqual({ run: true, resync: false });
    expect(pushSyncPlan({ ...base, lastSyncMs: recent, cookieHeader: `a=b; ${PUSH_RESYNC_COOKIE}=1` })).toEqual({ run: true, resync: true });
    expect(pushSyncPlan({ ...base, lastSyncMs: 0, granted: false, cookieHeader: `${PUSH_RESYNC_COOKIE}=1` })).toEqual({ run: false, resync: false });
  });
  it("reads only the exact note, and the clearing string expires it", () => {
    expect(hasResyncCookie(`x=1; ${PUSH_RESYNC_COOKIE}=1`)).toBe(true);
    expect(hasResyncCookie(`${PUSH_RESYNC_COOKIE}=0`)).toBe(false);
    expect(hasResyncCookie(`not_${PUSH_RESYNC_COOKIE}=1`)).toBe(false);
    expect(clearResyncCookieString()).toContain("Max-Age=0");
  });
});

describe("L2: the move pass understands cookie grants", () => {
  it("a guest session whose cookie value is 'id~epoch' still shows the person's first name", async () => {
    const t = await group("mv");
    await db.member.update({ where: { id: t.x.id }, data: { name: "Xavier Quinn" } });
    const raw = await encodeSession({ m: { [t.g.id]: grantValue(t.x.id, 3) }, t: today() });
    const token = await createMovePass(raw, false);
    expect(token).toBeTruthy();
    expect(await peekMovePass(token)).toEqual({ firstName: "Xavier", email: "" });
  });
});

describe("L6: one place sends a stranger to /private", () => {
  it("privatePath adds linked=1 only for a group whose old guest name on this phone is now linked to an email", async () => {
    const t = await group("pp");
    const other = await group("pq");
    const owner = await account("Owner");
    await db.member.update({ where: { id: t.x.id }, data: { accountId: owner.id } });
    state.cookie = await phone1({ [t.g.id]: grantValue(t.x.id, 0) });
    expect(await privatePath(t.g.id)).toBe("/private?linked=1");
    expect(await privatePath(other.g.id)).toBe("/private");
  });

  it("no group page sends people to a bare /private (they all use privatePath)", () => {
    const root = path.join(process.cwd(), "src/app/groups");
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => /(page|route)\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(10);
    // A bare redirect("/private"), or new URL("/private", ...) / a "/private" string handed to a redirect in a route file.
    const bareRedirect = /redirect\(\s*["'`]\/private["'`]/;
    const bareUrl = /new URL\(\s*["'`]\/private["'`]/;
    const bare = files.filter((f) => {
      const src = readFileSync(path.join(root, f), "utf8");
      return bareRedirect.test(src) || bareUrl.test(src);
    });
    expect(bare).toEqual([]);
  });
});
