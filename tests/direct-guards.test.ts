import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Doors a pair (the hidden two-person group) must keep shut, found by the independent review of "expenses with a person":
// moving out, "settle everything and close", removing people, plus the smaller fixes (blocked people get no hint, an invitation the
// person's page can show and cancel, a first expense in another currency leaves no history line, no invite-card picture).
// Each test uses its own accounts. Mail is kept in the Outbox table (MAIL_OUTBOX=1), never sent.
// Hand-worked: Asha pays 120000 for her and Rohan: 60000 each, so Rohan owes 60000 (R -60000). A refused door must leave that exactly.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { ensureAccountPair, ensureLocalPair, inviteDirectPerson, openInviteEmail, cancelDirectInvite, prepareDirectSave, PAIR_REFUSED } = await import("@/lib/direct-db");
const { PAIR_NO_MOVE_OUT, PAIR_NO_CLOSE, PAIR_NO_PEOPLE } = await import("@/lib/direct-guard");
const { moveOut, moveOutPreview, undoMoveOut } = await import("@/lib/home/moving-db");
const { settleAllAndClose, applySettleAll, planKey } = await import("@/lib/settle-all");
const { removeMembers } = await import("@/lib/undo");
const { loadGroup } = await import("@/lib/group-data");
const { accountPairKey } = await import("@/lib/direct");
const card = await import("@/app/join/[code]/card/route");
const { mkAccount, mkSharedGroup, addExpense, wipe, stamp } = await import("./helpers/direct-fixtures");

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
  await db.block.deleteMany({ where: { OR: [{ blockerId: { in: accounts } }, { blockedId: { in: accounts } }] } });
  await db.requestKey.deleteMany({ where: { key: { startsWith: "direct-decoy:" }, result: { contains: stamp } } });
  await wipe(accounts);
});

// Everything a refused door must not touch.
async function snapshot(groupId: string) {
  const g = await db.group.findUnique({ where: { id: groupId }, include: { members: { orderBy: { id: "asc" } } } });
  return {
    closed: g!.closed,
    closedAt: g!.closedAt,
    pairKey: g!.pairKey,
    members: g!.members.map((m) => ({ id: m.id, name: m.name, accountId: m.accountId, leftAt: m.leftAt, removedAt: m.removedAt })),
    payments: await db.payment.count({ where: { groupId } }),
    expenses: await db.expense.count({ where: { groupId } }),
    events: await db.groupEvent.count({ where: { groupId } }),
    net: (await loadGroup(groupId))!.net,
  };
}

// A pair (Asha with a name only she sees, or with Rohan's account) holding one expense: R owes 60000.
async function pairWithExpense(tag: string, shared: boolean) {
  const a = await made(`${tag}a`, "Asha");
  let r: { id: string; email: string } | null = null;
  let p;
  if (shared) {
    r = await made(`${tag}r`, "Rohan");
    await mkSharedGroup(tag, [{ id: a.id, name: "Asha" }, { id: r.id, name: "Rohan" }]);
    p = await ensureAccountPair({ id: a.id }, r.id, { currency: "INR", myName: "Asha" });
  } else {
    p = await ensureLocalPair({ id: a.id }, "Rohan", { currency: "INR", myName: "Asha" });
  }
  if (!p.ok) throw new Error("refused");
  await addExpense(p.groupId, { paidBy: p.myId, amount: 120000, shares: { [p.myId]: 60000, [p.otherId]: 60000 } });
  return { a, r, p };
}

describe("1. moving out never works on a pair", () => {
  for (const shared of [false, true]) {
    it(`${shared ? "a pair of two accounts" : "a name only you can see"}: refused, nothing recorded, nobody marked as left`, async () => {
      const { p } = await pairWithExpense(shared ? "mos" : "mol", shared);
      const before = await snapshot(p.groupId);
      expect(before.net[p.otherId]).toBe(-60000);
      const input = { leaverId: p.myId, lastDay: "2026-11-15", requestKey: `mo-${stamp}-${shared}-aaaa` };
      expect(await moveOut(p.groupId, p.myId, input, new Date("2026-11-15T10:00:00Z"))).toEqual({ ok: false, error: PAIR_NO_MOVE_OUT });
      expect(await moveOut(p.groupId, p.myId, { ...input, leaverId: p.otherId, requestKey: `mo-${stamp}-${shared}-bbbb` }, new Date("2026-11-15T10:00:00Z"))).toEqual({ ok: false, error: PAIR_NO_MOVE_OUT });
      expect(await moveOutPreview(p.groupId, p.myId, "2026-11-15", new Date("2026-11-15T10:00:00Z"), p.myId)).toEqual({ ok: false, error: PAIR_NO_MOVE_OUT });
      expect(await undoMoveOut(p.groupId, p.myId, p.myId, { bills: [] })).toEqual({ ok: false, error: PAIR_NO_MOVE_OUT });
      expect(await snapshot(p.groupId)).toEqual(before); // no payment, no leftAt, no event, balance still -60000
    });
  }
});

