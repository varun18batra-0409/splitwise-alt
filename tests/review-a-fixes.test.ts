import { afterAll, describe, expect, it, vi } from "vitest";

// Fixes after the independent review of Batch A (16 Nov). Throwaway database; amounts in paise, every number worked by hand.
//
// 1. A payment with someone who has LEFT, to a person who can tap Confirm received, may only be recorded by that person.
//    (Before: Meera could mark "Asha paid Ravi 40000" for Asha, it counted at once, and Ravi's "Not received" was then refused.)
// 2. "Mark all paid" follows the leaver rule too (a leaver may only end unchanged or at 0).
// 3. Someone who moves out is squared up only by people still in the flat; a leaver's balance is never touched.
// 4. Undo of "Settle everything" reopens the "I've paid" note that payment had closed as covered (and so does taking back an old pay-link payment).
// 5. The Undo button check mirrors the server for a payment the person paid deleted themselves (older lines).
// 6. Search no longer lists people who only share a deleted group with you.
// 8. Undoing a move-out takes back a counted square-up payment (the person paid is only a name, so it is still a payment).

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
process.env.MAIL_OUTBOX = "1";

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { moveOut, moveOutPreview } = await import("@/lib/home/moving-db");
const { leaverPayments } = await import("@/lib/home/moving");
const { makeClaim } = await import("@/lib/payment-claims");
const { recordPaymentCore } = await import("@/lib/pay-record");
const { markAllPaid, settleAllAndClose, applySettleAll } = await import("@/lib/settle-all");
const { settleAcrossCore } = await import("@/lib/cross-settle-db");
const { actorRefusal, undoEvent } = await import("@/lib/undo");
const { receiverOnlyText } = await import("@/lib/refused-payment");
const { searchPeople } = await import("@/lib/invites");
const { readFileSync } = await import("node:fs");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
const NOW = new Date("2026-11-10T06:00:00Z");
const key = () => `raf-${stamp}-${++n}-abcdefgh`;

