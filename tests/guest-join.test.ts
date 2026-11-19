import { afterAll, describe, expect, it, vi } from "vitest";

// Joining a group without an account: the new-name and claim paths, reserved names, left and removed people, two phones at once,
// the limits, signing in later (what moves, what is skipped), and guest moments. Hand-worked numbers are written next to each check.
const mail = vi.hoisted(() => ({ send: vi.fn(async (_m: unknown) => ({})) }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mail.send, close: () => undefined }) } }));
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
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const join = await import("@/lib/join");
const { inviteByEmail } = await import("@/lib/invites");
const { getMemberships, moveGuestsToAccount, parseConfirmed, signInAs } = await import("@/lib/identity");
const { encodeSession, today } = await import("@/lib/session");
const { saveMoment } = await import("@/lib/moments-db");
const { canDeleteMoment, canAddMoment, loadMomentViewer } = await import("@/lib/moments-access");
const { MOMENTS_PER_PERSON_PER_DAY } = await import("@/lib/covers");
const { markRemovals } = await import("@/lib/removal-marks");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
process.env.MAIL_OUTBOX = "1";
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;

afterAll(async () => {
  state.cookie = "";
  await db.rateLimit.deleteMany({ where: { key: { contains: stamp } } });
  await db.invite.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.appSetting.deleteMany({ where: { OR: groupIds.map((id) => ({ key: { startsWith: `removed:${id}:` } })) } });
  await db.outbox.deleteMany({ where: { to: { contains: stamp } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return { id: a.id, email: a.email, name };
}
// Varun looks after the group (an account). Ravi is a plain name nobody has joined as. `type` can be "trip" for the moment tests.
async function party(opts: { type?: string; joinWeight?: number } = {}) {
  const varun = await account("Varun");
  const g = await db.group.create({
    data: {
      name: `Party ${++n} ${stamp}`, inviteCode: `gj-${n}-${stamp}`, type: opts.type ?? "other", joinWeight: opts.joinWeight ?? 100, tripStart: "2026-03-10", tripEnd: "2026-03-14",
      members: { create: [{ name: "Varun", accountId: varun.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2) }] },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  return { g, code: g.inviteCode, varun, V: g.members[0].id, R: g.members[1].id };
}
const phone = async (m: Record<string, string>, extra: { a?: string; v?: number } = {}) => {
  state.cookie = await encodeSession({ m, ...extra, t: today() });
};

describe("joining as someone new, with no account", () => {
  it("makes a plain name: no account, claimed, seen, the group's join weight, and a 'joined the group' line", async () => {
    const f = await party({ joinWeight: 45 });
    const r = await join.joinNewAsGuest(f.code, "  Ben   Kumar ");
    expect(r.ok).toBe(true);
    const m = await db.member.findUniqueOrThrow({ where: { id: (r as { memberId: string }).memberId } });
    expect(m).toMatchObject({ name: "Ben Kumar", accountId: null, splitWeight: 45, grantEpoch: 0 });
    expect(m.claimedAt).not.toBeNull();
    expect(m.seenAt).not.toBeNull();
    const line = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, actorId: m.id } });
    expect(line.text).toBe("joined the group");
  });
  it("a name already taken gets a number, and an empty name is asked for", async () => {
    const f = await party();
    const r = await join.joinNewAsGuest(f.code, "Ravi");
    expect((await db.member.findUniqueOrThrow({ where: { id: (r as { memberId: string }).memberId } })).name).toBe("Ravi 2");
    expect(await join.joinNewAsGuest(f.code, "   ")).toMatchObject({ ok: false, reason: "name" });
  });
  it("a link that no longer works, or a pair of two people, is refused", async () => {
    expect(await join.joinNewAsGuest(`no-such-code-${stamp}`, "Ben")).toMatchObject({ ok: false, reason: "gone" });
    const f = await party();
    await db.group.update({ where: { id: f.g.id }, data: { type: "direct" } });
    expect(await join.joinNewAsGuest(f.code, "Ben")).toMatchObject({ ok: false, reason: "gone" });
  });
  it("this phone already holds a name here: pressing Join again gives the same person, not a second one", async () => {
    const f = await party();
    const first = (await join.joinNewAsGuest(f.code, "Ben")) as { memberId: string };
    const again = await join.joinNewAsGuest(f.code, "Ben", first.memberId);
    expect(again).toEqual({ ok: true, memberId: first.memberId });
    expect(await db.member.count({ where: { groupId: f.g.id, name: { startsWith: "Ben" } } })).toBe(1);
  });
  it("the group can take 60 people joining this way and then says it is full (a guest join counts the people still in)", async () => {
    const f = await party();
    await db.member.createMany({ data: Array.from({ length: join.GUEST_GROUP_CAP - 2 }, (_, i) => ({ name: `P${i}`, groupId: f.g.id, claimedAt: new Date() })) });
    expect(await db.member.count({ where: { groupId: f.g.id, leftAt: null } })).toBe(60);
    expect(await join.joinNewAsGuest(f.code, "One too many")).toMatchObject({ ok: false, reason: "full" });
  });
});

describe("taking over a name (That's me), with no account", () => {
  it("claims a plain name: epoch up, claimedAt set, notification rows gone, a line in the history", async () => {
    const f = await party();
    await db.pushSubscription.create({ data: { memberId: f.R, endpoint: `https://push.test/${stamp}-r`, p256dh: "k", auth: "a" } });
    const r = await join.joinExistingAsGuest(f.code, f.R);
    expect(r).toEqual({ ok: true, memberId: f.R });
    const m = await db.member.findUniqueOrThrow({ where: { id: f.R } });
    expect(m.accountId).toBeNull();
    expect(m.claimedAt).not.toBeNull();
    expect(m.grantEpoch).toBe(1); // 0 + 1
    expect(await db.pushSubscription.count({ where: { memberId: f.R } })).toBe(0);
    expect((await db.groupEvent.findFirstOrThrow({ where: { groupId: f.g.id, actorId: f.R } })).text).toBe("joined the group");
  });
  it("two phones claim at once: exactly one wins, and the old copy of the cookie is refused", async () => {
    const f = await party();
    const [a, b] = await Promise.all([join.joinExistingAsGuest(f.code, f.R), join.joinExistingAsGuest(f.code, f.R)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ reason: "claimed" });
    // The winner's note carries epoch 1; a copy from before the claim (epoch 0) does nothing.
    await phone({ [f.g.id]: `${f.R}~0` });
    expect(await getMemberships()).toEqual({});
    await phone({ [f.g.id]: `${f.R}~1` });
    expect(await getMemberships()).toEqual({ [f.g.id]: f.R });
  });
  it("a name already taken, left, or removed is refused", async () => {
    const f = await party();
    const taken = await db.member.create({ data: { name: "Taken", groupId: f.g.id, claimedAt: new Date() } });
    const left = await db.member.create({ data: { name: "Left", groupId: f.g.id, leftAt: new Date() } });
    const gone = await db.member.create({ data: { name: "Gone", groupId: f.g.id, leftAt: new Date(), removedAt: new Date(), removedById: f.V } });
    expect(await join.joinExistingAsGuest(f.code, taken.id)).toMatchObject({ ok: false, reason: "claimed" });
    expect(await join.joinExistingAsGuest(f.code, left.id)).toMatchObject({ ok: false, reason: "left" });
    expect(await join.joinExistingAsGuest(f.code, gone.id)).toMatchObject({ ok: false, reason: "claimed" });
    expect(await join.joinExistingAsGuest(f.code, f.V)).toMatchObject({ ok: false, reason: "claimed" }); // an account's name
    expect(await join.joinExistingAsGuest(f.code, "no-such-member")).toMatchObject({ ok: false, reason: "claimed" });
  });
  it("a name an email invitation is reserved for is refused (a guest has no email to match); after a new link it can be claimed", async () => {
    const f = await party();
    const uma = await account("Uma");
    await inviteByEmail(f.g.id, f.V, uma.email, "https://loopin.test");
    const row = await db.invite.findFirstOrThrow({ where: { groupId: f.g.id, email: uma.email } });
    expect(row.memberId).not.toBe("");
    expect(await join.joinExistingAsGuest(f.code, row.memberId)).toMatchObject({ ok: false, reason: "claimed" });
    expect((await db.member.findUniqueOrThrow({ where: { id: row.memberId } })).claimedAt).toBeNull(); // nothing changed
    // A new link closes the unanswered invitation: the name is a plain name again.
    const nl = await join.newInviteLink(f.g.id, f.V);
    expect(nl.ok).toBe(true);
    const code = (nl as { code: string }).code;
    expect(await join.joinExistingAsGuest(code, row.memberId)).toEqual({ ok: true, memberId: row.memberId });
  });
  it("a name whose invitation was cancelled can be claimed", async () => {
    const f = await party();
    const uma = await account("Uma");
    await inviteByEmail(f.g.id, f.V, uma.email, "https://loopin.test");
    const row = await db.invite.findFirstOrThrow({ where: { groupId: f.g.id, email: uma.email } });
    const { cancelInvitation } = await import("@/lib/invites");
    expect((await cancelInvitation(f.g.id, f.V, row.memberId)).ok).toBe(true);
    expect(await join.joinExistingAsGuest(f.code, row.memberId)).toEqual({ ok: true, memberId: row.memberId });
  });
});

describe("someone who left, or was removed, coming back through the link as a guest", () => {
  it("left on their own: the phone that holds the name comes back, with a 'rejoined' line, and no new name", async () => {
    const f = await party();
    const me = (await join.joinNewAsGuest(f.code, "Lee")) as { memberId: string };
    await db.member.update({ where: { id: me.memberId }, data: { leftAt: new Date() } });
    const r = await join.joinNewAsGuest(f.code, "Lee", me.memberId);
    expect(r).toEqual({ ok: true, memberId: me.memberId });
    expect((await db.member.findUniqueOrThrow({ where: { id: me.memberId } })).leftAt).toBeNull();
    expect(await db.groupEvent.count({ where: { groupId: f.g.id, kind: "member_rejoined", actorId: me.memberId } })).toBe(1);
    expect(await db.member.count({ where: { groupId: f.g.id, name: { startsWith: "Lee" } } })).toBe(1);
  });
  it("removed by the admin: the same phone is refused (both ways in); with the cookie cleared they can join under a new name (the stated limit), and the history shows it", async () => {
    const f = await party();
    const me = (await join.joinNewAsGuest(f.code, "Rex")) as { memberId: string };
    await db.member.update({ where: { id: me.memberId }, data: { leftAt: new Date(), removedAt: new Date(), removedById: f.V } });
    expect(await join.joinNewAsGuest(f.code, "Rex", me.memberId)).toMatchObject({ ok: false, reason: "removed", adminName: "Varun" });
    expect(await join.joinExistingAsGuest(f.code, f.R, me.memberId)).toMatchObject({ ok: false, reason: "removed" });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.R } })).claimedAt).toBeNull(); // nothing was taken
    // Cookie cleared (or another browser): a new name. This is the limit, said plainly; the group sees it.
    const again = (await join.joinNewAsGuest(f.code, "Rex")) as { memberId: string };
    expect(again.memberId).not.toBe(me.memberId);
    expect((await db.member.findUniqueOrThrow({ where: { id: again.memberId } })).name).toBe("Rex 2");
    expect(await db.groupEvent.count({ where: { groupId: f.g.id, actorId: again.memberId, text: "joined the group" } })).toBe(1);
  });
});

