import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Inviting a name only you can see ("Invite Rohan by email"), accepting, and the doors that must stay shut.
// Each test uses its own accounts, so they can't touch each other. Mail is kept in the Outbox table (MAIL_OUTBOX=1), never sent.
// Hand-worked: Asha paid 120000 for her and Rohan, so Rohan owes 60000: that must still be -60000 for Rohan after he joins.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { ensureAccountPair, ensureLocalPair, inviteDirectPerson, inviteGate } = await import("@/lib/direct-db");
const { inviteMailOk, INVITE_EMAILS_PER_DAY } = await import("@/lib/invites");
const { accountPairKey, localPairKey } = await import("@/lib/direct");
const { acceptInvitation } = await import("@/lib/invitations");
const { joinNew, joinExisting, loadByCode, newInviteLink } = await import("@/lib/join");
const { addRegistered, inviteByEmail, inviteToClaim, knownPeople, searchPeople } = await import("@/lib/invites");
const { loadGroup } = await import("@/lib/group-data");
const { mkAccount, mkSharedGroup, addExpense, wipe } = await import("./helpers/direct-fixtures");

const accounts: string[] = [];
const origin = "https://example.test";
const made = async (tag: string, name: string) => {
  const a = await mkAccount(tag, name);
  accounts.push(a.id);
  return a;
};
const mailTo = (email: string) => db.outbox.count({ where: { to: email } });

beforeAll(() => {
  process.env.MAIL_OUTBOX = "1";
});
afterAll(async () => {
  await wipe(accounts);
});

