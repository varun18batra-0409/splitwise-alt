import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Inviting a name only you can see ("Invite Rohan by email"), accepting, and the doors that must stay shut.
// Each test uses its own accounts, so they can't touch each other. Mail is kept in the Outbox table (MAIL_OUTBOX=1), never sent.
// Hand-worked: Asha paid 120000 for her and Rohan, so Rohan owes 60000: that must still be -60000 for Rohan after he joins.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { ensureAccountPair, ensureLocalPair, inviteDirectPerson } = await import("@/lib/direct-db");
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

  it("16. someone you already share a pair with: the same reply, no invitation, no mail", async () => {
    const a = await made("ja", "Asha");
    const d = await made("jd", "Dee");
    await mkSharedGroup("jd", [{ id: a.id, name: "Asha" }, { id: d.id, name: "Dee" }]);
    const real = await ensureAccountPair({ id: a.id }, d.id, { currency: "INR", myName: "Asha" });
    const local = await ensureLocalPair({ id: a.id }, "Dee (old)", { currency: "INR", myName: "Asha" });
    if (!real.ok || !local.ok) throw new Error("refused");
    const r = await inviteDirectPerson(local.groupId, local.myId, d.email, origin);
    expect(r.ok).toBe(true);
    expect(await db.invite.count({ where: { groupId: local.groupId } })).toBe(0);
    expect(await mailTo(d.email)).toBe(0);
  });

  it("inviting yourself looks the same and writes nothing", async () => {
    const a = await made("sa", "Asha");
    const local = await ensureLocalPair({ id: a.id }, "Sam", { currency: "INR", myName: "Asha" });
    if (!local.ok) throw new Error("refused");
    expect((await inviteDirectPerson(local.groupId, local.myId, a.email, origin)).ok).toBe(true);
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