describe("the limits on guest joins", () => {
  const T = new Date("2026-11-19T10:00:00.000Z");
  it("20 an hour from one address pass and the 21st is busy; another address is not affected", async () => {
    const ip = `ip-${stamp}-1`;
    for (let i = 1; i <= 20; i++) expect(await join.guestJoinAllowed(ip, `grp-${stamp}-a${i}`, T), `join ${i}`).toBe(true);
    expect(await join.guestJoinAllowed(ip, `grp-${stamp}-a21`, T)).toBe(false);
    expect(await join.guestJoinAllowed(`ip-${stamp}-2`, `grp-${stamp}-a22`, T)).toBe(true);
  });
  it("30 a day for one link, from different addresses; the 31st is busy", async () => {
    const link = `grp-${stamp}-link`;
    for (let i = 1; i <= 30; i++) expect(await join.guestJoinAllowed(`ip-${stamp}-L${i}`, link, T), `join ${i}`).toBe(true);
    expect(await join.guestJoinAllowed(`ip-${stamp}-L31`, link, T)).toBe(false);
  });
  it("the actions run both limits for a guest, and 'That's me' has them too", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/actions.ts", "utf8");
    const body = (name: string) => src.slice(src.indexOf(`export async function ${name}`), src.indexOf("\n}\n", src.indexOf(`export async function ${name}`)));
    expect(body("joinAsNew")).toContain("guestJoinBusy(");
    expect(body("joinAsExisting")).toContain("guestJoinBusy(");
    expect(join.GUEST_JOIN_PER_IP).toBe(20);
    expect(join.GUEST_JOIN_PER_LINK).toBe(30);
  });
});

