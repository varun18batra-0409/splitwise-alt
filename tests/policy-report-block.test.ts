import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// POL-03: report and block. Blocking stops postcards, passports, nudges and their pushes, both ways for passports;
// it never touches group expenses or balances. Reports are saved and the operator is emailed (kept in the test outbox).

const state = vi.hoisted(() => ({ session: "", ip: "", pending: [] as (() => unknown)[] }));
// web-push is replaced by a stand-in that records who was sent to; nothing leaves this machine.
const push = vi.hoisted(() => ({ send: vi.fn(async (_s: { endpoint: string }, _p?: unknown, _o?: unknown) => ({})) }));
vi.mock("web-push", () => ({ default: { sendNotification: push.send, generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }) } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.session ? { value: state.session } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(state.ip ? { "x-forwarded-for": state.ip } : {}),
}));
// after(): the work that runs once the reply is sent is queued here and run by the test.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => void state.pending.push(fn) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
// A server action ends by redirecting; here the redirect is caught and its address handed back.
vi.mock("@/lib/fresh-redirect", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { blockAccount, unblockAccount, blockedByMe, blockedEitherWay, unreadPostcards, isBlockedEitherWay } = await import("@/lib/blocks");
const { canSendTo, postcardPeople } = await import("@/lib/postcards/people");
const { canSeePassport, passportFriends } = await import("@/lib/passport-db");
const { deliverNotes } = await import("@/lib/account-notes");
const { sendPassportAction } = await import("@/app/passport/send/actions");
const { sendPostcardAction } = await import("@/app/postcard-actions");
const { nudgePassportAction } = await import("@/app/passport-actions");
const { reportAction, blockAction, unblockAction, resolveReportAction } = await import("@/app/safety-actions");
const { requireOwner, isOwner } = await import("@/lib/owner");
const { netBalances } = await import("@/lib/balances");
const { deleteAccount } = await import("@/lib/auth");
const { loopinFriends, createCollection, organiserAction } = await import("@/lib/collect");
const { addRegistered } = await import("@/lib/invites");
const { sendEventPush, sendPushTo } = await import("@/lib/push");
const { contactSupportAction } = await import("@/app/safety-actions");
const { loadReportsForOwner, saveSupportMessage } = await import("@/lib/reports");
const { loadInvitations } = await import("@/lib/invitations");
const { inviteToClaim } = await import("@/lib/invites");
const { markPaidAction } = await import("@/app/collect-actions");
const { reactPostcardAction } = await import("@/app/postcard-actions");
const { REACTIONS } = await import("@/lib/postcards/looks");
const { canViewPostcard } = await import("@/lib/blocks");
const myData = await import("@/app/api/my-data/route");
const photoRoute = await import("@/app/api/postcard-photo/[id]/route");
const { GOOD_AUTH, GOOD_P256DH, goodEndpoint } = await import("./helpers/push-keys");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
process.env.MAIL_OUTBOX = "1";

async function account(label: string) {
  const a = await db.account.create({ data: { email: `rb-${label.toLowerCase()}-${stamp}@example.test`, name: label, passportChoiceAt: new Date() } });
  accountIds.push(a.id);
  return a;
}
// Asha, Ben and Cleo, all in one group; Asha paid ₹100.00 split 3334 / 3333 / 3333.
async function crew(label: string) {
  const [asha, ben, cleo] = await Promise.all([account(`Asha${label}`), account(`Ben${label}`), account(`Cleo${label}`)]);
  const g = await db.group.create({
    data: {
      name: `Crew ${label} ${stamp}`, inviteCode: `rb-${label}-${stamp}`,
      members: { create: [asha, ben, cleo].map((a) => ({ name: a.name, accountId: a.id, claimedAt: new Date() })) },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  const [ma, mb, mc] = g.members;
  const e = await db.expense.create({
    data: {
      groupId: g.id, description: "Dinner", amount: 10000, splitType: "equal", paidById: ma.id, createdById: ma.id,
      shares: { create: [{ memberId: ma.id, amount: 3334 }, { memberId: mb.id, amount: 3333 }, { memberId: mc.id, amount: 3333 }] },
    },
    include: { shares: true },
  });
  return { g, asha, ben, cleo, ma, mb, mc, e };
}
async function signedInAs(a: { id: string }) {
  state.session = await encodeSession({ m: {}, a: a.id, v: 0, t: today() });
}
function form(o: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
async function redirected(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const m = /^REDIRECT (.*)$/.exec((e as Error).message);
    if (m) return m[1];
    throw e;
  }
  throw new Error("expected a redirect");
}

let hadKeys = true;
const rateKeys: string[] = [];
beforeAll(async () => {
  hadKeys = Boolean(await db.appSetting.findUnique({ where: { key: "vapid" } }));
});
beforeEach(() => {
  state.session = "";
  state.ip = "";
  state.pending = [];
  push.send.mockClear();
  delete process.env.ADMIN_EMAIL;
});
afterAll(async () => {
  if (!hadKeys) await db.appSetting.deleteMany({ where: { key: "vapid" } }); // the stand-in keys made here
  await db.rateLimit.deleteMany({ where: { key: { in: rateKeys } } });
  await db.report.deleteMany({ where: { note: { contains: stamp } } });
  await db.collection.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.report.deleteMany({ where: { reporterId: { in: accountIds } } });
  await db.block.deleteMany({ where: { OR: [{ blockerId: { in: accountIds } }, { blockedId: { in: accountIds } }] } });
  await db.postcard.deleteMany({ where: { OR: [{ fromId: { in: accountIds } }, { toId: { in: accountIds } }] } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.outbox.deleteMany({ where: { to: { contains: stamp } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("a blocked person can't reach the blocker", () => {
  it("postcards: not offered and can't be sent to, either way round; unblocking brings it back", async () => {
    const t = await crew("pc");
    expect([...(await canSendTo(t.ben.id, [t.asha.id, t.cleo.id]))].sort()).toEqual([t.asha.id, t.cleo.id].sort());
    expect(await blockAccount(t.asha.id, t.ben.id)).toBe(true);
    expect([...(await canSendTo(t.ben.id, [t.asha.id, t.cleo.id]))]).toEqual([t.cleo.id]);
    expect([...(await canSendTo(t.asha.id, [t.ben.id, t.cleo.id]))]).toEqual([t.cleo.id]);
    const offered = (await postcardPeople(t.ben.id)).flatMap((g) => g.people.map((p) => p.id));
    expect(offered).not.toContain(t.asha.id);
    await unblockAccount(t.asha.id, t.ben.id);
    expect((await canSendTo(t.ben.id, [t.asha.id])).has(t.asha.id)).toBe(true);
  });

  it("the send-postcard action refuses and saves nothing", async () => {
    const t = await crew("pa");
    await blockAccount(t.asha.id, t.ben.id);
    await signedInAs(t.ben);
    const url = await redirected(() => sendPostcardAction(form({ to: t.asha.id, front: "print:beach", message: "hello" })));
    expect(url).toContain("error=");
    expect(await db.postcard.count({ where: { fromId: t.ben.id, toId: t.asha.id } })).toBe(0);
  });

  it("the send-passport action: Cleo gets it (control), blocked Asha does not", async () => {
    const t = await crew("ps");
    await blockAccount(t.asha.id, t.ben.id);
    await signedInAs(t.ben);
    const url = await redirected(() => sendPassportAction(form({ to: [t.asha.id, t.cleo.id] })));
    expect(url).toBe("/passport?sent=1");
    expect(await db.accountNote.count({ where: { accountId: t.asha.id, kind: "passport" } })).toBe(0);
    expect(await db.accountNote.count({ where: { accountId: t.cleo.id, kind: "passport" } })).toBe(1);
  });

  it("nudges: Cleo is nudged (control), blocked Asha is not", async () => {
    const t = await crew("nu");
    await blockAccount(t.asha.id, t.ben.id);
    await signedInAs(t.ben);
    await redirected(() => nudgePassportAction(form({ accountId: t.cleo.id })));
    await redirected(() => nudgePassportAction(form({ accountId: t.asha.id })));
    expect(await db.accountNote.count({ where: { accountId: t.cleo.id, kind: "passport_nudge" } })).toBe(1);
    expect(await db.accountNote.count({ where: { accountId: t.asha.id, kind: "passport_nudge" } })).toBe(0);
  });

  it("passports are closed both ways, and the friends list leaves the person out", async () => {
    const t = await crew("pp");
    expect((await canSeePassport(t.ben.id, t.asha.id)).ok).toBe(true);
    await blockAccount(t.asha.id, t.ben.id);
    expect(await canSeePassport(t.ben.id, t.asha.id)).toMatchObject({ ok: false, reason: "stranger" });
    expect(await canSeePassport(t.asha.id, t.ben.id)).toMatchObject({ ok: false, reason: "stranger" });
    expect((await passportFriends(t.asha.id)).map((f) => f.accountId)).toEqual([t.cleo.id]);
    expect((await passportFriends(t.ben.id)).map((f) => f.accountId)).toEqual([t.cleo.id]);
    expect((await canSeePassport(t.cleo.id, t.asha.id)).ok).toBe(true);
  });

  it("their pushes and alerts: a note from the blocked person is dropped, one from Cleo arrives", async () => {
    const t = await crew("pu");
    await blockAccount(t.asha.id, t.ben.id);
    const note = (from: string) => ({ accountIds: [t.asha.id], kind: "postcard", title: "x", body: "y", url: "/postcards", tag: `t-${from}`, fromAccountId: from });
    await deliverNotes([note(t.ben.id)]);
    expect(await db.accountNote.count({ where: { accountId: t.asha.id } })).toBe(0);
    await deliverNotes([note(t.cleo.id)]);
    expect(await db.accountNote.count({ where: { accountId: t.asha.id } })).toBe(1);
  });
});

describe("the blocker's view", () => {
  it("their postcards drop out of the new-cards count; Cleo's stay", async () => {
    const t = await crew("vw");
    const card = (fromId: string) => db.postcard.create({ data: { fromId, toId: t.asha.id, front: "print:beach", message: "hi" } });
    await card(t.ben.id);
    await card(t.cleo.id);
    expect(await unreadPostcards(t.asha.id)).toBe(2);
    await blockAccount(t.asha.id, t.ben.id);
    expect(await unreadPostcards(t.asha.id)).toBe(1);
    expect(await blockedByMe(t.asha.id)).toEqual([t.ben.id]);
  });

  it("blocking twice is one block; you can't block yourself or a stranger id", async () => {
    const t = await crew("dd");
    await blockAccount(t.asha.id, t.ben.id);
    await blockAccount(t.asha.id, t.ben.id);
    expect(await db.block.count({ where: { blockerId: t.asha.id, blockedId: t.ben.id } })).toBe(1);
    expect(await blockAccount(t.asha.id, t.asha.id)).toBe(false);
    expect(await blockAccount(t.asha.id, "no-such-account")).toBe(false);
    expect([...(await blockedEitherWay(t.ben.id))]).toEqual([t.asha.id]);
  });
});

describe("blocking never touches shared money", () => {
  it("₹100.00 paid by Asha, shares 33.34 / 33.33 / 33.33: balances are +66.66 / -33.33 / -33.33 before and after", async () => {
    const t = await crew("mn");
    const ids = [t.ma.id, t.mb.id, t.mc.id];
    const read = async () => {
      const g = await db.group.findUniqueOrThrow({ where: { id: t.g.id }, include: { expenses: { include: { shares: true } }, payments: true } });
      return netBalances(ids, g.expenses.filter((e) => !e.deletedAt), g.payments.filter((p) => !p.deletedAt));
    };
    const expected = { [t.ma.id]: 6666, [t.mb.id]: -3333, [t.mc.id]: -3333 };
    expect(await read()).toEqual(expected);
    await blockAccount(t.asha.id, t.ben.id);
    await blockAccount(t.ben.id, t.asha.id);
    expect(await read()).toEqual(expected);
    expect(Object.values(await read()).reduce((a, b) => a + b, 0)).toBe(0);
    expect(await db.expense.count({ where: { groupId: t.g.id, deletedAt: null } })).toBe(1);
    expect(await db.member.count({ where: { groupId: t.g.id, leftAt: null } })).toBe(3);
  });

  it("deleting an account removes its blocks", async () => {
    const t = await crew("dl");
    await blockAccount(t.asha.id, t.ben.id);
    await deleteAccount(t.ben.id);
    expect(await db.block.count({ where: { OR: [{ blockerId: t.ben.id }, { blockedId: t.ben.id }] } })).toBe(0);
  });
});

describe("block and unblock actions", () => {
  it("block from a screen, then unblock from the You page list; strangers can't be blocked", async () => {
    const t = await crew("ba");
    const outsider = await account(`Out${stamp.slice(-4)}`);
    await signedInAs(t.asha);
    expect(await redirected(() => blockAction(form({ accountId: t.ben.id, back: "/passport/friends" })))).toBe("/account?blocked=1#blocked");
    expect(await blockedByMe(t.asha.id)).toEqual([t.ben.id]);
    await redirected(() => blockAction(form({ accountId: outsider.id })));
    expect(await blockedByMe(t.asha.id)).toEqual([t.ben.id]);
    expect(await redirected(() => unblockAction(form({ accountId: t.ben.id })))).toBe("/account?unblocked=1#blocked");
    expect(await blockedByMe(t.asha.id)).toEqual([]);
  });
});

describe("reports", () => {
  it("a report on a received postcard is saved and the operator is emailed (test outbox), with a link and no photo", async () => {
    const t = await crew("rp");
    const opEmail = `rb-operator-${stamp}@example.test`;
    process.env.ADMIN_EMAIL = opEmail;
    const card = await db.postcard.create({ data: { fromId: t.ben.id, toId: t.asha.id, front: "own", photoId: "secret-photo-id", message: "private words" } });
    await signedInAs(t.asha);
    const url = await redirected(() => reportAction(form({ kind: "postcard", id: card.id, reason: "abusive", note: "rude", back: "/postcards" })));
    expect(url).toContain("done=1");
    const rows = await db.report.findMany({ where: { reporterId: t.asha.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "postcard", targetId: card.id, targetAccountId: t.ben.id, reason: "abusive", note: "rude", status: "open" });
    const mail = await db.outbox.findMany({ where: { to: opEmail } });
    expect(mail).toHaveLength(1);
    expect(mail[0].text).toContain("/stats/reports");
    // L5: the email only says a report came in. The reporter's own words, and the reason, stay in the owner-only page.
    expect(mail[0].text).not.toContain("rude");
    expect(mail[0].text).not.toContain("secret-photo-id");
    expect(mail[0].text).not.toContain("private words");
  });

  it("the same open report twice is kept once; a person report needs a shared group; bad reasons are refused", async () => {
    const t = await crew("rq");
    const outsider = await account(`Rz${stamp.slice(-4)}`);
    await signedInAs(t.asha);
    const send = (o: Record<string, string>) => redirected(() => reportAction(form({ back: "/account", ...o })));
    await send({ kind: "person", id: t.ben.id, reason: "spam" });
    await send({ kind: "person", id: t.ben.id, reason: "spam" });
    expect(await db.report.count({ where: { reporterId: t.asha.id } })).toBe(1);
    expect(await send({ kind: "person", id: outsider.id, reason: "spam" })).toContain("error=");
    expect(await send({ kind: "passport", id: t.cleo.id, reason: "nonsense" })).toContain("error=");
    expect(await db.report.count({ where: { reporterId: t.asha.id } })).toBe(1);
  });

  it("someone else's postcard can't be reported by a person it wasn't sent to", async () => {
    const t = await crew("rr");
    const card = await db.postcard.create({ data: { fromId: t.ben.id, toId: t.cleo.id, front: "print:beach", message: "hi" } });
    await signedInAs(t.asha);
    expect(await redirected(() => reportAction(form({ kind: "postcard", id: card.id, reason: "spam", back: "/postcards" })))).toContain("error=");
    expect(await db.report.count({ where: { targetId: card.id } })).toBe(0);
  });
});

describe("owner only", () => {
  it("/stats/reports: only an email in ADMIN_EMAIL gets in; everyone else (and signed out) gets not-found", async () => {
    process.env.ADMIN_EMAIL = "Boss@Example.test, other@example.test";
    expect(isOwner({ email: "boss@example.test" })).toBe(true);
    expect(() => requireOwner({ email: "boss@example.test" })).not.toThrow();
    expect(() => requireOwner({ email: "ben@example.test" })).toThrow();
    expect(() => requireOwner(null)).toThrow();
    delete process.env.ADMIN_EMAIL;
    expect(() => requireOwner({ email: "boss@example.test" })).toThrow();
  });

  it("only the owner can mark a report resolved", async () => {
    const t = await crew("ow");
    const r = await db.report.create({ data: { reporterId: t.asha.id, kind: "person", targetId: t.ben.id, targetAccountId: t.ben.id, reason: "spam" } });
    await signedInAs(t.cleo);
    await redirected(() => resolveReportAction(form({ id: r.id })));
    expect((await db.report.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("open");
    process.env.ADMIN_EMAIL = t.cleo.email;
    await redirected(() => resolveReportAction(form({ id: r.id })));
    const after = await db.report.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.status).toBe("resolved");
    expect(after.resolvedAt).not.toBeNull();
  });
});


// ---------- M2: blocking can't be got round ----------
describe("blocking: collections", () => {
  const input = { title: "Gift", note: "", currency: "INR", amount: "300", dueDate: "", upiId: "", payLink: "", names: "" };

  it("friends you can pick leave out anyone you blocked and anyone who blocked you; others stay", async () => {
    const t = await crew("cf");
    expect((await loopinFriends(t.asha.id)).map((f) => f.id).sort()).toEqual([t.ben.id, t.cleo.id].sort());
    await blockAccount(t.asha.id, t.ben.id); // Asha blocked Ben
    expect((await loopinFriends(t.asha.id)).map((f) => f.id)).toEqual([t.cleo.id]);
    expect((await loopinFriends(t.ben.id)).map((f) => f.id)).toEqual([t.cleo.id]); // and Ben can't pick Asha
    expect((await loopinFriends(t.cleo.id)).map((f) => f.id).sort()).toEqual([t.asha.id, t.ben.id].sort());
  });

  it("a new collection puts only the unblocked friend on the list and tells only them", async () => {
    const t = await crew("cc");
    await blockAccount(t.asha.id, t.ben.id);
    const r = await createCollection({ id: t.asha.id, name: "Asha" }, { ...input, friends: [t.ben.id, t.cleo.id] });
    if (!r.ok) throw new Error(r.error);
    const entries = await db.collectionEntry.findMany({ where: { collection: { code: r.code } } });
    expect(entries.map((e) => e.accountId)).toEqual([t.cleo.id]);
    expect(r.notify[0].accountIds).toEqual([t.cleo.id]);
    expect(r.notify[0].fromAccountId).toBe(t.asha.id);
  });

  it("the other way round: the blocked person can't add the blocker to a collection either", async () => {
    const t = await crew("cb");
    await blockAccount(t.asha.id, t.ben.id);
    const r = await createCollection({ id: t.ben.id, name: "Ben" }, { ...input, friends: [t.asha.id] });
    if (!r.ok) throw new Error(r.error);
    expect(await db.collectionEntry.count({ where: { collection: { code: r.code }, accountId: t.asha.id } })).toBe(0);
    expect(r.notify).toEqual([]);
  });

  it("'add' later skips a blocked friend; a reminder and an 'added you' note carry the sender, so they are dropped", async () => {
    const t = await crew("ca");
    const r = await createCollection({ id: t.asha.id, name: "Asha" }, { ...input, friends: [t.cleo.id] });
    if (!r.ok) throw new Error(r.error);
    await blockAccount(t.asha.id, t.ben.id);
    const add = await organiserAction(r.code, t.asha.id, { kind: "add", friends: [t.ben.id] });
    expect(add.ok).toBe(false); // nothing new to add: Ben is not on offer
    expect(await db.collectionEntry.count({ where: { collection: { code: r.code }, accountId: t.ben.id } })).toBe(0);
    // A new name added alongside the blocked friend: the name lands, Ben is not linked or told.
    const mixed = await organiserAction(r.code, t.asha.id, { kind: "add", names: "Zed", friends: [t.ben.id] });
    expect(mixed).toEqual({ ok: true });
    expect(await db.collectionEntry.count({ where: { collection: { code: r.code }, name: "Zed", accountId: "" } })).toBe(1);
    // Ben was already on Asha's list (added before she blocked him): her reminder carries her as the sender and is dropped.
    const hers = await createCollection({ id: t.asha.id, name: "Asha" }, { ...input, friends: [t.cleo.id] });
    if (!hers.ok) throw new Error(hers.error);
    await db.collectionEntry.create({ data: { collectionId: (await db.collection.findUniqueOrThrow({ where: { code: hers.code } })).id, name: "Ben", status: "due", accountId: t.ben.id } });
    const reminder = await organiserAction(hers.code, t.asha.id, { kind: "nudge", entryId: (await db.collectionEntry.findFirstOrThrow({ where: { accountId: t.ben.id, collection: { code: hers.code } } })).id });
    if (!reminder.ok || !reminder.notify) throw new Error("expected a reminder");
    expect(reminder.notify[0].fromAccountId).toBe(t.asha.id);
    await deliverNotes(reminder.notify);
    expect(await db.accountNote.count({ where: { accountId: t.ben.id } })).toBe(0);
    const cleoEntry = await db.collectionEntry.findFirstOrThrow({ where: { accountId: t.cleo.id, collection: { code: hers.code } } });
    const ok = await organiserAction(hers.code, t.asha.id, { kind: "nudge", entryId: cleoEntry.id });
    if (!ok.ok || !ok.notify) throw new Error("expected a reminder");
    await deliverNotes(ok.notify);
    expect(await db.accountNote.count({ where: { accountId: t.cleo.id, kind: "collect_reminder" } })).toBe(1);
  });
});

describe("blocking: group invites", () => {
  it("the invitee still lands in the group, but if they blocked the inviter they get no email and no alert; another invitee gets both", async () => {
    const t = await crew("gi");
    const dev = await account(`Dev${stamp.slice(-4)}`);
    const eve = await account(`Eve${stamp.slice(-4)}`);
    await blockAccount(dev.id, t.asha.id); // Dev blocked Asha
    const toDev = await addRegistered(t.g.id, t.ma.id, dev.id, "https://loopin.test");
    const toEve = await addRegistered(t.g.id, t.ma.id, eve.id, "https://loopin.test");
    if (!toDev.ok || !toEve.ok) throw new Error("expected both to be added");
    // Group money keeps working: both are in the group as names (they are linked to their accounts when they tap Join), with an invitation each.
    expect(await db.member.count({ where: { groupId: t.g.id, id: { in: [toDev.memberId, toEve.memberId] }, leftAt: null, removedAt: null } })).toBe(2);
    expect(await db.member.count({ where: { groupId: t.g.id } })).toBe(5);
    expect(await db.invite.count({ where: { groupId: t.g.id, email: { in: [dev.email, eve.email] }, memberId: { in: [toDev.memberId, toEve.memberId] } } })).toBe(2);
    expect(await db.outbox.count({ where: { to: dev.email } })).toBe(0);
    expect(await db.accountNote.count({ where: { accountId: dev.id } })).toBe(0);
    expect(await db.outbox.count({ where: { to: eve.email } })).toBe(1);
    expect(await db.accountNote.count({ where: { accountId: eve.id, kind: "group_invite" } })).toBe(1);
  });
});

describe("blocking: group pushes", () => {
  it("Asha's expense pushes to Cleo but not to Ben, who blocked Asha; the activity list and money are unchanged", async () => {
    const t = await crew("gp");
    const epB = goodEndpoint(`b-${stamp}-gp`);
    const epC = goodEndpoint(`c-${stamp}-gp`);
    for (const [memberId, endpoint] of [[t.mb.id, epB], [t.mc.id, epC]]) await db.pushSubscription.create({ data: { memberId, endpoint, p256dh: GOOD_P256DH, auth: GOOD_AUTH } });
    await blockAccount(t.ben.id, t.asha.id);
    const ev = await db.groupEvent.create({ data: { groupId: t.g.id, actorId: t.ma.id, kind: "expense_added", text: "added Lunch (₹300)" } });
    await sendEventPush(ev.id);
    expect(new Set(push.send.mock.calls.map((c) => c[0].endpoint))).toEqual(new Set([epC]));
    expect(await db.groupEvent.count({ where: { groupId: t.g.id } })).toBe(1);
    expect(await db.expense.count({ where: { groupId: t.g.id, deletedAt: null } })).toBe(1);
  });
  it("a person-to-person push (a reaction, 'I've paid', going shopping) from Asha skips Ben, who blocked her, and still reaches Cleo", async () => {
    const t = await crew("p2p");
    const epB = goodEndpoint(`b-${stamp}-p2p`);
    const epC = goodEndpoint(`c-${stamp}-p2p`);
    for (const [memberId, endpoint] of [[t.mb.id, epB], [t.mc.id, epC]]) await db.pushSubscription.create({ data: { memberId, endpoint, p256dh: GOOD_P256DH, auth: GOOD_AUTH } });
    await blockAccount(t.ben.id, t.asha.id);
    push.send.mockClear();
    await sendPushTo([t.mb.id, t.mc.id], { title: "t", body: "b", url: "/", tag: "pp" }, "expenses.reactions", t.ma.id);
    expect(new Set(push.send.mock.calls.map((c) => c[0].endpoint))).toEqual(new Set([epC]));
    // Without a sender (a reminder Loopin sends itself), both are reached.
    push.send.mockClear();
    await sendPushTo([t.mb.id, t.mc.id], { title: "t", body: "b", url: "/", tag: "pp2" }, "expenses.reactions");
    expect(new Set(push.send.mock.calls.map((c) => c[0].endpoint))).toEqual(new Set([epB, epC]));
  });
});

describe("blocking: postcards sent before the block", () => {
  it("Ben no longer sees Asha's old postcard in his new-card count or on its photo route; the same when the recipient is the blocker", async () => {
    const t = await crew("po");
    const photo = await db.postcardPhoto.create({ data: { data: Buffer.from([1, 2, 3]), type: "image/webp" } });
    const card = await db.postcard.create({ data: { fromId: t.asha.id, toId: t.ben.id, front: "own", photoId: photo.id, message: "hi" } });
    const get = async (who: { id: string }) => {
      await signedInAs(who);
      return photoRoute.GET(new Request("https://loopin.test/x"), { params: Promise.resolve({ id: photo.id }) });
    };
    // Before the block: the recipient and the sender both see it.
    expect((await get(t.ben)).status).toBe(200);
    expect(await unreadPostcards(t.ben.id)).toBe(1);
    await blockAccount(t.asha.id, t.ben.id); // Asha blocks Ben, after sending
    expect(await unreadPostcards(t.ben.id)).toBe(0);
    expect((await get(t.ben)).status).toBe(404);
    expect((await get(t.asha)).status).toBe(200); // the sender keeps her own sent card
    // And the other direction: Cleo blocks Asha; a card Asha sent Cleo is hidden from Cleo as well.
    const toCleo = await db.postcard.create({ data: { fromId: t.asha.id, toId: t.cleo.id, front: "print:beach", message: "yo" } });
    expect(await unreadPostcards(t.cleo.id)).toBe(1);
    await blockAccount(t.cleo.id, t.asha.id);
    expect(await unreadPostcards(t.cleo.id)).toBe(0);
    expect(await isBlockedEitherWay(t.cleo.id, toCleo.fromId)).toBe(true);
    expect(await isBlockedEitherWay(t.ben.id, card.fromId)).toBe(true);
    await unblockAccount(t.asha.id, t.ben.id);
    expect((await get(t.ben)).status).toBe(200);
  });
});

// ---------- M3: support messages are kept ----------
describe("support messages", () => {
  const send = (message: string, extra: Record<string, string> = {}) => redirected(() => contactSupportAction(form({ message, ...extra })));

  it("operator email not set up: the message is still saved, and the person still sees the thanks", async () => {
    const t = await crew("s1");
    await signedInAs(t.asha);
    const note = `please help ${stamp} s1`;
    expect(await send(note, { reply: "asha@example.test" })).toBe("/support?sent=1");
    const rows = await db.report.findMany({ where: { note } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "support", reporterId: t.asha.id, contact: "asha@example.test", status: "open", reason: "support" });
  });

  it("someone who is not signed in can send 5 an hour from one address; the 6th is turned away politely and not saved", async () => {
    state.ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}-${stamp}`;
    rateKeys.push(`support:${state.ip}`);
    for (let i = 0; i < 5; i++) expect(await send(`anon ${i} ${stamp}`)).toBe("/support?sent=1");
    expect(await send(`anon 6 ${stamp}`)).toContain("error=");
    const rows = await db.report.findMany({ where: { note: { startsWith: "anon " }, AND: { note: { contains: stamp } } } });
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.reporterId === "" && r.kind === "support")).toBe(true);
  });

  it("a message that is too short is refused and not saved", async () => {
    const before = await db.report.count({ where: { kind: "support" } });
    expect(await send("hi")).toContain("error=");
    expect(await db.report.count({ where: { kind: "support" } })).toBe(before);
  });

  it("only the owner can read support messages; signed-out people and other accounts get 'not found'", async () => {
    const t = await crew("s4");
    const note = `owner only ${stamp} s4`;
    await saveSupportMessage({ reporterId: t.asha.id, message: note });
    process.env.ADMIN_EMAIL = "boss-s4@example.test";
    await expect(loadReportsForOwner(null)).rejects.toThrow();
    await expect(loadReportsForOwner({ email: t.asha.email })).rejects.toThrow(); // even the person who wrote it
    const rows = await loadReportsForOwner({ email: "Boss-S4@Example.test" });
    expect(rows.support.find((r) => r.note === note)).toMatchObject({ kind: "support", reporterId: t.asha.id });
    expect(rows.reports.some((r) => r.note === note)).toBe(false); // support messages and reports are separate lists
    expect(rows.reports.every((r) => r.kind !== "support")).toBe(true);
  });

  it("a support message can't be filed through the report form", async () => {
    const t = await crew("s5");
    await signedInAs(t.asha);
    const url = await redirected(() => reportAction(form({ kind: "support", id: t.ben.id, reason: "spam", back: "/account" })));
    expect(url).toContain("error=");
  });
});


// ---------- Re-check round ----------
describe("blocking: invitations from someone you blocked", () => {
  it("a blocked inviter's Join card is gone from the list Home and Alerts both use; unblocking brings it back", async () => {
    const t = await crew("iv");
    const dev = await account(`Dv${stamp.slice(-4)}`);
    const n = await db.member.create({ data: { groupId: t.g.id, name: "Dev", addedBy: t.ma.id } });
    await db.invite.create({ data: { groupId: t.g.id, email: dev.email, invitedById: t.ma.id, token: `tk-${stamp}-iv`, memberId: n.id } });
    expect((await loadInvitations(dev)).map((i) => i.groupId)).toEqual([t.g.id]);
    await blockAccount(dev.id, t.asha.id); // Dev blocked Asha, who invited him
    expect(await loadInvitations(dev)).toEqual([]);
    // The name is still in the group, so the group's money is unchanged.
    expect(await db.member.count({ where: { id: n.id, groupId: t.g.id } })).toBe(1);
    await unblockAccount(dev.id, t.asha.id);
    expect(await loadInvitations(dev)).toHaveLength(1);
  });

  it("a card from someone else is not affected by blocking the inviter; and the older kind (added straight in) is hidden too", async () => {
    const t = await crew("iw");
    const dev = await account(`Dw${stamp.slice(-4)}`);
    await db.member.create({ data: { groupId: t.g.id, name: "Dev", accountId: dev.id, addedBy: t.mc.id, seenAt: null } });
    await blockAccount(dev.id, t.asha.id); // not Cleo, who added him
    expect(await loadInvitations(dev)).toHaveLength(1);
    await blockAccount(dev.id, t.cleo.id);
    expect(await loadInvitations(dev)).toEqual([]);
  });

  it("invite-by-email to someone who blocked the inviter sends nothing (same reply); another address gets the email", async () => {
    const t = await crew("ie");
    const dev = await account(`De${stamp.slice(-4)}`);
    const n1 = await db.member.create({ data: { groupId: t.g.id, name: "Name One" } });
    const n2 = await db.member.create({ data: { groupId: t.g.id, name: "Name Two" } });
    await blockAccount(dev.id, t.asha.id);
    const r1 = await inviteToClaim(t.g.id, t.ma.id, n1.id, dev.email, "https://loopin.test");
    expect(r1).toEqual({ ok: true, email: dev.email });
    expect(await db.outbox.count({ where: { to: dev.email } })).toBe(0);
    // The per-address daily limit is counted on the blocked path too (10 a day), so the 11th gets the same answer a real send would.
    rateKeys.push(`mail:to:${dev.email.toLowerCase()}`);
    for (let i = 0; i < 9; i++) expect(await inviteToClaim(t.g.id, t.ma.id, n1.id, dev.email, "https://loopin.test")).toEqual({ ok: true, email: dev.email });
    expect(await inviteToClaim(t.g.id, t.ma.id, n1.id, dev.email, "https://loopin.test")).toMatchObject({ ok: false });
    const other = `rb-other-${stamp}-ie@example.test`;
    const r2 = await inviteToClaim(t.g.id, t.ma.id, n2.id, other, "https://loopin.test");
    expect(r2.ok).toBe(true);
    expect(await db.outbox.count({ where: { to: other } })).toBe(1);
  });
});

describe("blocking: collection ticks and wax seals", () => {
  const input = { title: "Gift", note: "", currency: "INR", amount: "300", dueDate: "", upiId: "", payLink: "", names: "" };
  const runAfter = async () => {
    for (const fn of state.pending.splice(0)) await fn();
  };

  it("when a blocked person ticks 'I've paid', the organiser who blocked them is not told; Cleo's tick is told", async () => {
    const t = await crew("ct");
    const made = await createCollection({ id: t.asha.id, name: "Asha" }, { ...input, friends: [t.ben.id, t.cleo.id] });
    if (!made.ok) throw new Error(made.error);
    await blockAccount(t.asha.id, t.ben.id); // after Ben was put on the list
    const entryOf = (accountId: string) => db.collectionEntry.findFirstOrThrow({ where: { collection: { code: made.code }, accountId } });
    for (const who of [t.ben, t.cleo]) {
      await signedInAs(who);
      const entryId = (await entryOf(who.id)).id;
      await redirected(() => markPaidAction(form({ code: made.code, entryId })));
      await runAfter();
    }
    expect(await db.accountNote.count({ where: { accountId: t.asha.id, kind: "collect_ticked" } })).toBe(1);
    expect((await db.accountNote.findFirstOrThrow({ where: { accountId: t.asha.id, kind: "collect_ticked" } })).body).toContain("Cleo");
    // The tick itself still counts.
    expect((await entryOf(t.ben.id)).status).toBe("paid");
  });

  it("the note is about whoever ticked, not whoever owns the entry: Ben (blocked) ticks Cleo's name from the shared link, Asha is not told", async () => {
    const t = await crew("c2");
    const made = await createCollection({ id: t.asha.id, name: "Asha" }, { ...input, friends: [t.cleo.id] });
    if (!made.ok) throw new Error(made.error);
    await blockAccount(t.asha.id, t.ben.id);
    const entry = await db.collectionEntry.findFirstOrThrow({ where: { collection: { code: made.code }, accountId: t.cleo.id } });
    await signedInAs(t.ben);
    await redirected(() => markPaidAction(form({ code: made.code, entryId: entry.id })));
    for (const fn of state.pending.splice(0)) await fn();
    expect(await db.accountNote.count({ where: { accountId: t.asha.id, kind: "collect_ticked" } })).toBe(0);
  });

  it("a signed-out tick still tells the organiser", async () => {
    const t = await crew("c3");
    const made = await createCollection({ id: t.asha.id, name: "Asha" }, { ...input, friends: [t.cleo.id] });
    if (!made.ok) throw new Error(made.error);
    const entry = await db.collectionEntry.findFirstOrThrow({ where: { collection: { code: made.code }, accountId: t.cleo.id } });
    await redirected(() => markPaidAction(form({ code: made.code, entryId: entry.id })));
    for (const fn of state.pending.splice(0)) await fn();
    expect(await db.accountNote.count({ where: { accountId: t.asha.id, kind: "collect_ticked" } })).toBe(1);
  });

  it("a card can't be sealed once either person has blocked the other; before that it can", async () => {
    const t = await crew("sl");
    const seal = REACTIONS[0].id;
    const card = (fromId: string, toId: string) => db.postcard.create({ data: { fromId, toId, front: "print:beach", message: "hi" } });
    const sealIt = async (c: { id: string }, who: { id: string }) => {
      await signedInAs(who);
      await redirected(() => reactPostcardAction(form({ id: c.id, reaction: seal })));
      return (await db.postcard.findUniqueOrThrow({ where: { id: c.id } })).reaction;
    };
    const fine = await card(t.asha.id, t.ben.id);
    expect(await sealIt(fine, t.ben)).toBe(seal);
    // The sender blocked the recipient.
    const one = await card(t.asha.id, t.cleo.id);
    await blockAccount(t.asha.id, t.cleo.id);
    expect(await sealIt(one, t.cleo)).toBeFalsy();
    // The recipient blocked the sender.
    const two = await card(t.cleo.id, t.ben.id);
    await blockAccount(t.ben.id, t.cleo.id);
    expect(await sealIt(two, t.ben)).toBeFalsy();
    expect(await db.accountNote.count({ where: { accountId: t.cleo.id, title: { contains: "sealed your postcard" } } })).toBe(0);
  });

  it("the postcard page's own check: the recipient loses a card from someone blocked either way, the sender keeps theirs, strangers never see it", async () => {
    const t = await crew("vp");
    const card = await db.postcard.create({ data: { fromId: t.asha.id, toId: t.ben.id, front: "print:beach", message: "hi" } });
    expect(await canViewPostcard(t.ben.id, card)).toBe(true);
    expect(await canViewPostcard(t.cleo.id, card)).toBe(false);
    await blockAccount(t.asha.id, t.ben.id);
    expect(await canViewPostcard(t.ben.id, card)).toBe(false);
    expect(await canViewPostcard(t.asha.id, card)).toBe(true);
    await unblockAccount(t.asha.id, t.ben.id);
    await blockAccount(t.ben.id, t.asha.id);
    expect(await canViewPostcard(t.ben.id, card)).toBe(false);
  });
});

describe("support messages and account deletion / download", () => {
  it("deleting an account removes the support messages it sent and keeps the reports (made by it and about it)", async () => {
    const t = await crew("dm");
    await saveSupportMessage({ reporterId: t.ben.id, message: `help ${stamp} dm` });
    await saveSupportMessage({ reporterId: t.asha.id, message: `other person ${stamp} dm` });
    await db.report.create({ data: { reporterId: t.ben.id, kind: "person", targetId: t.asha.id, targetAccountId: t.asha.id, reason: "spam", note: `by ben ${stamp}` } });
    await db.report.create({ data: { reporterId: t.cleo.id, kind: "person", targetId: t.ben.id, targetAccountId: t.ben.id, reason: "spam", note: `about ben ${stamp}` } });
    await deleteAccount(t.ben.id);
    expect(await db.report.count({ where: { kind: "support", reporterId: t.ben.id } })).toBe(0);
    expect(await db.report.count({ where: { kind: "support", reporterId: t.asha.id } })).toBe(1);
    expect(await db.report.count({ where: { kind: "person", note: { in: [`by ben ${stamp}`, `about ben ${stamp}`] } } })).toBe(2);
  });

  it("'Download all my data' includes my own support messages (and the reply email) and nobody else's", async () => {
    const t = await crew("dx");
    await saveSupportMessage({ reporterId: t.asha.id, message: `my words ${stamp} dx`, contact: "asha-reply@example.com" });
    await saveSupportMessage({ reporterId: t.ben.id, message: `his words ${stamp} dx` });
    await signedInAs(t.asha);
    const res = await myData.GET();
    const csv = await res.text();
    expect(res.status).toBe(200);
    expect(csv).toContain("Your messages to support");
    expect(csv).toContain(`my words ${stamp} dx`);
    expect(csv).toContain("asha-reply@example.com");
    expect(csv).not.toContain(`his words ${stamp} dx`);
  });

  it("someone with no support messages gets no empty section", async () => {
    const t = await crew("dy");
    await signedInAs(t.cleo);
    expect(await (await myData.GET()).text()).not.toContain("Your messages to support");
  });
});