describe("inviting and accepting", () => {
  it("14 and 15. one invite and one mail; accepting links the name to the account, keeps the money, and the key becomes the account key", async () => {
    const a = await made("ia", "Asha");
    const b = await made("ib", "Rohan");
    const pair = await ensureLocalPair({ id: a.id }, "Rohan", { currency: "INR", myName: "Asha" });
    if (!pair.ok) throw new Error("refused");
    await addExpense(pair.groupId, { paidBy: pair.myId, amount: 120000, shares: { [pair.myId]: 60000, [pair.otherId]: 60000 } });

    const r = await inviteDirectPerson(pair.groupId, pair.myId, b.email.toUpperCase(), origin);
    expect(r.ok).toBe(true);
    const invites = await db.invite.findMany({ where: { groupId: pair.groupId } });
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ email: b.email, memberId: pair.otherId, invitedById: pair.myId });
    expect(await mailTo(b.email)).toBe(1);
    const mailRow = await db.outbox.findFirst({ where: { to: b.email } });
    expect(mailRow!.subject).toBe("Asha shared expenses with you on Loopin");
    expect(mailRow!.text).toContain("/signin?");
    expect(mailRow!.text).not.toContain("/join"); // there is no join path into a pair

    const again = await inviteDirectPerson(pair.groupId, pair.myId, b.email, origin);
    expect(again.ok).toBe(true);
    expect(await db.invite.count({ where: { groupId: pair.groupId } })).toBe(1); // the same invitation, not a second

    const done = await acceptInvitation(b, invites[0].token);
    expect(done.ok).toBe(true);
    const g = await db.group.findUnique({ where: { id: pair.groupId }, include: { members: true } });
    expect(g!.pairKey).toBe(accountPairKey(a.id, b.id));
    const row = g!.members.find((m) => m.id === pair.otherId)!;
    expect(row.accountId).toBe(b.id);
    expect(g!.members).toHaveLength(2);
    const net = (await loadGroup(pair.groupId))!.net;
    expect(net[pair.otherId]).toBe(-60000);
    expect(net[pair.myId]).toBe(60000);
    expect((await db.invite.findUnique({ where: { id: invites[0].id } }))!.acceptedAt).not.toBeNull();
  });

  it("16. someone you already share a pair with: refused in plain words, no invitation, no mail, no note; a stranger still sends", async () => {
    const a = await made("ja", "Asha");
    const d = await made("jd", "Dee");
    const s2 = await made("js", "Stranger");
    await mkSharedGroup("jd", [{ id: a.id, name: "Asha" }, { id: d.id, name: "Dee" }]);
    const real = await ensureAccountPair({ id: a.id }, d.id, { currency: "INR", myName: "Asha" });
    const local = await ensureLocalPair({ id: a.id }, "Dee (old)", { currency: "INR", myName: "Asha" });
    if (!real.ok || !local.ok) throw new Error("refused");
    // The pair has history (Asha paid 1000 for both), so the plain refusal applies.
    await addExpense(real.groupId, { paidBy: real.myId, amount: 100000, shares: { [real.myId]: 50000, [real.otherId]: 50000 } });
    const r = await inviteDirectPerson(local.groupId, local.myId, d.email, origin);
    expect(r).toEqual({ ok: false, error: "You already share expenses with the person who has this email. Open them from Settle up or the + button." });
    expect(await db.invite.count({ where: { groupId: local.groupId } })).toBe(0);
    expect(await mailTo(d.email)).toBe(0);
    expect(await db.requestKey.count({ where: { key: { startsWith: "direct-decoy:" } } })).toBe(0);
    // Someone on Loopin you share no pair with: a normal send (one invitation, one mail).
    expect((await inviteDirectPerson(local.groupId, local.myId, s2.email, origin)).ok).toBe(true);
    expect(await db.invite.count({ where: { groupId: local.groupId } })).toBe(1);
    expect(await mailTo(s2.email)).toBe(1);
  });

  it("inviting yourself says so plainly (that tells nobody anything) and writes nothing", async () => {
    const a = await made("sa", "Asha");
    const local = await ensureLocalPair({ id: a.id }, "Sam", { currency: "INR", myName: "Asha" });
    if (!local.ok) throw new Error("refused");
    const own = await inviteDirectPerson(local.groupId, local.myId, a.email, origin);
    expect(own).toEqual({ ok: false, error: "That’s your own email. Type theirs." });
    expect(await db.invite.count({ where: { groupId: local.groupId } })).toBe(0);
    expect(await mailTo(a.email)).toBe(0);
  });

  it("17. the race: invited, then a real pair appears, then they accept: refused, nothing merged, the invitation closed", async () => {
    const a = await made("ra", "Asha");
    const e = await made("re", "Rae");
    const local = await ensureLocalPair({ id: a.id }, "Rae", { currency: "INR", myName: "Asha" });
    if (!local.ok) throw new Error("refused");
    await addExpense(local.groupId, { paidBy: local.myId, amount: 100000, shares: { [local.myId]: 50000, [local.otherId]: 50000 } });
    expect((await inviteDirectPerson(local.groupId, local.myId, e.email, origin)).ok).toBe(true);
    const inv = (await db.invite.findFirst({ where: { groupId: local.groupId } }))!;

    await mkSharedGroup("re", [{ id: a.id, name: "Asha" }, { id: e.id, name: "Rae" }]);
    const real = await ensureAccountPair({ id: a.id }, e.id, { currency: "INR", myName: "Asha" });
    if (!real.ok) throw new Error("refused");

    const out = await acceptInvitation(e, inv.token);
    expect(out.ok).toBe(false);
    const g = await db.group.findUnique({ where: { id: local.groupId }, include: { members: true } });
    expect(g!.pairKey).toBe(localPairKey(a.id, "Rae")); // still the name only Asha sees
    expect(g!.members.find((m) => m.id === local.otherId)!.accountId).toBeNull();
    const after = await db.invite.findUnique({ where: { id: inv.id } });
    expect(after!.declinedAt).not.toBeNull();
    expect(after!.acceptedAt).toBeNull();
    expect((await db.group.findUnique({ where: { id: real.groupId } }))!.pairKey).toBe(accountPairKey(a.id, e.id));
  });
});