describe("signing in later", () => {
  it("links the confirmed guest name (same member row, so the name and history stay) and moves the moments to the account", async () => {
    const f = await party({ type: "trip" });
    const me = (await join.joinNewAsGuest(f.code, "Ben")) as { memberId: string };
    const ben = await account("Ben");
    await db.moment.create({ data: { groupId: f.g.id, authorId: me.memberId, authorAccountId: "", data: new Uint8Array(), thumbData: new Uint8Array() } });
    await phone({ [f.g.id]: `${me.memberId}~0` });
    await signInAs(ben.id, { confirmed: parseConfirmed([me.memberId]) });
    const m = await db.member.findUniqueOrThrow({ where: { id: me.memberId } });
    expect(m).toMatchObject({ accountId: ben.id, name: "Ben", grantEpoch: 1 });
    expect((await db.moment.findFirstOrThrow({ where: { authorId: me.memberId } })).authorAccountId).toBe(ben.id);
  });
  it("an account removed from the group is not linked to a guest name there, and it is said (skipped)", async () => {
    const f = await party();
    const me = (await join.joinNewAsGuest(f.code, "Zed")) as { memberId: string };
    const zed = await account("Zed");
    await db.member.create({ data: { name: "Zed old", groupId: f.g.id, accountId: zed.id, claimedAt: new Date(), leftAt: new Date(), removedAt: new Date(), removedById: f.V } });
    await phone({ [f.g.id]: `${me.memberId}~0` }, { a: zed.id, v: 0 });
    const skipped: string[] = [];
    expect(await moveGuestsToAccount(parseConfirmed([me.memberId]), { skipped })).toBe(0);
    expect(skipped).toEqual([me.memberId]);
    expect((await db.member.findUniqueOrThrow({ where: { id: me.memberId } })).accountId).toBeNull(); // still a guest name
    expect(await db.member.count({ where: { groupId: f.g.id, accountId: zed.id } })).toBe(1); // no second row
  });
  it("an account that has a removal mark for the group (deleted and signed up again) is not linked either", async () => {
    const f = await party();
    const me = (await join.joinNewAsGuest(f.code, "Mia")) as { memberId: string };
    const mia = await account("Mia");
    await db.$transaction(async (tx) => {
      await tx.member.create({ data: { name: "Mia old", groupId: f.g.id, accountId: mia.id, claimedAt: new Date(), leftAt: new Date(), removedAt: new Date(), removedById: f.V } });
      await markRemovals(tx, mia.id, mia.email);
      await tx.member.deleteMany({ where: { groupId: f.g.id, accountId: mia.id } }); // the account's old row is gone; only the note is left
    });
    await phone({ [f.g.id]: `${me.memberId}~0` }, { a: mia.id, v: 0 });
    const skipped: string[] = [];
    expect(await moveGuestsToAccount(parseConfirmed([me.memberId]), { skipped })).toBe(0);
    expect(skipped).toEqual([me.memberId]);
  });
  it("an account that already has a row in the group is not double-linked", async () => {
    const f = await party();
    const me = (await join.joinNewAsGuest(f.code, "Kit")) as { memberId: string };
    const kit = await account("Kit");
    await db.member.create({ data: { name: "Kit (account)", groupId: f.g.id, accountId: kit.id, claimedAt: new Date() } });
    await phone({ [f.g.id]: `${me.memberId}~0` }, { a: kit.id, v: 0 });
    const skipped: string[] = [];
    expect(await moveGuestsToAccount(parseConfirmed([me.memberId]), { skipped })).toBe(0);
    expect(skipped).toHaveLength(1);
    expect(await db.member.count({ where: { groupId: f.g.id, accountId: kit.id } })).toBe(1);
  });
  it("a name that was not confirmed stays a guest name (no confirmation, nothing moves)", async () => {
    const f = await party();
    const me = (await join.joinNewAsGuest(f.code, "Una")) as { memberId: string };
    const una = await account("Una");
    await phone({ [f.g.id]: `${me.memberId}~0` });
    await signInAs(una.id, { confirmed: parseConfirmed([]) });
    expect((await db.member.findUniqueOrThrow({ where: { id: me.memberId } })).accountId).toBeNull();
  });
});