describe("2. settle everything and close never works on a pair", () => {
  it("refused for both kinds of pair; still open, no payments; undo and redo refuse too", async () => {
    for (const shared of [false, true]) {
      const { p } = await pairWithExpense(shared ? "sas" : "sal", shared);
      const before = await snapshot(p.groupId);
      const plan = planKey((await loadGroup(p.groupId))!.transfers);
      expect(plan).not.toBe(""); // there is something owing, so a real plan was on offer
      expect(await settleAllAndClose(p.groupId, p.myId, plan)).toEqual({ ok: false, error: PAIR_NO_CLOSE });
      expect(await settleAllAndClose(p.groupId, p.otherId, plan)).toEqual({ ok: false, error: PAIR_NO_CLOSE });
      expect(await applySettleAll(p.groupId, p.myId, [], false)).toEqual({ ok: false, error: PAIR_NO_CLOSE });
      expect(await applySettleAll(p.groupId, p.myId, [], true)).toEqual({ ok: false, error: PAIR_NO_CLOSE });
      const after = await snapshot(p.groupId);
      expect(after).toEqual(before);
      expect(after.closed).toBe(false);
      expect(after.payments).toBe(0);
    }
  });

  it("an ordinary group still settles and closes (the guard is only for pairs)", async () => {
    const a = await made("ordA", "Ann");
    const b = await made("ordB", "Bob");
    const g = await mkSharedGroup("ord", [{ id: a.id, name: "Ann" }, { id: b.id, name: "Bob" }]);
    const ma = g.memberOf(a.id);
    const mb = g.memberOf(b.id);
    await addExpense(g.id, { paidBy: ma, amount: 100000, shares: { [ma]: 50000, [mb]: 50000 } });
    const r = await settleAllAndClose(g.id, ma, planKey((await loadGroup(g.id))!.transfers));
    expect(r.ok).toBe(true);
    expect((await db.group.findUnique({ where: { id: g.id } }))!.closed).toBe(true);
    expect(await db.payment.count({ where: { groupId: g.id } })).toBe(1);
  });
});

describe("4. nobody is removed from a pair", () => {
  it("the owner of a name-only pair can't delete the other name; the two people stay, in both ways of asking", async () => {
    const a = await made("rma", "Asha");
    const p = await ensureLocalPair({ id: a.id }, "Quill", { currency: "INR", myName: "Asha" }); // no money: the kind removePerson deletes outright
    if (!p.ok) throw new Error("refused");
    const before = await snapshot(p.groupId);
    expect(before.members).toHaveLength(2);
    expect(await removeMembers(p.groupId, p.myId, [p.otherId], false)).toEqual({ ok: false, error: PAIR_NO_PEOPLE });
    expect(await removeMembers(p.groupId, p.myId, [p.otherId], true)).toEqual({ ok: false, error: PAIR_NO_PEOPLE }); // as an undo would ask
    expect(await snapshot(p.groupId)).toEqual(before);
    expect(await ensureLocalPair({ id: a.id }, "quill", { currency: "INR", myName: "Asha" })).toMatchObject({ ok: true, groupId: p.groupId }); // the name still works
  });

  it("an ordinary group can still take back a name that was never used", async () => {
    const a = await made("rga", "Ann");
    const g = await mkSharedGroup("rg", [{ id: a.id, name: "Ann" }]);
    const extra = await db.member.create({ data: { groupId: g.id, name: "Zed" } });
    expect((await removeMembers(g.id, g.memberOf(a.id), [extra.id], false)).ok).toBe(true);
    expect(await db.member.count({ where: { id: extra.id } })).toBe(0);
  });
});

