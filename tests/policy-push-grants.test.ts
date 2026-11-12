import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// M4: a phone that loses a name (its grant epoch goes up) also stops getting that name's phone notifications.
// L2: the move pass reads cookie grants ("id~epoch") properly.
// L6: every group page sends a stranger to the same place, through one helper.
// web-push is replaced by a stand-in that records who was sent to; nothing leaves this machine.
const state = vi.hoisted(() => ({ cookie: "" }));
const push = vi.hoisted(() => ({ send: vi.fn(async (_s: { endpoint: string }, _p?: unknown, _o?: unknown) => ({})) }));
vi.mock("web-push", () => ({ default: { sendNotification: push.send, generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }) } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
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
  const a = await db.account.create({ data: { email: `pg-${label}-${stamp}@example.test`, name: label } });
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
  push.send.mockClear();
});
afterAll(async () => {
  if (!hadKeys) await db.appSetting.deleteMany({ where: { key: "vapid" } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("M4: a phone that loses a name stops getting its notifications", () => {
  it("phone 2 holds a guest copy of X and is subscribed; phone 1 signs in and links X: phone 2's row is gone and a send for X's group misses it", async () => {
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
    await signInAs(me.id, { keepEndpoint: ep1 });

    expect((await db.member.findUniqueOrThrow({ where: { id: t.x.id } })).accountId).toBe(me.id);
    expect(await rowsFor(t.x.id)).toEqual([ep1]); // phone 1 (the one that signed in) keeps its own
    await sendEventPush((await change(t.g.id, t.y.id)).id);
    expect(sentTo()).toEqual(new Set([ep1]));
    expect(sentTo().has(ep2)).toBe(false);
  });

  it("without the phone's own address (a plain sign-in), every row for the linked name goes; names that were not linked keep theirs", async () => {
    const t = await group("sn");
    const epX = goodEndpoint(`x-${stamp}-sn`);
    const epZ = goodEndpoint(`z-${stamp}-sn`);
    await sub(t.x.id, epX);
    await sub(t.z.id, epZ);
    const me = await account("Xena");
    state.cookie = await phone1({ [t.g.id]: grantValue(t.x.id, 0) });
    await signInAs(me.id);
    expect(await rowsFor(t.x.id)).toEqual([]);
    expect(await rowsFor(t.z.id)).toEqual([epZ]);
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

  it("choosing a name while signed in links it and drops the other phones' rows, keeping the given address", async () => {
    const t = await group("sm");
    const keep = goodEndpoint(`keep-${stamp}-sm`);
    const other = goodEndpoint(`other-${stamp}-sm`);
    await sub(t.x.id, keep);
    await sub(t.x.id, other);
    const me = await account("Pick");
    state.cookie = await phone1({}, me.id);
    await setMyMemberId(t.g.id, t.x.id, { keepEndpoint: keep });
    expect(await rowsFor(t.x.id)).toEqual([keep]);
  });

  it("bumpGrantEpochs raises the epoch and removes the rows (all, or all but the kept address)", async () => {
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

  it("'sign out this phone' removes this phone's address for every name, including ones it no longer holds; other phones keep theirs", async () => {
    const t = await group("so");
    const mine = goodEndpoint(`mine-${stamp}-so`);
    const theirs = goodEndpoint(`theirs-${stamp}-so`);
    await sub(t.x.id, mine); // a name this phone still holds
    await sub(t.z.id, mine); // a name it held earlier (linked to someone since)
    await sub(t.z.id, theirs);
    state.cookie = await phone1({ [t.g.id]: grantValue(t.x.id, 0) });
    const f = new FormData();
    f.set("endpoint", mine);
    await expect(signOutThisPhone(f)).rejects.toThrow("REDIRECT /");
    expect(await db.pushSubscription.count({ where: { endpoint: mine } })).toBe(0);
    expect(await rowsFor(t.z.id)).toEqual([theirs]);
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
    const bare = files.filter((f) => /redirect\(\s*["'`]\/private["'`]\s*\)/.test(readFileSync(path.join(root, f), "utf8")));
    expect(bare).toEqual([]);
  });
});