describe("moments added without an account", () => {
  const photo = (g: string, memberId: string, accountId: string | null) => ({
    groupId: g, memberId, accountId, caption: "", takenOn: "", type: "image/webp", width: 1, height: 1, blobKey: "", thumbKey: "", data: new Uint8Array(3) as Uint8Array<ArrayBuffer>, thumbData: new Uint8Array(3) as Uint8Array<ArrayBuffer>,
  });
  it("a guest can add (canAddMoment), the moment carries no account, and the daily limit is per member", async () => {
    const f = await party({ type: "trip" });
    const ben = (await join.joinNewAsGuest(f.code, "Ben")) as { memberId: string };
    const cat = (await join.joinNewAsGuest(f.code, "Cat")) as { memberId: string };
    const viewer = await loadMomentViewer(f.g.id, ben.memberId);
    expect(canAddMoment(viewer)).toBe(true);
    for (let i = 0; i < MOMENTS_PER_PERSON_PER_DAY; i++) expect((await saveMoment(photo(f.g.id, ben.memberId, null))).ok, `moment ${i + 1}`).toBe(true);
    expect(await saveMoment(photo(f.g.id, ben.memberId, null))).toEqual({ ok: false, reason: "slow-down" }); // the 11th for Ben
    expect((await saveMoment(photo(f.g.id, cat.memberId, null))).ok).toBe(true); // Cat's count is her own
    const row = await db.moment.findFirstOrThrow({ where: { authorId: ben.memberId } });
    expect(row.authorAccountId).toBe("");
  });
  it("after signing in the moments are the account's, and 'delete my own' still works; before, the guest deletes theirs by member id and no one else's", async () => {
    const f = await party({ type: "trip" });
    const ben = (await join.joinNewAsGuest(f.code, "Ben")) as { memberId: string };
    const cat = (await join.joinNewAsGuest(f.code, "Cat")) as { memberId: string };
    const saved = await saveMoment(photo(f.g.id, ben.memberId, null));
    const moment = await db.moment.findFirstOrThrow({ where: { authorId: ben.memberId } });
    const facts = { groupId: f.g.id, authorId: moment.authorId, authorAccountId: moment.authorAccountId, createdAt: moment.createdAt };
    expect(saved.ok).toBe(true);
    expect(canDeleteMoment(await loadMomentViewer(f.g.id, ben.memberId), facts)).toBe(true);
    expect(canDeleteMoment(await loadMomentViewer(f.g.id, cat.memberId), facts)).toBe(false);
    const bea = await account("Bea");
    await phone({ [f.g.id]: `${ben.memberId}~0` });
    await signInAs(bea.id, { confirmed: parseConfirmed([ben.memberId]) });
    const after = await db.moment.findFirstOrThrow({ where: { authorId: ben.memberId } });
    expect(after.authorAccountId).toBe(bea.id);
    expect(canDeleteMoment(await loadMomentViewer(f.g.id, ben.memberId), { groupId: f.g.id, authorId: after.authorId, authorAccountId: after.authorAccountId, createdAt: after.createdAt })).toBe(true);
  });
});