afterAll(async () => {
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `raf-${name.toLowerCase().replace(/\W/g, "")}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}

async function flat(people: { name: string; joined: boolean }[]) {
  const accounts = await Promise.all(people.map((p) => (p.joined ? account(p.name) : Promise.resolve(null))));
  const g = await db.group.create({
    data: {
      name: `Review A ${++n} ${stamp}`, type: "home", currency: "INR", inviteCode: `raf-${n}-${stamp}`,
      members: {
        create: people.map((p, i) => ({
          name: p.name, splitWeight: 100, createdAt: new Date(2026, 0, i + 1),
          ...(accounts[i] ? { accountId: accounts[i]!.id, claimedAt: new Date(2026, 0, i + 1) } : {}),
        })),
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  const expense = (description: string, amount: number, paidById: string, shares: [string, number][]) =>
    db.expense.create({
      data: {
        groupId: g.id, description, category: "other", amount, paidById, createdById: paidById, splitType: "equal", forMode: "selected",
        originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, spentAt: new Date("2026-11-01T12:00:00Z"),
        shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) },
      },
    });
  const net = async () => {
    const x = await db.group.findUniqueOrThrow({ where: { id: g.id }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
    return netBalances(x.members.map((m) => m.id), x.expenses, x.payments);
  };
  const payments = () => db.payment.findMany({ where: { groupId: g.id, deletedAt: null } });
  const claims = () => db.paymentClaim.findMany({ where: { groupId: g.id }, orderBy: { createdAt: "asc" } });
  const leave = (memberId: string) => db.member.update({ where: { id: memberId }, data: { leftAt: new Date("2026-11-05T12:00:00Z") } });
  return { gid: g.id, id, expense, net, payments, claims, leave };
}
const sum = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0);
const out = (gid: string, actor: string, leaver: string) => moveOut(gid, actor, { leaverId: leaver, lastDay: "2026-11-10", requestKey: key() }, NOW);
const pay = (f: { gid: string }, myId: string, fromId: string, toId: string, amount: number) =>
  recordPaymentCore({ groupId: f.gid, fromId, toId, amount, currency: "INR", myId, key: key(), fp: `fp-${key()}`, warnOver: false });

// Asha, Ravi, Meera, all joined. Milk 40000 paid by Ravi, all Asha's: Asha -40000, Ravi +40000, Meera 0. Asha moves out: a waiting note Asha -> Ravi 40000.
async function ashaLeftOwing() {
  const f = await flat([{ name: "Asha", joined: true }, { name: "Ravi", joined: true }, { name: "Meera", joined: true }]);
  const [A, R, M] = [f.id("Asha"), f.id("Ravi"), f.id("Meera")];
  await f.expense("Milk", 40000, R, [[A, 40000]]);
  const r = await out(f.gid, A, A);
  expect(r.ok).toBe(true);
  expect(await f.net()).toEqual({ [A]: -40000, [R]: 40000, [M]: 0 });
  expect((await f.claims()).map((c) => [c.fromId, c.toId, c.amount, c.status])).toEqual([[A, R, 40000, "waiting"]]);
  return { f, A, R, M };
}
const REFUSED = "Asha has left. Only Ravi can mark this as received.";

describe("1. a leaver's debt can only be marked paid by the person who is owed", () => {
  it("Record a payment: Meera is refused with the plain words, nothing changes; Ravi records it himself and the note is covered", async () => {
    const { f, A, R, M } = await ashaLeftOwing();
    expect(await pay(f, M, A, R, 40000)).toEqual({ kind: "refused", error: REFUSED });
    expect(await f.payments()).toHaveLength(0);
    expect((await f.claims())[0].status).toBe("waiting");
    expect(await f.net()).toEqual({ [A]: -40000, [R]: 40000, [M]: 0 });
    // Ravi himself: recording it is confirming it (no "Not received" to ask him), Asha ends at 0 (allowed).
    const done = await pay(f, R, A, R, 40000);
    expect(done.kind).toBe("done");
    const ps = await f.payments();
    expect(ps.map((p) => [p.fromId, p.toId, p.amount, p.needsOk])).toEqual([[A, R, 40000, false]]);
    expect((await f.claims())[0].status).toBe("covered");
    const after = await f.net();
    expect(after).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
    expect(sum(after)).toBe(0);
  });

  it("Mark all paid and Settle everything: Meera is refused, nothing is recorded and the group stays open", async () => {
    const { f, A, R, M } = await ashaLeftOwing();
    expect(await markAllPaid(f.gid, M, [{ from: A, to: R, amount: 40000 }], "", true)).toEqual({ ok: false, error: REFUSED });
    expect(await settleAllAndClose(f.gid, M, `${A}>${R}:40000`)).toEqual({ ok: false, error: REFUSED });
    expect(await f.payments()).toHaveLength(0);
    expect((await db.group.findUniqueOrThrow({ where: { id: f.gid } })).closed).toBe(false);
    expect(await f.net()).toEqual({ [A]: -40000, [R]: 40000, [M]: 0 });
    // Ravi marks it himself in one tap: Asha 0, Ravi 0.
    expect((await markAllPaid(f.gid, R, [{ from: A, to: R, amount: 40000 }], "", true)).ok).toBe(true);
    expect(await f.net()).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
  });

  it("across groups: Meera paying Asha (who left, owed 40000) is refused; nothing is recorded", async () => {
    const f = await flat([{ name: "Asha", joined: true }, { name: "Meera", joined: true }]);
    const [A, M] = [f.id("Asha"), f.id("Meera")];
    await f.expense("Cab", 40000, A, [[M, 40000]]); // Asha +40000, Meera -40000
    await f.leave(A);
    const r = await settleAcrossCore([{ groupId: f.gid, fromId: M, toId: A, amount: 40000 }], { [f.gid]: M }, undefined);
    expect(r).toBe("changed");
    expect(await f.payments()).toHaveLength(0);
    expect(await f.net()).toEqual({ [A]: 40000, [M]: -40000 });
  });

  it("a leaver who owes a plain name (nobody to confirm) keeps today's behaviour: anyone may record it, and she ends at 0", async () => {
    const f = await flat([{ name: "Asha", joined: true }, { name: "Ravi", joined: false }, { name: "Meera", joined: true }]);
    const [A, R, M] = [f.id("Asha"), f.id("Ravi"), f.id("Meera")];
    await f.expense("Milk", 40000, R, [[A, 40000]]);
    await f.leave(A);
    expect((await pay(f, M, A, R, 40000)).kind).toBe("done");
    const after = await f.net();
    expect(after).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
    expect(sum(after)).toBe(0);
  });
});

describe("2. Mark all paid follows the leaver rule", () => {
  it("Ravi marking only 10000 of Asha's 40000 would leave her at -30000: refused; the whole 40000 is fine", async () => {
    const { f, A, R, M } = await ashaLeftOwing();
    const part = await markAllPaid(f.gid, R, [{ from: A, to: R, amount: 10000 }], "", true);
    expect(part.ok).toBe(false);
    expect(!part.ok && part.error).toContain("Asha has left the group");
    expect(await f.payments()).toHaveLength(0);
    expect(await f.net()).toEqual({ [A]: -40000, [R]: 40000, [M]: 0 });
    expect((await markAllPaid(f.gid, R, [{ from: A, to: R, amount: 40000 }], "", true)).ok).toBe(true);
    expect(await f.net()).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
  });
});

describe("3. moving out is squared only among people still in the flat", () => {
  it("leaverPayments: Meera owed 100000, Ravi owes 60000, Asha (left) owes 40000: only Ravi, only his 60000", () => {
    const net = { M: 100000, R: -60000, A: -40000 };
    expect(leaverPayments(net, "M", new Set(["R"]))).toEqual([{ from: "R", to: "M", amount: 60000 }]);
    // Without the list (the old behaviour) Asha would have been drawn in: 60000 and 40000.
    expect(leaverPayments(net, "M")).toEqual([{ from: "R", to: "M", amount: 60000 }, { from: "A", to: "M", amount: 40000 }]);
    // The other way: Meera owes 100000, Ravi is owed 60000, Asha (left) is owed 40000: she pays only Ravi, 60000.
    expect(leaverPayments({ M: -100000, R: 60000, A: 40000 }, "M", new Set(["R"]))).toEqual([{ from: "M", to: "R", amount: 60000 }]);
    // A leaver who is not in the list is never in the result even when she is the only one owed.
    expect(leaverPayments({ M: -40000, A: 40000 }, "M", new Set(["R"]))).toEqual([]);
  });

  it("Meera (owed 100000) moves out while Asha (left) owes 40000: Meera is not refused; Ravi pays 60000; Asha is untouched; Meera keeps +40000 against Asha", async () => {
    const f = await flat([{ name: "Meera", joined: true }, { name: "Ravi", joined: true }, { name: "Asha", joined: true }]);
    const [M, R, A] = [f.id("Meera"), f.id("Ravi"), f.id("Asha")];
    await f.expense("Dinner", 100000, M, [[R, 60000], [A, 40000]]);
    await f.leave(A);
    expect(await f.net()).toEqual({ [M]: 100000, [R]: -60000, [A]: -40000 });
    const p = await moveOutPreview(f.gid, M, "2026-11-10", NOW, M);
    if (!p.ok) throw new Error(p.error);
    expect(p.payments).toEqual([{ from: R, to: M, amount: 60000 }]);
    const r = await out(f.gid, M, M);
    expect(r.ok).toBe(true);
    expect((await f.payments()).map((x) => [x.fromId, x.toId, x.amount])).toEqual([[R, M, 60000]]);
    const after = await f.net();
    expect(after).toEqual({ [M]: 40000, [R]: 0, [A]: -40000 }); // Asha exactly as before
    expect(sum(after)).toBe(0);
  });

  it("two creditors: Meera +100000, Ben (a name) +100000, Ravi -120000, Asha (left) -80000: Ravi pays all 100000 (not a split with Asha); Asha stays -80000", async () => {
    const f = await flat([{ name: "Meera", joined: true }, { name: "Ravi", joined: true }, { name: "Ben", joined: false }, { name: "Asha", joined: true }]);
    const [M, R, B, A] = [f.id("Meera"), f.id("Ravi"), f.id("Ben"), f.id("Asha")];
    await f.expense("Dinner", 100000, M, [[R, 60000], [A, 40000]]);
    await f.expense("Taxi", 100000, B, [[R, 60000], [A, 40000]]);
    await f.leave(A);
    expect(await f.net()).toEqual({ [M]: 100000, [R]: -120000, [B]: 100000, [A]: -80000 });
    // (Before: 100000 split 120000 : 80000 = Ravi 60000 and Asha 40000, which moved Asha from -80000 to -40000 and was refused.)
    const r = await out(f.gid, M, M);
    expect(r.ok).toBe(true);
    expect((await f.payments()).map((x) => [x.fromId, x.toId, x.amount])).toEqual([[R, M, 100000]]);
    const after = await f.net();
    expect(after).toEqual({ [M]: 0, [R]: -20000, [B]: 100000, [A]: -80000 });
    expect(sum(after)).toBe(0);
  });
});

describe("4. taking a payment off reopens the note it had covered", () => {
  it("Undo of Settle everything: Asha's 'I've paid' (40000) is covered by it, and waiting again after the undo", async () => {
    const f = await flat([{ name: "Asha", joined: true }, { name: "Ravi", joined: true }]);
    const [A, R] = [f.id("Asha"), f.id("Ravi")];
    await f.expense("Milk", 40000, R, [[A, 40000]]);
    const made = await makeClaim({ groupId: f.gid, fromId: A, toId: R, actorId: A, source: "app" });
    expect(made.ok).toBe(true);
    expect((await settleAllAndClose(f.gid, R, `${A}>${R}:40000`)).ok).toBe(true);
    expect((await f.claims())[0].status).toBe("covered");
    expect(await f.net()).toEqual({ [A]: 0, [R]: 0 });
    const ids = (await f.payments()).map((p) => p.id);
    expect(ids).toHaveLength(1);
    expect((await applySettleAll(f.gid, R, ids, false)).ok).toBe(true);
    const c = (await f.claims())[0];
    expect([c.status, c.paymentId, c.slot]).toEqual(["waiting", "", ""]);
    expect((await db.group.findUniqueOrThrow({ where: { id: f.gid } })).closed).toBe(false);
    const back = await f.net();
    expect(back).toEqual({ [A]: -40000, [R]: 40000 });
    expect(sum(back)).toBe(0);
  });

  it("taking back an old pay-link payment uses the same reopening (checked in the action's source: it needs a request)", () => {
    const src = readFileSync("src/app/pay-link-actions.ts", "utf8");
    expect(src).toContain("reopenCoveredClaims(tx, [s.link.paymentId])");
    expect(src.indexOf("reopenCoveredClaims(tx, [s.link.paymentId])")).toBeGreaterThan(src.indexOf("if (gone.count !== 1) return;"));
  });
});

describe("5. the Undo check mirrors the server for a payment the person paid deleted themselves", () => {
  const T0 = new Date("2026-11-10T06:00:00.000Z");
  const members = [
    { id: "ravi", name: "Ravi", accountId: "a1", leftAt: null, removedAt: null },
    { id: "meera", name: "Meera", accountId: "a2", leftAt: null, removedAt: null },
  ];
  const ev = { id: "e1", kind: "payment_deleted", text: "deleted the payment Asha → Ravi (₹400)", actorId: "ravi", undo: JSON.stringify({ type: "payment_restore", paymentId: "p1" }), undoneAt: null, expenseId: null, paymentId: "p1", createdAt: T0 };
  const viewer = (id: string, withPayments: boolean) => ({ id, isAdmin: false, closed: false, members, ...(withPayments ? { payments: [{ id: "p1", toId: "ravi", deletedById: "ravi" }] } : {}) });
  it("Meera is told only Ravi can bring it back; Ravi is not; without the payment list the old words-only check lets it through (the server still refuses)", () => {
    expect(actorRefusal(ev as never, viewer("meera", true) as never, T0)).toBe(receiverOnlyText("Ravi"));
    expect(actorRefusal(ev as never, viewer("ravi", true) as never, T0)).toBeNull();
    expect(actorRefusal(ev as never, viewer("meera", false) as never, T0)).toBeNull();
  });
  it("a payment somebody else deleted can be brought back by anyone in the group", () => {
    const v = { ...viewer("meera", false), payments: [{ id: "p1", toId: "ravi", deletedById: "meera" }] };
    expect(actorRefusal({ ...ev, actorId: "meera" } as never, v as never, T0)).toBeNull();
  });
});

describe("6. search only lists people from groups that still exist", () => {
  it("someone who only shares a deleted group with you is not offered; the same group alive offers them", async () => {
    const me = await account("Searcher");
    const other = await account("Zedd Findable");
    const shared = await db.group.create({
      data: { name: `Shared ${stamp}-${++n}`, currency: "INR", inviteCode: `raf-s-${n}-${stamp}`, members: { create: [{ name: "Searcher", accountId: me.id, claimedAt: new Date() }, { name: "Zedd", accountId: other.id, claimedAt: new Date() }] } },
      include: { members: true },
    });
    const cur = await db.group.create({ data: { name: `Cur ${stamp}-${n}`, currency: "INR", inviteCode: `raf-c-${n}-${stamp}`, members: { create: [{ name: "Searcher", accountId: me.id, claimedAt: new Date() }] } }, include: { members: true } });
    groupIds.push(shared.id, cur.id);
    const memberships = { [shared.id]: shared.members.find((m) => m.accountId === me.id)!.id, [cur.id]: cur.members[0].id };
    expect((await searchPeople(memberships, cur.id, "zedd")).map((f) => f.accountId)).toEqual([other.id]);
    await db.group.update({ where: { id: shared.id }, data: { deletedAt: new Date() } });
    expect(await searchPeople(memberships, cur.id, "zedd")).toEqual([]);
  });

  it("a trip made from a reached goal carries people the search rule won't add by account as plain names (source check)", () => {
    const src = readFileSync("src/app/bill-actions.ts", "utf8");
    expect(src).toContain("if (!r.ok) {");
    expect(src).toContain("await db.member.create({ data: { name, groupId: trip.id } });");
  });
});

describe("8. undoing a move-out takes back a counted square-up payment", () => {
  it("Asha owes Ravi (only a name) 1200000: she moves out, the payment counts at once (0 / 0); her Undo removes it and she is back at -1200000", async () => {
    const f = await flat([{ name: "Asha", joined: true }, { name: "Ravi", joined: false }]);
    const [A, R] = [f.id("Asha"), f.id("Ravi")];
    await f.expense("Groceries", 1200000, R, [[A, 1200000]]);
    const r = await out(f.gid, A, A);
    if (!r.ok) throw new Error(r.error);
    expect((await f.payments()).map((p) => [p.fromId, p.toId, p.amount])).toEqual([[A, R, 1200000]]);
    expect(await f.net()).toEqual({ [A]: 0, [R]: 0 });
    expect((await undoEvent(r.eventId!, A)).ok).toBe(true);
    expect(await f.payments()).toHaveLength(0);
    expect((await db.payment.findMany({ where: { groupId: f.gid, deletedAt: { not: null } } })).map((p) => p.amount)).toEqual([1200000]);
    expect((await db.member.findUniqueOrThrow({ where: { id: A } })).leftAt).toBeNull();
    const back = await f.net();
    expect(back).toEqual({ [A]: -1200000, [R]: 1200000 });
    expect(sum(back)).toBe(0);
  });
});