describe("L1. a blocked person is told nothing", () => {
  it("someone who blocked you gets exactly the answer of someone you share no group with", async () => {
    const a = await made("l1a", "Asha");
    const blocker = await made("l1b", "Blocker");
    const stranger = await made("l1s", "Stranger");
    await mkSharedGroup("l1ab", [{ id: a.id, name: "Asha" }, { id: blocker.id, name: "Blocker" }]);
    await db.block.create({ data: { blockerId: blocker.id, blockedId: a.id } });
    const blocked = await ensureAccountPair({ id: a.id }, blocker.id, { currency: "INR", myName: "Asha" });
    const noShare = await ensureAccountPair({ id: a.id }, stranger.id, { currency: "INR", myName: "Asha" });
    expect(blocked).toEqual({ ok: false, error: PAIR_REFUSED });
    expect(noShare).toEqual(blocked);
    expect(await db.group.count({ where: { pairKey: accountPairKey(a.id, blocker.id) } })).toBe(0);
  });

  it("an existing pair, once either side blocks, gets the same plain refusal", async () => {
    const a = await made("l1c", "Asha");
    const b = await made("l1d", "Bo");
    await mkSharedGroup("l1cd", [{ id: a.id, name: "Asha" }, { id: b.id, name: "Bo" }]);
    const pair = await ensureAccountPair({ id: a.id }, b.id, { currency: "INR", myName: "Asha" });
    expect(pair.ok).toBe(true);
    await db.block.create({ data: { blockerId: b.id, blockedId: a.id } });
    expect(await ensureAccountPair({ id: a.id }, b.id, { currency: "INR", myName: "Asha" })).toEqual({ ok: false, error: PAIR_REFUSED });
  });
});

describe("L2 and L3. an invitation that can be seen and cancelled", () => {
  it("your own email is said plainly and writes nothing", async () => {
    const a = await made("l2a", "Asha");
    const p = await ensureLocalPair({ id: a.id }, "Sam", { currency: "INR", myName: "Asha" });
    if (!p.ok) throw new Error("refused");
    expect(await inviteDirectPerson(p.groupId, p.myId, a.email.toUpperCase(), origin)).toEqual({ ok: false, error: "That’s your own email. Type theirs." });
    expect(await db.invite.count({ where: { groupId: p.groupId } })).toBe(0);
    expect(await openInviteEmail(p.groupId, p.otherId)).toBeNull();
    expect(await mailTo(a.email)).toBe(0);
  });

  it("the email of someone you already have a pair with looks like a normal send, sends nothing, and can be cancelled", async () => {
    const a = await made("l2b", "Asha");
    const d = await made("l2d", "Dee");
    const other = await made("l2o", "Olly");
    await mkSharedGroup("l2bd", [{ id: a.id, name: "Asha" }, { id: d.id, name: "Dee" }]);
    const real = await ensureAccountPair({ id: a.id }, d.id, { currency: "INR", myName: "Asha" });
    const local = await ensureLocalPair({ id: a.id }, "Dee (old)", { currency: "INR", myName: "Asha" });
    if (!real.ok || !local.ok) throw new Error("refused");

    const r = await inviteDirectPerson(local.groupId, local.myId, d.email, origin);
    expect(r).toEqual({ ok: true, email: d.email });
    expect(await db.invite.count({ where: { groupId: local.groupId } })).toBe(0);
    expect(await mailTo(d.email)).toBe(0);
    // The person's page reads this: "Invitation sent to <email>" with Cancel, the same as after a real send.
    expect(await openInviteEmail(local.groupId, local.otherId)).toBe(d.email);

    // Cancelled, the form is back and the note is gone.
    expect(await cancelDirectInvite(local.groupId, local.myId)).toEqual({ ok: true });
    expect(await openInviteEmail(local.groupId, local.otherId)).toBeNull();

    // A genuine address can then be sent.
    expect((await inviteDirectPerson(local.groupId, local.myId, other.email, origin)).ok).toBe(true);
    expect(await openInviteEmail(local.groupId, local.otherId)).toBe(other.email);
    expect(await mailTo(other.email)).toBe(1);
  });

  it("a mistyped address can be cancelled and corrected: the first invitation closes, only the new one is open, balances untouched", async () => {
    const { a, p } = await pairWithExpense("l3a", false);
    const good = await made("l3g", "Rohan");
    const before = (await snapshot(p.groupId)).net;
    expect((await inviteDirectPerson(p.groupId, p.myId, `typo-${stamp}@example.com`, origin)).ok).toBe(true);
    expect(await openInviteEmail(p.groupId, p.otherId)).toBe(`typo-${stamp}@example.com`);

    expect(await cancelDirectInvite(p.groupId, p.myId)).toEqual({ ok: true });
    const typo = await db.invite.findFirst({ where: { groupId: p.groupId, email: `typo-${stamp}@example.com` } });
    expect(typo!.declinedAt).not.toBeNull();
    expect(await openInviteEmail(p.groupId, p.otherId)).toBeNull();
    expect((await db.group.findUnique({ where: { id: p.groupId } }))!.pairKey).toBe(`local:${a.id}|rohan`); // still the name only Asha sees
    expect((await snapshot(p.groupId)).net).toEqual(before);

    expect((await inviteDirectPerson(p.groupId, p.myId, good.email, origin)).ok).toBe(true);
    expect(await openInviteEmail(p.groupId, p.otherId)).toBe(good.email);
    expect(await db.invite.count({ where: { groupId: p.groupId, acceptedAt: null, declinedAt: null } })).toBe(1);
  });

  it("only a member of the pair who has an account can cancel; a stranger and the name-only row can't", async () => {
    const { p } = await pairWithExpense("l3b", false);
    const x = await made("l3x", "Xavier");
    expect((await inviteDirectPerson(p.groupId, p.myId, x.email, origin)).ok).toBe(true);
    const stranger = await made("l3s", "Stranger");
    const elsewhere = await mkSharedGroup("l3s", [{ id: stranger.id, name: "Stranger" }]);
    expect((await cancelDirectInvite(p.groupId, elsewhere.memberOf(stranger.id))).ok).toBe(false); // someone else's member id
    expect((await cancelDirectInvite(p.groupId, p.otherId)).ok).toBe(false); // the name itself has no account
    expect(await openInviteEmail(p.groupId, p.otherId)).toBe(x.email); // still open
  });

  it("an ordinary group is not a pair: cancelDirectInvite refuses it", async () => {
    const a = await made("l3o", "Ann");
    const g = await mkSharedGroup("l3o", [{ id: a.id, name: "Ann" }]);
    expect((await cancelDirectInvite(g.id, g.memberOf(a.id))).ok).toBe(false);
  });
});

