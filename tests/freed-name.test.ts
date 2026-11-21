import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// A guest name that was freed and taken again must not answer, delete, restore or undo things that belonged to the EARLIER holder,
// and looking after the group passes on once the admin's name is freed. Every refusal must change NOTHING.
// Throwaway database; amounts in paise, worked out by hand (the expected numbers below are written out, never computed by the code under test).
//
// The flat (people: Asha looks after it and has an account; Ben and Varun joined without an account):
//   Dinner 60000 paid by Ben, split equally: 20000 each (Ben, Varun, Asha).   20000 x 3 = 60000.
//        Ben +60000 -20000 = +40000 | Varun -20000 | Asha -20000 | sum 0
//   Varun moves out and pays Ben 20000 (a move-out final payment P, still waiting for Ben's "Got it / Not received"):
//        Ben +40000 -20000 = +20000 | Varun -20000 +20000 = 0 | Asha -20000 | sum 0
//   "Not received" (by the real Ben): P comes off and Varun is brought back owing:
//        Ben +40000 | Varun -20000 | Asha -20000 | sum 0
//   Settling what is left after the move-out: Asha pays Ben 20000 -> Ben 0, Varun 0, Asha 0.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const rules = await import("@/lib/guest-rules");
const words = await import("@/lib/guest-words");
const { answerRefusal, confirmPayment, guestMayAnswer, ONLY_PAID_TEXT, rejectPayment, waitingForMe } = await import("@/lib/payment-ok");
const { loadNeedsYou } = await import("@/lib/needs-you");
const { markAsMoveOut } = await import("./helpers/move-out-marks");
const { netBalances } = await import("@/lib/balances");
const { releaseGuestName } = await import("@/lib/join");
const { declineInvitation } = await import("@/lib/invitations");
const { setPaymentDeleted } = await import("@/lib/save-expense");
const { actorRefusal, removeMembers, undoEvent } = await import("@/lib/undo");
const { groupAdminId, isGroupAdmin, pickAdmin } = await import("@/lib/group-admin");
const { removedText } = await import("@/lib/active");
const { onlyReceiverCanBringBack, receiverOnlyText } = await import("@/lib/refused-payment");

const { GUEST_REFUSAL, BEFORE_NAME_TEXT, madeBeforeFreed, signinKeyOf } = words;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;

afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `fr-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}

const MIN = 60_000;
// The flat above, right up to "Varun moved out and P is waiting for Ben". P was made `payAgo` before now.
async function flat(payAgo = MIN) {
  const asha = await account("Asha");
  const g = await db.group.create({
    data: {
      name: `Flat ${++n} ${stamp}`, inviteCode: `fr-${n}-${stamp}`, type: "trip", currency: "INR",
      members: {
        create: [
          { name: "Asha", accountId: asha.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
          { name: "Ben", claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2), seenAt: new Date(2026, 0, 2) },
          { name: "Varun", claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3), seenAt: new Date(2026, 0, 3) },
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (name: string) => g.members.find((m) => m.name === name)!.id;
  const [A, B, V] = [id("Asha"), id("Ben"), id("Varun")];
  await db.expense.create({
    data: { groupId: g.id, description: "Dinner", splitType: "equal", amount: 60000, originalAmount: 60000, convertedAmount: 60000, paidById: B, createdById: B, shares: { create: [{ memberId: B, amount: 20000 }, { memberId: V, amount: 20000 }, { memberId: A, amount: 20000 }] } },
  });
  const P = await db.payment.create({ data: { groupId: g.id, fromId: V, toId: B, amount: 20000, createdById: A, needsOk: true, createdAt: new Date(Date.now() - payAgo) } });
  await markAsMoveOut(g.id, A, [P.id]);
  await db.member.update({ where: { id: V }, data: { leftAt: new Date(Date.now() - payAgo) } });
  return { g, gid: g.id, gname: g.name, A, B, V, P, asha };
}
type Flat = Awaited<ReturnType<typeof flat>>;

const bal = async (f: Flat) => {
  const g = await db.group.findUniqueOrThrow({ where: { id: f.gid }, include: { members: true, expenses: { include: { shares: true } }, payments: true } });
  const b = netBalances(g.members.map((m) => m.id), g.expenses.filter((e) => !e.deletedAt), g.payments.filter((p) => !p.deletedAt));
  return { Ben: b[f.B], Varun: b[f.V], Asha: b[f.A] };
};
const sharesSum = async (f: Flat) => (await db.expenseShare.findMany({ where: { expense: { groupId: f.gid } } })).reduce((s, x) => s + x.amount, 0);
// What a refusal must leave alone: payments (deleted / answered), history lines, who has left, the balances.
const snapshot = async (f: Flat) => ({
  payments: (await db.payment.findMany({ where: { groupId: f.gid }, orderBy: { id: "asc" }, select: { id: true, amount: true, deletedAt: true, okAt: true } })).map((p) => ({ ...p, deletedAt: p.deletedAt?.getTime() ?? null, okAt: p.okAt?.getTime() ?? null })),
  events: await db.groupEvent.count({ where: { groupId: f.gid } }),
  left: (await db.member.findMany({ where: { groupId: f.gid }, orderBy: { id: "asc" }, select: { id: true, leftAt: true, removedAt: true } })).map((m) => ({ id: m.id, left: m.leftAt?.getTime() ?? null, removed: m.removedAt?.getTime() ?? null })),
  balances: await bal(f),
});

const BEFORE = { Ben: 20000, Varun: 0, Asha: -20000 }; // with P counting, Varun moved out
const AFTER_NOT_RECEIVED = { Ben: 40000, Varun: -20000, Asha: -20000 }; // P taken off, Varun back owing

// Every scenario ends the same way: shares add up to the amount, balances add up to 0, and Asha paying Ben 20000 settles everyone to 0.
async function endsSquare(f: Flat) {
  expect(await sharesSum(f)).toBe(60000);
  const b = await bal(f);
  expect(b.Ben + b.Varun + b.Asha).toBe(0);
  expect(b).toEqual(BEFORE);
  await db.payment.create({ data: { groupId: f.gid, fromId: f.A, toId: f.B, amount: 20000, createdById: f.A } });
  expect(await bal(f)).toEqual({ Ben: 0, Varun: 0, Asha: 0 });
}

// Cat takes the name "Ben": the row is freed (the real code), then taken again as a guest, optionally signing in later.
async function freeAndRetake(f: Flat) {
  expect((await releaseGuestName(f.gid, f.A, f.B)).ok).toBe(true);
  await db.member.update({ where: { id: f.B }, data: { claimedAt: new Date() } });
}
async function signIn(f: Flat, name = "Cat") {
  const cat = await account(name);
  await db.member.update({ where: { id: f.B }, data: { accountId: cat.id } });
  return cat;
}
const needsYouIds = async (f: Flat, accountId: string | null) => (await loadNeedsYou({ [f.gid]: f.B }, accountId ? { id: accountId } : null, 0)).items.map((i) => i.id);

describe("madeBeforeFreed and answerRefusal, by the calendar (no database)", () => {
  const d = (day: number) => new Date(2026, 10, day); // November 2026
  it("madeBeforeFreed: never freed is false; at or before the freeing is the earlier holder's; unknown time is the earlier holder's", () => {
    expect(madeBeforeFreed(null, d(10))).toBe(false);
    expect(madeBeforeFreed(undefined, d(10))).toBe(false);
    expect(madeBeforeFreed(null, null)).toBe(false);
    expect(madeBeforeFreed(d(12), d(10))).toBe(true); // freed 12 Nov, made 10 Nov
    expect(madeBeforeFreed(d(10), d(10))).toBe(true); // the same instant: safe side
    expect(madeBeforeFreed(d(8), d(10))).toBe(false); // freed 8 Nov, made 10 Nov
    expect(madeBeforeFreed(d(8), null)).toBe(true); // made at an unknown time
  });
  it("answerRefusal, row by row", () => {
    const paid = { createdAt: d(10) };
    expect(answerRefusal(null, paid)).toBe(ONLY_PAID_TEXT); // no such member
    expect(answerRefusal({ accountId: "a", claimedAt: null, freedAt: null }, paid)).toBeNull(); // an account never freed
    expect(answerRefusal({ accountId: "a", claimedAt: null }, paid)).toBeNull(); // freedAt not given
    expect(answerRefusal({ accountId: "a", claimedAt: null, freedAt: d(12) }, paid)).toBe(ONLY_PAID_TEXT); // freed 12, paid 10
    expect(answerRefusal({ accountId: "a", claimedAt: null, freedAt: d(10) }, paid)).toBe(ONLY_PAID_TEXT); // same instant
    expect(answerRefusal({ accountId: "a", claimedAt: null, freedAt: d(8) }, paid)).toBeNull(); // freed 8, paid 10
    expect(answerRefusal({ accountId: null, claimedAt: d(9), freedAt: d(8) }, paid)).toBeNull(); // guest: freed 8, claimed 9, paid 10
    expect(answerRefusal({ accountId: null, claimedAt: d(11), freedAt: d(8) }, paid)).toBe(GUEST_REFUSAL); // guest: claimed 11, paid 10
    expect(answerRefusal({ accountId: null, claimedAt: d(11), freedAt: d(12) }, paid)).toBe(ONLY_PAID_TEXT); // the freed rule comes first
    expect(answerRefusal({ accountId: null, claimedAt: null, freedAt: null }, paid)).toBe(GUEST_REFUSAL); // a guest with no claim time
    expect(guestMayAnswer({ accountId: null, claimedAt: d(9) }, paid)).toBe(true);
    expect(guestMayAnswer({ accountId: null, claimedAt: d(11) }, paid)).toBe(false);
  });
  it("the sentences: the new one is not a sign-in refusal (signing in would not help)", () => {
    expect(ONLY_PAID_TEXT).toBe("Only the person who was paid can confirm it.");
    expect(BEFORE_NAME_TEXT).toBe("This payment is from before you took this name, so you can’t change it.");
    expect(signinKeyOf(BEFORE_NAME_TEXT)).toBeNull();
    expect(signinKeyOf(ONLY_PAID_TEXT)).toBeNull();
    expect(words.refusalNotes(BEFORE_NAME_TEXT)).toEqual({ error: BEFORE_NAME_TEXT });
  });
  it("paymentChangeRefusal: a party whose name was freed after the payment is refused, account or not; the other party and a never-freed name are not", () => {
    const p = { fromId: "varun", toId: "ben", createdAt: d(10) };
    expect(rules.paymentChangeRefusal(false, "ben", p, null, d(12))).toBe(BEFORE_NAME_TEXT); // an account
    expect(rules.paymentChangeRefusal(true, "ben", p, d(13), d(12))).toBe(BEFORE_NAME_TEXT); // a guest who took it on 13th
    expect(rules.paymentChangeRefusal(false, "varun", p, null, null)).toBeNull(); // the payer, never freed
    expect(rules.paymentChangeRefusal(false, "ben", p, null, d(8))).toBeNull(); // freed before the payment
    expect(rules.paymentChangeRefusal(false, "asha", p, null, d(12))).toBeNull(); // not in it: the party rule says no elsewhere
  });
  it("onlyReceiverCanBringBack: the new holder is not the person paid for a payment from before the freeing", () => {
    const p = { deletedById: "ben", toId: "ben", createdAt: d(10) };
    expect(onlyReceiverCanBringBack(p, "ben")).toBe(false); // the real Ben, no freedAt given: as before
    expect(onlyReceiverCanBringBack(p, "ben", d(12))).toBe(true); // the new holder of "Ben", freed 12th
    expect(onlyReceiverCanBringBack(p, "ben", d(8))).toBe(false); // freed before the payment
    expect(onlyReceiverCanBringBack(p, "varun")).toBe(true); // anyone else, as before
  });
});

describe("(a) a freed name that is taken again cannot answer the earlier holder's payment", () => {
  it("Asha frees Ben; Cat takes 'Ben' as a guest: Not received and Got it say only the person paid; not listed; nothing changes. Same after Cat signs in", async () => {
    const f = await flat();
    expect(await bal(f)).toEqual(BEFORE);
    const before = new Date();
    expect((await releaseGuestName(f.gid, f.A, f.B)).ok).toBe(true);
    const freed = (await db.member.findUniqueOrThrow({ where: { id: f.B } })).freedAt!;
    expect(freed.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(freed.getTime()).toBeLessThanOrEqual(Date.now());
    await db.member.update({ where: { id: f.B }, data: { claimedAt: new Date() } }); // Cat takes the name

    const snap = await snapshot(f);
    expect(await rejectPaymentOf(f)).toEqual({ ok: false, error: ONLY_PAID_TEXT });
    expect(await confirmPayment(f.P.id, f.B)).toEqual({ ok: false, error: ONLY_PAID_TEXT });
    expect(await waitingForMe(f.gid, f.B)).toEqual([]);
    expect(await needsYouIds(f, null)).not.toContain(`payment:${f.P.id}`);
    expect(await snapshot(f)).toEqual(snap);

    const cat = await signIn(f);
    expect(await rejectPaymentOf(f)).toEqual({ ok: false, error: ONLY_PAID_TEXT });
    expect(await confirmPayment(f.P.id, f.B)).toEqual({ ok: false, error: ONLY_PAID_TEXT });
    expect(await waitingForMe(f.gid, f.B)).toEqual([]);
    expect(await needsYouIds(f, cat.id)).not.toContain(`payment:${f.P.id}`);
    expect(await snapshot(f)).toEqual(snap);
    expect((await db.payment.findUniqueOrThrow({ where: { id: f.P.id } })).okAt).toBeNull();
    expect((await db.member.findUniqueOrThrow({ where: { id: f.V } })).leftAt).not.toBeNull(); // Varun still left
    await endsSquare(f);
  });
  it("(a2) Ben frees his own name and it is taken again: the same", async () => {
    const f = await flat();
    expect((await releaseGuestName(f.gid, f.B, f.B)).ok).toBe(true);
    await db.member.update({ where: { id: f.B }, data: { claimedAt: new Date() } });
    const snap = await snapshot(f);
    expect(await rejectPaymentOf(f)).toEqual({ ok: false, error: ONLY_PAID_TEXT });
    expect(await confirmPayment(f.P.id, f.B)).toEqual({ ok: false, error: ONLY_PAID_TEXT });
    expect(await snapshot(f)).toEqual(snap);
    await endsSquare(f);
  });
  it("the real Ben, never freed, can still say Not received: Ben +40000, Varun -20000 (back), Asha -20000", async () => {
    const f = await flat();
    expect((await rejectPaymentOf(f)).ok).toBe(true);
    expect(await bal(f)).toEqual(AFTER_NOT_RECEIVED);
    expect(await sharesSum(f)).toBe(60000);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.V } })).leftAt).toBeNull();
  });
});
const rejectPaymentOf = (f: Flat) => rejectPayment(f.P.id, f.B);

describe("(b) a person who never had their name freed", () => {
  it("(b1) added by email (an account, never took a name): allowed later, and listed", async () => {
    const f = await flat();
    const ravi = await account("Ravi");
    await db.member.update({ where: { id: f.B }, data: { name: "Ravi", accountId: ravi.id, claimedAt: null, addedBy: f.A, seenAt: new Date() } });
    expect(answerRefusal(await db.member.findUniqueOrThrow({ where: { id: f.B } }), f.P)).toBeNull();
    expect((await waitingForMe(f.gid, f.B)).map((p) => p.id)).toEqual([f.P.id]);
    expect(await needsYouIds(f, ravi.id)).toContain(`payment:${f.P.id}`);
    expect((await confirmPayment(f.P.id, f.B)).ok).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: f.P.id } })).okAt).not.toBeNull();
    await endsSquare(f);
  });
  it("(b2) a plain name (Dev): claims it as a guest later -> sign-in line; signs in -> allowed and listed", async () => {
    const f = await flat();
    await db.member.update({ where: { id: f.B }, data: { name: "Dev", claimedAt: null } });
    await db.member.update({ where: { id: f.B }, data: { claimedAt: new Date() } }); // Dev claims the name AFTER the payment
    const snap = await snapshot(f);
    expect(await rejectPaymentOf(f)).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect(await confirmPayment(f.P.id, f.B)).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect(await waitingForMe(f.gid, f.B)).toEqual([]);
    expect(await snapshot(f)).toEqual(snap);
    const dev = await signIn(f, "Dev");
    expect((await waitingForMe(f.gid, f.B)).map((p) => p.id)).toEqual([f.P.id]);
    expect(await needsYouIds(f, dev.id)).toContain(`payment:${f.P.id}`);
    expect((await rejectPaymentOf(f)).ok).toBe(true);
    expect(await bal(f)).toEqual(AFTER_NOT_RECEIVED);
  });
});

describe("(c) the order of freeing, taking the name and the payment", () => {
  it("(c1) freed, then taken, then paid: allowed, and Got it confirms", async () => {
    const f = await flat(MIN); // P was made 1 minute ago
    await db.member.update({ where: { id: f.B }, data: { freedAt: new Date(Date.now() - 3 * MIN), claimedAt: new Date(Date.now() - 2 * MIN) } });
    expect(answerRefusal(await db.member.findUniqueOrThrow({ where: { id: f.B } }), f.P)).toBeNull();
    expect((await waitingForMe(f.gid, f.B)).map((p) => p.id)).toEqual([f.P.id]);
    expect((await confirmPayment(f.P.id, f.B)).ok).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: f.P.id } })).okAt).not.toBeNull();
    await endsSquare(f);
  });
  it("(c2) freed, then paid, then taken: a guest gets the sign-in line; signed in is allowed", async () => {
    const f = await flat(2 * MIN); // P was made 2 minutes ago
    await db.member.update({ where: { id: f.B }, data: { freedAt: new Date(Date.now() - 3 * MIN), claimedAt: new Date(Date.now() - MIN) } });
    const snap = await snapshot(f);
    expect(await rejectPaymentOf(f)).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect(await snapshot(f)).toEqual(snap);
    const cat = await signIn(f);
    expect(await needsYouIds(f, cat.id)).toContain(`payment:${f.P.id}`);
    expect((await confirmPayment(f.P.id, f.B)).ok).toBe(true);
    await endsSquare(f);
  });
  it("(d) a guest who took the name before the payment is allowed (the existing rule)", async () => {
    const f = await flat();
    await db.member.update({ where: { id: f.B }, data: { claimedAt: new Date(Date.now() - 5 * MIN) } });
    expect(answerRefusal(await db.member.findUniqueOrThrow({ where: { id: f.B } }), f.P)).toBeNull();
    expect((await confirmPayment(f.P.id, f.B)).ok).toBe(true);
  });
  it("(e) no account and no claim time: the sign-in line, and not listed", async () => {
    const f = await flat();
    await db.member.update({ where: { id: f.B }, data: { claimedAt: null } });
    const snap = await snapshot(f);
    expect(await rejectPaymentOf(f)).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect(await confirmPayment(f.P.id, f.B)).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect(await waitingForMe(f.gid, f.B)).toEqual([]);
    expect(await snapshot(f)).toEqual(snap);
    await endsSquare(f);
  });
  it("(f) someone an admin removed is told so first: a guest who took the name after the payment, and a freed account holder", async () => {
    const f = await flat();
    await db.member.update({ where: { id: f.B }, data: { claimedAt: new Date(), removedAt: new Date(), leftAt: new Date() } });
    expect(await rejectPaymentOf(f)).toEqual({ ok: false, error: removedText(f.gname) });
    expect(await confirmPayment(f.P.id, f.B)).toEqual({ ok: false, error: removedText(f.gname) });
    const cat = await account("Cat");
    await db.member.update({ where: { id: f.B }, data: { accountId: cat.id, freedAt: new Date() } });
    expect(await rejectPaymentOf(f)).toEqual({ ok: false, error: removedText(f.gname) });
    expect(await confirmPayment(f.P.id, f.B)).toEqual({ ok: false, error: removedText(f.gname) });
    expect(await waitingForMe(f.gid, f.B)).toEqual([]);
    expect((await db.payment.findUniqueOrThrow({ where: { id: f.P.id } })).deletedAt).toBeNull();
    expect((await db.member.findUniqueOrThrow({ where: { id: f.V } })).leftAt).not.toBeNull();
  });
});

describe("freeing a name sets freedAt", () => {
  it("releaseGuestName sets it between the before and after times; a refused free leaves it; free-retake-free moves it later; balances unchanged", async () => {
    const f = await flat();
    const balances = await bal(f);
    // A refused free (Varun has left, so frees nothing) leaves it empty.
    expect((await releaseGuestName(f.gid, f.V, f.B)).ok).toBe(false);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.B } })).freedAt).toBeNull();

    const t0 = Date.now();
    expect((await releaseGuestName(f.gid, f.A, f.B)).ok).toBe(true);
    const first = (await db.member.findUniqueOrThrow({ where: { id: f.B } })).freedAt!.getTime();
    expect(first).toBeGreaterThanOrEqual(t0);
    expect(first).toBeLessThanOrEqual(Date.now());
    // Freeing it again, while nobody holds it, is refused and leaves the time alone.
    expect((await releaseGuestName(f.gid, f.A, f.B)).ok).toBe(false);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.B } })).freedAt!.getTime()).toBe(first);

    await new Promise((r) => setTimeout(r, 30));
    await db.member.update({ where: { id: f.B }, data: { claimedAt: new Date() } }); // taken again
    expect((await releaseGuestName(f.gid, f.B, f.B)).ok).toBe(true); // and freed again
    expect((await db.member.findUniqueOrThrow({ where: { id: f.B } })).freedAt!.getTime()).toBeGreaterThan(first);
    expect(await bal(f)).toEqual(balances);
    expect(balances).toEqual(BEFORE);
  });
  it("'Not now' on an invitation counts as freeing", async () => {
    const f = await flat();
    const pat = await account("Pat");
    const row = await db.member.create({ data: { groupId: f.gid, name: "Pat", accountId: pat.id, addedBy: f.A, seenAt: null } });
    const balances = await bal(f);
    expect((await declineInvitation({ id: pat.id, name: "Pat", email: pat.email }, `m:${row.id}`)).ok).toBe(true);
    const after = await db.member.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.accountId).toBeNull();
    expect(after.freedAt).not.toBeNull();
    expect(Math.abs(after.freedAt!.getTime() - Date.now())).toBeLessThan(60_000);
    expect(await bal(f)).toEqual(balances);
  });
  it("undoing a removal keeps freedAt (and an old snapshot without it restores as never freed)", async () => {
    const f = await flat();
    const dan = await db.member.create({ data: { groupId: f.gid, name: "Dan", freedAt: new Date(2026, 5, 1, 10, 0, 0) } }); // a freed name nobody holds
    const removed = await removeMembers(f.gid, f.A, [dan.id], false);
    expect(removed.ok).toBe(true);
    expect(await db.member.count({ where: { id: dan.id } })).toBe(0);
    const line = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.gid, kind: "members_removed" }, orderBy: { createdAt: "desc" } });
    expect((JSON.parse(line.undo!) as { members: { freedAt: string | null }[] }).members[0].freedAt).toBe(new Date(2026, 5, 1, 10, 0, 0).toISOString());
    expect((await undoEvent(line.id, f.A)).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: dan.id } })).freedAt?.getTime()).toBe(new Date(2026, 5, 1, 10, 0, 0).getTime());
    // An older snapshot (written before freedAt was kept) restores as never freed.
    await db.member.delete({ where: { id: dan.id } });
    const old = await db.groupEvent.create({ data: { groupId: f.gid, actorId: f.A, kind: "members_removed", text: "removed Dan", undo: JSON.stringify({ type: "members_restore", members: [{ id: dan.id, name: "Dan", phone: "", createdAt: new Date(2026, 0, 5).toISOString() }] }) } });
    expect((await undoEvent(old.id, f.A)).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: dan.id } })).freedAt).toBeNull();
  });
});

describe("deleting and restoring P, and Undo (phase 2)", () => {
  it("a signed-in new holder of 'Ben' cannot delete P: the new sentence, nothing changes, Varun still left; the payer Varun still can", async () => {
    const f = await flat();
    await freeAndRetake(f);
    await signIn(f);
    const snap = await snapshot(f);
    expect(await setPaymentDeleted(f.P.id, f.B, true, {})).toEqual({ ok: false, error: BEFORE_NAME_TEXT });
    expect(await setPaymentDeleted(f.P.id, f.B, true, { guestRules: true })).toEqual({ ok: false, error: BEFORE_NAME_TEXT });
    expect(await snapshot(f)).toEqual(snap);
    expect(await bal(f)).toEqual(BEFORE);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.V } })).leftAt).not.toBeNull();
    // The payer (Varun, who left) can still delete it: he comes back owing. Ben +40000, Varun -20000, Asha -20000.
    expect((await setPaymentDeleted(f.P.id, f.V, true, {})).ok).toBe(true);
    expect(await bal(f)).toEqual(AFTER_NOT_RECEIVED);
    expect(await sharesSum(f)).toBe(60000);
  });
  it("a guest new holder cannot delete P either (the new sentence, not a sign-in sheet)", async () => {
    const f = await flat();
    await freeAndRetake(f);
    const snap = await snapshot(f);
    const r = await setPaymentDeleted(f.P.id, f.B, true, { guestRules: true });
    expect(r).toEqual({ ok: false, error: BEFORE_NAME_TEXT });
    expect(signinKeyOf(BEFORE_NAME_TEXT)).toBeNull();
    expect(await snapshot(f)).toEqual(snap);
  });
  it("after the earlier holder's Not received: the new holder cannot restore P, and cannot Undo that line; balances stay", async () => {
    const f = await flat();
    expect((await rejectPaymentOf(f)).ok).toBe(true); // the real Ben: Ben +40000, Varun -20000, Asha -20000
    expect(await bal(f)).toEqual(AFTER_NOT_RECEIVED);
    const line = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.gid, paymentId: f.P.id, kind: "payment_deleted" } });
    await freeAndRetake(f);
    await signIn(f);
    const snap = await snapshot(f);
    expect(await setPaymentDeleted(f.P.id, f.B, false, {})).toEqual({ ok: false, error: BEFORE_NAME_TEXT });
    expect(await undoEvent(line.id, f.B)).toEqual({ ok: false, error: receiverOnlyText("Ben") });
    expect(await snapshot(f)).toEqual(snap);
    expect(await bal(f)).toEqual(AFTER_NOT_RECEIVED);
    expect(await sharesSum(f)).toBe(60000);
  });
  it("actorRefusal: a line made at or before the viewer's freedAt is not theirs (Not received restore, and the 10-minute recorder window)", () => {
    const at = new Date(2026, 10, 10, 9, 0, 0);
    const soon = new Date(2026, 10, 10, 9, 1, 0);
    const members = [
      { id: "ben", name: "Ben", accountId: "acc", leftAt: null, removedAt: null },
      { id: "cat", name: "Cat", accountId: "acc2", leftAt: null, removedAt: null },
    ];
    const payments = [{ id: "p1", fromId: "cat", toId: "ben", deletedById: "ben" }];
    const ev = (undo: object, actorId: string) => ({ id: "e1", kind: "payment_deleted", undo: JSON.stringify(undo), undoneAt: null, expenseId: null, paymentId: "p1", createdAt: at, actorId });
    const viewer = { id: "ben", isAdmin: false, closed: false, members, payments };
    const restore = ev({ type: "payment_restore", paymentId: "p1", byReceiver: true }, "ben");
    expect(actorRefusal(restore, { ...viewer, freedAt: null }, soon)).toBeNull(); // the real Ben undoing his own Not received
    expect(actorRefusal(restore, { ...viewer, freedAt: new Date(2026, 10, 11) }, soon)).toBe(receiverOnlyText("Ben")); // the new holder
    expect(actorRefusal(restore, { ...viewer, freedAt: new Date(2026, 10, 9) }, soon)).toBeNull(); // freed before the line
    expect(actorRefusal(restore, { ...viewer, freedAt: at }, soon)).toBe(receiverOnlyText("Ben")); // the same instant: safe side
    // The recorder window: Asha recorded Cat -> Ben for them and may Undo it for 10 minutes; once her name was freed after that, she may not.
    const recorded = ev({ type: "payment_delete", paymentId: "p1" }, "asha");
    const asha = { id: "asha", isAdmin: false, closed: false, members: [...members, { id: "asha", name: "Asha", accountId: "acc3", leftAt: null, removedAt: null }], payments };
    expect(actorRefusal(recorded, { ...asha, freedAt: null }, soon)).toBeNull();
    expect(actorRefusal(recorded, { ...asha, freedAt: new Date(2026, 10, 11) }, soon)).toBe("Only Cat or Ben can change this payment.");
  });
  it("the Activity buttons are hidden by the same rule the server uses", () => {
    const src = readFileSync("src/app/groups/[id]/_components/ActivityTab.tsx", "utf8");
    expect(src).toContain("madeBeforeFreed(v.undoViewer.freedAt, group.payments.find((x) => x.id === item.id)?.createdAt)");
    const buttons = src.split("\n").filter((l) => /\{(!beforeName && )?!?payGate && .*canChange|\{!beforeName && !payGate && isParty/.test(l));
    expect(buttons.length).toBe(4); // Restore and Delete, for a guest and for an account
    for (const l of buttons) expect(l).toContain("!beforeName");
    // And both screens' viewers carry freedAt.
    const view = readFileSync("src/app/groups/[id]/_components/view.ts", "utf8");
    expect(view.match(/freedAt: group\.members\.find/g)?.length).toBe(2);
    expect(readFileSync("src/lib/undo.ts", "utf8")).toContain("freedAt: group.members.find((m) => m.id === actorId)?.freedAt ?? null");
  });
});

describe("looking after the group passes on once the admin's name is freed", () => {
  const m = (id: string, o: Partial<{ claimedAt: Date | null; leftAt: Date | null; freedAt: Date | null }> = {}) => ({ id, claimedAt: new Date(2026, 0, 1) as Date | null, leftAt: null as Date | null, freedAt: null as Date | null, ...o });
  it("pickAdmin (pure): a freed name is passed over; the old rule is unchanged when nothing was freed, and is the fallback", () => {
    expect(pickAdmin([m("a"), m("b"), m("c")])?.id).toBe("a"); // nothing freed: as before
    expect(pickAdmin([m("a", { claimedAt: null, freedAt: new Date(2026, 5, 1) }), m("b"), m("c")])?.id).toBe("b"); // a freed, not retaken
    expect(pickAdmin([m("a", { freedAt: new Date(2026, 5, 1) }), m("b"), m("c")])?.id).toBe("b"); // a freed and retaken
    expect(pickAdmin([m("a", { freedAt: new Date(2026, 5, 1) }), m("b", { leftAt: new Date(2026, 5, 2) })])?.id).toBe("a"); // nobody else: fallback
    expect(pickAdmin([m("a", { claimedAt: null, freedAt: new Date(2026, 5, 1) }), m("b", { leftAt: new Date(2026, 5, 2) })])?.id).toBe("a"); // only a name nobody holds is still here: the old last resort, as before
    expect(pickAdmin([m("a", { claimedAt: null }), m("b")])?.id).toBe("b"); // a name never taken: as before
  });
  it("Asha (a guest admin) frees her own name: Ben looks after the group; Cat retakes 'Asha' and signs in: not admin", async () => {
    const cat = await account("Cat");
    const g = await db.group.create({
      data: {
        name: `Admin ${++n} ${stamp}`, inviteCode: `fa-${n}-${stamp}`, type: "trip", currency: "INR",
        members: {
          create: [
            { name: "Asha", claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1), seenAt: new Date(2026, 0, 1) },
            { name: "Ben", claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2), seenAt: new Date(2026, 0, 2) },
            { name: "Dee", claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3), seenAt: new Date(2026, 0, 3) },
          ],
        },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = (name: string) => g.members.find((x) => x.name === name)!.id;
    const [asha, ben] = [id("Asha"), id("Ben")];
    expect(await groupAdminId(g.id)).toBe(asha); // no freed names: unchanged
    expect((await releaseGuestName(g.id, asha, asha)).ok).toBe(true);
    expect(await groupAdminId(g.id)).toBe(ben);
    await db.member.update({ where: { id: asha }, data: { claimedAt: new Date(), accountId: cat.id } }); // Cat takes "Asha" and signs in
    expect(await groupAdminId(g.id)).toBe(ben);
    expect(await isGroupAdmin(g.id, asha)).toBe(false);
    expect(await isGroupAdmin(g.id, ben)).toBe(true);
    // The admin-only doors read the same answer: Cat cannot free someone else's name.
    expect(await releaseGuestName(g.id, asha, id("Dee"))).toEqual({ ok: false, error: "Only the person who looks after this group can free someone else’s name." });
    expect((await db.member.findUniqueOrThrow({ where: { id: id("Dee") } })).claimedAt).not.toBeNull();
  });
});

describe("the static rules still hold", () => {
  it("the schema column is add-only and nullable, and the rules notes say so", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const member = schema.slice(schema.indexOf("model Member {"), schema.indexOf("model Expense {"));
    expect(member).toMatch(/\n\s*freedAt DateTime\? \/\/ when this name was last freed/);
    for (const name of ["confirmPaymentAction", "rejectPaymentAction", "removePayment", "restorePayment", "undoChange"]) {
      expect(rules.ACTION_RULES[name].note, name).toContain("before the name was last freed");
    }
  });
});
