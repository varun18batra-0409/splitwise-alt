import { afterAll, describe, expect, it, vi } from "vitest";

// Fixes after the independent review of Batch A (16 Nov). Throwaway database; amounts in paise, every number worked by hand.
//
// (Sections 1 and 3 are gone: they set up "left but still owing", which can no longer happen. Someone who has left always owes nothing, and
//  "Not received" brings them back instead of being refused. See tests/leaver-zero.test.ts.)
// 2. "Mark all paid" follows the leaver rule too (a leaver may only end unchanged or at 0). Set up here as an old row that is left and owes.
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
const { moveOut } = await import("@/lib/home/moving-db");
const { markAllPaid, settleAllAndClose, applySettleAll } = await import("@/lib/settle-all");
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

// Asha, Ravi, Meera, all joined. Milk 40000 paid by Ravi, all Asha's: Asha -40000, Ravi +40000, Meera 0. Asha is then marked as left in the database
// directly: an old row from before the rule "someone who has left owes nothing" (the app no longer lets this happen).
async function ashaLeftOwing() {
  const f = await flat([{ name: "Asha", joined: true }, { name: "Ravi", joined: true }, { name: "Meera", joined: true }]);
  const [A, R, M] = [f.id("Asha"), f.id("Ravi"), f.id("Meera")];
  await f.expense("Milk", 40000, R, [[A, 40000]]);
  await f.leave(A);
  expect(await f.net()).toEqual({ [A]: -40000, [R]: 40000, [M]: 0 });
  return { f, A, R, M };
}

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

describe("4. taking a payment off puts the debt back (no old notes involved any more)", () => {
  it("Undo of Settle everything: Asha's 40000 is recorded by it, and is owed again after the undo", async () => {
    const f = await flat([{ name: "Asha", joined: true }, { name: "Ravi", joined: true }]);
    const [A, R] = [f.id("Asha"), f.id("Ravi")];
    await f.expense("Milk", 40000, R, [[A, 40000]]);
    expect((await settleAllAndClose(f.gid, R, `${A}>${R}:40000`)).ok).toBe(true);
    expect(await f.claims()).toHaveLength(0); // no note is made or touched
    expect(await f.net()).toEqual({ [A]: 0, [R]: 0 });
    const ids = (await f.payments()).map((p) => p.id);
    expect(ids).toHaveLength(1);
    expect((await applySettleAll(f.gid, R, ids, false)).ok).toBe(true);
    expect(await f.claims()).toHaveLength(0);
    expect((await db.group.findUniqueOrThrow({ where: { id: f.gid } })).closed).toBe(false);
    const back = await f.net();
    expect(back).toEqual({ [A]: -40000, [R]: 40000 });
    expect(sum(back)).toBe(0);
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