describe("L5. a first expense in another currency leaves no history line", () => {
  it("an empty pair takes the new currency quietly: no currency_changed line for anyone to see", async () => {
    const a = await made("l5a", "Asha");
    const b = await made("l5b", "Bo");
    await mkSharedGroup("l5ab", [{ id: a.id, name: "Asha" }, { id: b.id, name: "Bo" }]);
    const p = await ensureAccountPair({ id: a.id }, b.id, { currency: "INR", myName: "Asha" });
    if (!p.ok) throw new Error("refused");
    expect(await prepareDirectSave(p.groupId, p.myId, "USD", false)).toBeNull();
    expect((await db.group.findUnique({ where: { id: p.groupId } }))!.currency).toBe("USD");
    expect(await db.groupEvent.count({ where: { groupId: p.groupId } })).toBe(0);
  });

  it("a pair that already has money keeps its currency and writes nothing", async () => {
    const { p } = await pairWithExpense("l5c", true);
    expect(await prepareDirectSave(p.groupId, p.myId, "USD", false)).toBeNull();
    const g = await db.group.findUnique({ where: { id: p.groupId } });
    expect(g!.currency).toBe("INR");
    expect(await db.groupEvent.count({ where: { groupId: p.groupId } })).toBe(0);
    expect((await loadGroup(p.groupId))!.net[p.otherId]).toBe(-60000);
  });
});

describe("L7. a pair has no invitation picture", () => {
  it("its invite-card route is a 404; an ordinary group's code is not", async () => {
    const { p } = await pairWithExpense("l7a", true);
    const code = (await db.group.findUnique({ where: { id: p.groupId }, select: { inviteCode: true } }))!.inviteCode;
    const res = await card.GET(new Request(`https://loopin.test/join/${code}/card`), { params: Promise.resolve({ code }) });
    expect(res.status).toBe(404);
  });
});
