import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// POL-03: report and block. Blocking stops postcards, passports, nudges and their pushes, both ways for passports;
// it never touches group expenses or balances. Reports are saved and the operator is emailed (kept in the test outbox).

const state = vi.hoisted(() => ({ session: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.session ? { value: state.session } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
// A server action ends by redirecting; here the redirect is caught and its address handed back.
vi.mock("@/lib/fresh-redirect", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { blockAccount, unblockAccount, blockedByMe, blockedEitherWay, unreadPostcards } = await import("@/lib/blocks");
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

beforeEach(() => {
  state.session = "";
  delete process.env.ADMIN_EMAIL;
});
afterAll(async () => {
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
    expect(mail[0].text).toContain("abusive");
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