// The refusal must not become a way to find out whether an address belongs to someone you share a pair with.
describe("invite attempts leak nothing", () => {
  const used = (_email: string) => `You've sent ${INVITE_EMAILS_PER_DAY} invite emails today. Try again tomorrow.`;

  it("1. allowance used up: a pair partner's email and a random email get the identical answer, and nothing is written", async () => {
    const a = await made("la", "Asha");
    const d = await made("ld", "Dee");
    await mkSharedGroup("ld", [{ id: a.id, name: "Asha" }, { id: d.id, name: "Dee" }]);
    const real = await ensureAccountPair({ id: a.id }, d.id, { currency: "INR", myName: "Asha" });
    const local = await ensureLocalPair({ id: a.id }, "Dee (old)", { currency: "INR", myName: "Asha" });
    if (!real.ok || !local.ok) throw new Error("refused");
    await addExpense(real.groupId, { paidBy: real.myId, amount: 100000, shares: { [real.myId]: 50000, [real.otherId]: 50000 } });
    // Burn the day's 20 (hand count: 20 allowed, the 21st is refused).
    for (let i = 0; i < INVITE_EMAILS_PER_DAY; i++) expect(await inviteMailOk({ id: "", accountId: a.id })).toBe(true);

    const partner = await inviteDirectPerson(local.groupId, local.myId, d.email, origin);
    const random = await inviteDirectPerson(local.groupId, local.myId, `nobody-${Date.now()}@example.org`, origin);
    expect(partner).toEqual({ ok: false, error: used(d.email) });
    expect(random).toEqual(partner);
    expect(await db.invite.count({ where: { groupId: local.groupId } })).toBe(0);
    expect(await mailTo(d.email)).toBe(0);
    // Only your own email may still answer differently (it says nothing about anyone else).
    expect(await inviteDirectPerson(local.groupId, local.myId, a.email, origin)).toEqual({ ok: false, error: "That’s your own email. Type theirs." });
  });

  it("2. every attempt with a valid email is charged, a pair partner's included; your own email is free", async () => {
    const a = await made("ca", "Asha");
    const d = await made("cd", "Dee");
    await mkSharedGroup("cd", [{ id: a.id, name: "Asha" }, { id: d.id, name: "Dee" }]);
    const real = await ensureAccountPair({ id: a.id }, d.id, { currency: "INR", myName: "Asha" });
    const local = await ensureLocalPair({ id: a.id }, "Dee (old)", { currency: "INR", myName: "Asha" });
    if (!real.ok || !local.ok) throw new Error("refused");
    await addExpense(real.groupId, { paidBy: real.myId, amount: 100000, shares: { [real.myId]: 50000, [real.otherId]: 50000 } });
    const key = `invite-mail:${a.id}`;
    const count = async () => (await db.rateLimit.findUnique({ where: { key } }))?.count ?? 0;
    expect(await count()).toBe(0);
    await inviteDirectPerson(local.groupId, local.myId, a.email, origin); // own email: free
    expect(await count()).toBe(0);
    const r = await inviteDirectPerson(local.groupId, local.myId, d.email, origin); // refused, but still charged: 1
    expect(r.ok).toBe(false);
    expect(await count()).toBe(1);
    await inviteDirectPerson(local.groupId, local.myId, `x-${Date.now()}@example.org`, origin); // a normal send: 2
    expect(await count()).toBe(2);
  });

  it("2b. a per-account hourly limit (20) gives every email the same answer once used", async () => {
    const a = await made("ha", "Asha");
    const local = await ensureLocalPair({ id: a.id }, "Sam", { currency: "INR", myName: "Asha" });
    if (!local.ok) throw new Error("refused");
    for (let i = 0; i < 20; i++) expect(await inviteGate(a, `h${i}-${Date.now()}@example.org`)).toBeNull();
    const first = await inviteGate(a, "one@example.org");
    expect(first).toBe("Too many invites just now. Try again a little later.");
    expect(await inviteGate(a, "two@example.org")).toBe(first);
  });

  it("3. a matching pair with NO history is treated like any account: the invitation goes out normally, and accepting it is refused cleanly", async () => {
    const a = await made("ea", "Asha");
    const d = await made("ed", "Dee");
    await mkSharedGroup("ed", [{ id: a.id, name: "Asha" }, { id: d.id, name: "Dee" }]);
    const real = await ensureAccountPair({ id: a.id }, d.id, { currency: "INR", myName: "Asha" }); // empty: no expense, no payment
    const local = await ensureLocalPair({ id: a.id }, "Dee (old)", { currency: "INR", myName: "Asha" });
    if (!real.ok || !local.ok) throw new Error("refused");
    const r = await inviteDirectPerson(local.groupId, local.myId, d.email, origin);
    expect(r).toEqual({ ok: true, email: d.email }); // "Invitation sent to ..." exactly as for anyone
    const inv = (await db.invite.findFirst({ where: { groupId: local.groupId } }))!;
    expect(inv.email).toBe(d.email);
    const out = await acceptInvitation(d, inv.token);
    expect(out.ok).toBe(false); // the key is taken by the empty pair: nothing merged
    const g = await db.group.findUnique({ where: { id: local.groupId }, include: { members: true } });
    expect(g!.pairKey).toBe(localPairKey(a.id, "Dee (old)"));
    expect(g!.members.find((m) => m.id === local.otherId)!.accountId).toBeNull();
    expect((await db.group.findUnique({ where: { id: real.groupId } }))!.pairKey).toBe(accountPairKey(a.id, d.id));
  });

  it("4. the picker's email check runs before anything is made, and it writes nothing", async () => {
    const a = await made("pa", "Asha");
    const d = await made("pd", "Dee");
    await mkSharedGroup("pd", [{ id: a.id, name: "Asha" }, { id: d.id, name: "Dee" }]);
    const real = await ensureAccountPair({ id: a.id }, d.id, { currency: "INR", myName: "Asha" });
    if (!real.ok) throw new Error("refused");
    await addExpense(real.groupId, { paidBy: real.myId, amount: 100000, shares: { [real.myId]: 50000, [real.otherId]: 50000 } });
    const groupsBefore = await db.group.count({ where: { members: { some: { accountId: a.id } } } });
    const refused = await inviteGate(a, d.email);
    expect(refused).toBe("You already share expenses with the person who has this email. Open them from Settle up or the + button.");
    expect(await db.group.count({ where: { members: { some: { accountId: a.id } } } })).toBe(groupsBefore);
    expect(await db.invite.count({ where: { email: d.email } })).toBe(0);
    expect(await mailTo(d.email)).toBe(0);
    // The action asks inviteGate before it makes the name-only pair, and keeps what was typed on the screen.
    const src = readFileSync("src/app/direct-actions.ts", "utf8");
    expect(src.indexOf("inviteGate(account")).toBeGreaterThan(-1);
    expect(src.indexOf("inviteGate(account")).toBeLessThan(src.indexOf("ensureLocalPair(account"));
    expect(src).toContain("keep");
  });
});

describe("no way into a pair", () => {
  it("18. a code, a link, adding people and inviting by email all say no, and the pair stays two people", async () => {
    const a = await made("ka", "Asha");
    const b = await made("kb", "Bo");
    const c = await made("kc", "Cy");
    await mkSharedGroup("kab", [{ id: a.id, name: "Asha" }, { id: b.id, name: "Bo" }]);
    await mkSharedGroup("kac", [{ id: a.id, name: "Asha" }, { id: c.id, name: "Cy" }]);
    const p = await ensureAccountPair({ id: a.id }, b.id, { currency: "INR", myName: "Asha" });
    if (!p.ok) throw new Error("refused");
    const code = (await db.group.findUnique({ where: { id: p.groupId }, select: { inviteCode: true } }))!.inviteCode;

    expect(await loadByCode(code)).toBeNull();
    expect(await joinNew(code, { id: c.id, email: c.email, name: "Cy" }, "Cy")).toMatchObject({ ok: false, reason: "gone" });
    expect(await joinExisting(code, { id: c.id, email: c.email, name: "Cy" }, p.otherId)).toMatchObject({ ok: false, reason: "gone" });
    expect((await newInviteLink(p.groupId, p.myId)).ok).toBe(false);
    expect((await addRegistered(p.groupId, p.myId, c.id, origin)).ok).toBe(false);
    const byMail = await inviteByEmail(p.groupId, p.myId, c.email, origin);
    expect(JSON.stringify(byMail)).not.toContain('"ok":true');
    expect((await inviteToClaim(p.groupId, p.myId, p.otherId, c.email, origin)).ok).toBe(false);
    expect(await db.member.count({ where: { groupId: p.groupId } })).toBe(2);
    expect(await db.invite.count({ where: { groupId: p.groupId } })).toBe(0);
  });

  it("a stranger never sees a name only its owner has", async () => {
    const a = await made("ma", "Asha");
    const s = await made("ms", "Stranger");
    const mate = await made("mm", "Mate");
    const shared = await mkSharedGroup("mas", [{ id: s.id, name: "Stranger" }, { id: mate.id, name: "Mate" }]);
    const local = await ensureLocalPair({ id: a.id }, "Zorbatron", { currency: "INR", myName: "Asha" });
    if (!local.ok) throw new Error("refused");
    expect((await knownPeople(s.id)).map((p) => p.name)).not.toContain("Zorbatron");
    const found = await searchPeople({ [shared.id]: shared.memberOf(s.id) }, shared.id, "zorba");
    expect(found).toHaveLength(0);
  });
});
