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
const { joinExistingAsGuest } = await import("@/lib/join");
const { settleAllAndClose, markAllPaid, planKey, setPaymentsDeleted, applySettleAll } = await import("@/lib/settle-all");
const { loadGroup } = await import("@/lib/group-data");
const pot = await import("@/lib/pot-db");
const { payLinkFor, readPayLink, recordLinkPayment } = await import("@/lib/pay-link");
const { inviteToClaim, inviteByEmail, cancelInvitation, CANCEL_NOT_ALLOWED, EARLIER_HOLDER_INVITE_TEXT, waitingNote, sentByMe, inviteRowLabel } = await import("@/lib/invites");
process.env.MAIL_OUTBOX = "1"; // invitation emails go to the test outbox, never out
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
async function flat(payAgo = MIN, withMoveOut = true) {
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
  // withMoveOut = false: just the dinner (Ben +40000, Varun -20000, Asha -20000), nobody has left, no P.
  const P = withMoveOut ? await db.payment.create({ data: { groupId: g.id, fromId: V, toId: B, amount: 20000, createdById: A, needsOk: true, createdAt: new Date(Date.now() - payAgo) } }) : (undefined as never);
  if (withMoveOut) {
    await markAsMoveOut(g.id, A, [P.id]);
    await db.member.update({ where: { id: V }, data: { leftAt: new Date(Date.now() - payAgo) } });
  }
  return { g, gid: g.id, gname: g.name, code: g.inviteCode, A, B, V, P, asha };
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
  lines: (await db.groupEvent.findMany({ where: { groupId: f.gid }, orderBy: { id: "asc" }, select: { id: true, undoneAt: true, undoneById: true } })).map((e) => ({ id: e.id, undone: e.undoneAt?.getTime() ?? null, by: e.undoneById })), // who undid what
  closed: (await db.group.findUniqueOrThrow({ where: { id: f.gid }, select: { closed: true } })).closed,
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

// Cat takes the name "Ben": the row is freed (the real code), then taken again as a guest through the real join, optionally signing in later.
const pause = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function retake(f: Flat) {
  await pause();
  const joined = await joinExistingAsGuest(f.code, f.B);
  expect(joined).toEqual({ ok: true, memberId: f.B });
  await pause();
}
async function freeAndRetake(f: Flat) {
  expect((await releaseGuestName(f.gid, f.A, f.B)).ok).toBe(true);
  await retake(f);
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
    await retake(f); // Cat takes the name through the real join

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
    await retake(f);
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
    expect(await undoEvent(line.id, f.B)).toEqual({ ok: false, error: BEFORE_NAME_TEXT }); // the earlier holder's payment: said first
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
    expect(await joinExistingAsGuest(g.inviteCode, asha)).toEqual({ ok: true, memberId: asha }); // Cat takes "Asha" through the real join...
    await db.member.update({ where: { id: asha }, data: { accountId: cat.id } }); // ...and signs in
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

// ---------------------------------------------------------------------------------------------------------------
// Round 2: sets of payments, card games, the admin rule "as if they had left", pay links, own-row lines, the write itself.

describe("Settle everything / Mark all paid: undo and redo by the new holder of a freed name", () => {
  const allIds = async (f: Flat) => (await db.payment.findMany({ where: { groupId: f.gid }, select: { id: true } })).map((p) => p.id);
  it("Asha settles everything (Varun>Ben 20000, Asha>Ben 20000, group closes); Ben freed, Cat takes 'Ben' and signs in: Undo is refused, nothing changes; Asha still can", async () => {
    const f = await flat(MIN, false);
    expect(await bal(f)).toEqual(BEFORE_DINNER);
    const transfers = (await loadGroup(f.gid, { events: false }))!.transfers;
    expect(planKey(transfers)).toBe([`${f.V}>${f.B}:20000`, `${f.A}>${f.B}:20000`].sort().join("|")); // each of the two owes Ben 20000
    const done = await settleAllAndClose(f.gid, f.A, planKey(transfers));
    if (!done.ok) throw new Error(done.error);
    expect(await bal(f)).toEqual({ Ben: 0, Varun: 0, Asha: 0 }); // 40000 - 20000 - 20000, -20000 + 20000, -20000 + 20000
    expect((await db.group.findUniqueOrThrow({ where: { id: f.gid } })).closed).toBe(true);

    await freeAndRetake(f);
    await signIn(f);
    const snap = await snapshot(f);
    expect(snap.closed).toBe(true);
    expect(await undoEvent(done.eventId!, f.B)).toEqual({ ok: false, error: BEFORE_NAME_TEXT });
    expect(await applySettleAll(f.gid, f.B, await allIds(f), false)).toEqual({ ok: false, error: BEFORE_NAME_TEXT }); // the server door itself
    expect(await snapshot(f)).toEqual(snap); // payments, group still closed, history, balances 0 / 0 / 0
    expect(await bal(f)).toEqual({ Ben: 0, Varun: 0, Asha: 0 });

    // Asha (the other party, never freed, and who recorded it) keeps her rights: the payments come out and the group reopens.
    expect((await undoEvent(done.eventId!, f.A)).ok).toBe(true);
    expect(await bal(f)).toEqual(BEFORE_DINNER);
    expect((await db.group.findUniqueOrThrow({ where: { id: f.gid } })).closed).toBe(false);
    expect(await sharesSum(f)).toBe(60000);
  });
  it("redo: the earlier Ben undid a 'Mark all paid'; Cat (new holder, signed in) cannot redo it; nothing changes", async () => {
    const f = await flat(MIN, false);
    const made = await markAllPaid(f.gid, f.A, [{ from: f.V, to: f.B, amount: 20000 }, { from: f.A, to: f.B, amount: 20000 }], "Test", true);
    if (!made.ok) throw new Error(made.error);
    expect(await bal(f)).toEqual({ Ben: 0, Varun: 0, Asha: 0 });
    const undone = await undoEvent(made.eventId!, f.B); // the real Ben takes them off (he is in both)
    if (!undone.ok) throw new Error(undone.error);
    expect(await bal(f)).toEqual(BEFORE_DINNER);
    await freeAndRetake(f);
    await signIn(f);
    const snap = await snapshot(f);
    expect(await undoEvent(undone.eventId!, f.B)).toEqual({ ok: false, error: BEFORE_NAME_TEXT }); // Redo
    expect(await setPaymentsDeleted(f.gid, f.B, await allIds(f), false)).toEqual({ ok: false, error: BEFORE_NAME_TEXT });
    expect(await snapshot(f)).toEqual(snap);
    expect(await bal(f)).toEqual(BEFORE_DINNER); // Ben +40000, Varun -20000, Asha -20000
    expect(await sharesSum(f)).toBe(60000);
  });
  it("the 10-minute recorder window through undoEvent: Asha records Varun>Ben for them and may Undo it inside 10 minutes, not after", async () => {
    const f = await flat(MIN, false);
    const made = await markAllPaid(f.gid, f.A, [{ from: f.V, to: f.B, amount: 20000 }], "Test", true);
    if (!made.ok) throw new Error(made.error);
    expect(await bal(f)).toEqual({ Ben: 20000, Varun: 0, Asha: -20000 }); // Ben +40000 -20000, Varun -20000 +20000
    await db.groupEvent.update({ where: { id: made.eventId! }, data: { createdAt: new Date(Date.now() - 11 * MIN) } }); // 11 minutes ago
    const late = await snapshot(f);
    expect(await undoEvent(made.eventId!, f.A)).toEqual({ ok: false, error: "Only the people in each payment can take these off." }); // Asha is not in Varun>Ben
    expect(await snapshot(f)).toEqual(late);
    const g = await flat(MIN, false);
    const again = await markAllPaid(g.gid, g.A, [{ from: g.V, to: g.B, amount: 20000 }], "Test", true);
    if (!again.ok) throw new Error(again.error);
    expect((await undoEvent(again.eventId!, g.A)).ok).toBe(true); // inside the window
    expect(await bal(g)).toEqual(BEFORE_DINNER);
  });
});
const BEFORE_DINNER = { Ben: 40000, Varun: -20000, Asha: -20000 }; // just the dinner

describe("card games: the host and the line owner must be the holder who made them", () => {
  const potBalances = async (gid: string) => {
    const members = await db.member.findMany({ where: { groupId: gid }, select: { id: true } });
    const [expenses, payments] = await Promise.all([db.expense.findMany({ where: { groupId: gid, deletedAt: null }, include: { shares: true } }), db.payment.findMany({ where: { groupId: gid, deletedAt: null } })]);
    return netBalances(members.map((m) => m.id), expenses, payments);
  };
  it("canRunGame (pure): a host whose name was freed after the game started is not the host; freed before, or never, is", () => {
    const d = (day: number) => new Date(2026, 10, day);
    const me = (freedAt: Date | null) => [{ id: "ben", claimedAt: d(1), leftAt: null, accountId: null, freedAt }];
    expect(pot.canRunGame({ hostId: "ben", createdAt: d(10) }, me(d(12)), "ben")).toBe(false);
    expect(pot.canRunGame({ hostId: "ben", createdAt: d(10) }, me(d(10)), "ben")).toBe(false); // the same instant: safe side
    expect(pot.canRunGame({ hostId: "ben", createdAt: d(10) }, me(d(8)), "ben")).toBe(true);
    expect(pot.canRunGame({ hostId: "ben", createdAt: d(10) }, me(null), "ben")).toBe(true);
  });
  it("Ben hosts a finished game and an open one; Ben freed, Cat retakes and signs in: she can't reopen, take back Ben's lines, finish or delete; results unchanged; a never-freed host still can", async () => {
    const g = await db.group.create({
      data: { name: `Cards ${++n} ${stamp}`, type: "pot", currency: "INR", inviteCode: `fp-${n}-${stamp}`, members: { create: [{ name: "Ben", claimedAt: new Date(2026, 0, 2) }, { name: "Bina" }, { name: "Chirag" }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = (name: string) => g.members.find((m) => m.name === name)!.id;
    const [ben, bina, chirag] = [id("Ben"), id("Bina"), id("Chirag")];
    const players = [ben, bina, chirag];
    const start = async (by: string, name: string, who = players) => {
      const s = await pot.startGame(g.id, by, { name, game: "cards", players: who });
      if (!s.ok) throw new Error(s.error);
      return s.id;
    };
    // Game 1: everyone takes 1000 (3000 in), Ben puts back 2000, Bina 1000, Chirag 0 (3000 out). Ben +1000, Bina 0, Chirag -1000 = +100000 / 0 / -100000 paise.
    const g1 = await start(ben, "Friday");
    for (const who of players) expect((await pot.recordMove(g1, ben, { memberId: who, kind: "take", amount: "1000" })).ok).toBe(true);
    for (const [who, amt] of [[ben, "2000"], [bina, "1000"], [chirag, "0"]] as const) expect((await pot.recordMove(g1, ben, { memberId: who, kind: "return", amount: amt })).ok).toBe(true);
    expect((await pot.finishGame(g1, ben)).ok).toBe(true);
    const original = { [ben]: 100000, [bina]: 0, [chirag]: -100000 };
    expect(await potBalances(g.id)).toEqual(original);
    // Game 2 is still open, with a chip line Ben made.
    const g2 = await start(ben, "Saturday");
    expect((await pot.recordMove(g2, ben, { memberId: ben, kind: "take", amount: "500" })).ok).toBe(true);
    const line = await db.potMove.findFirstOrThrow({ where: { gameId: g2, createdById: ben } });

    expect((await releaseGuestName(g.id, ben, ben)).ok).toBe(true);
    await pause();
    expect(await joinExistingAsGuest(g.inviteCode, ben)).toEqual({ ok: true, memberId: ben });
    await db.member.update({ where: { id: ben }, data: { accountId: (await account("Cat")).id } });
    await pause();

    const refused = async (r: Promise<{ ok: boolean; error?: string }>, re: RegExp) => {
      const x = await r;
      expect(x.ok).toBe(false);
      expect(x.error).toMatch(re);
    };
    await refused(pot.reopenGame(g1, ben), /^Only the host can reopen the game/);
    await refused(pot.deleteGame(g2, ben), /^Only the host can delete the game/);
    await refused(pot.finishGame(g2, ben), /^Only the host can finish the game/);
    await refused(pot.finishGame(g1, ben), /^Only the host can finish the game/); // "refinish"
    await refused(pot.removeMove(line.id, ben), /^Only whoever added it, or the host, can take it back/);
    await refused(pot.adjustGap(g2, ben, { mode: "spread" }), /^Only the host can fix the difference/);
    expect(await potBalances(g.id)).toEqual(original);
    expect((await db.potGame.findUniqueOrThrow({ where: { id: g1 } })).status).toBe("done");
    expect((await db.potGame.findUniqueOrThrow({ where: { id: g2 } })).deletedAt).toBeNull();
    expect((await db.potMove.findUniqueOrThrow({ where: { id: line.id } })).deletedAt).toBeNull();
    expect((await db.expense.findFirstOrThrow({ where: { groupId: g.id, kind: "pot" } })).amount).toBe(100000);

    // Her own new line is hers: she can take it back.
    expect((await pot.recordMove(g2, ben, { memberId: ben, kind: "take", amount: "100" })).ok).toBe(true);
    const mine = await db.potMove.findFirstOrThrow({ where: { gameId: g2, createdById: ben, amount: { not: line.amount } } });
    expect((await pot.removeMove(mine.id, ben)).ok).toBe(true);

    // A host who never had the name freed still runs their game: game 3 (Chirag hosts): in 100 each, Chirag back 150, Bina 50 -> Chirag +50, Bina -50.
    const g3 = await start(chirag, "Sunday", [chirag, bina]);
    for (const who of [chirag, bina]) expect((await pot.recordMove(g3, chirag, { memberId: who, kind: "take", amount: "100" })).ok).toBe(true);
    expect((await pot.recordMove(g3, chirag, { memberId: chirag, kind: "return", amount: "150" })).ok).toBe(true);
    expect((await pot.recordMove(g3, chirag, { memberId: bina, kind: "return", amount: "50" })).ok).toBe(true);
    expect((await pot.finishGame(g3, chirag)).ok).toBe(true);
    expect(await potBalances(g.id)).toEqual({ [ben]: 100000, [bina]: -5000, [chirag]: -95000 }); // Chirag -100000 + 5000, Bina 0 - 5000
    expect((await pot.reopenGame(g3, chirag)).ok).toBe(true);
    expect((await pot.deleteGame(g3, chirag)).ok).toBe(true);
    expect(await potBalances(g.id)).toEqual(original);
  });
});

describe("looking after the group: 'as if they had left', exactly", () => {
  it("Zed creates and adds Ravi (opened, never took a name); Zed leaves; Asha (guest) looks after it; Asha frees her name; Cat takes 'Asha': Ravi looks after it, not Cat", async () => {
    const [zed, ravi, cat] = [await account("Zed"), await account("Ravi"), await account("Cat")];
    const g = await db.group.create({
      data: {
        name: `Zed ${++n} ${stamp}`, inviteCode: `fz-${n}-${stamp}`, type: "trip", currency: "INR",
        members: {
          create: [
            { name: "Zed", accountId: zed.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1), seenAt: new Date(2026, 0, 1) },
            { name: "Asha", claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2), seenAt: new Date(2026, 0, 2) },
            { name: "Ravi", accountId: ravi.id, addedBy: "zed", seenAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3) }, // opened the group: not pending, claimedAt empty
          ],
        },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = (name: string) => g.members.find((m) => m.name === name)!.id;
    const [zedId, asha, raviId] = [id("Zed"), id("Asha"), id("Ravi")];
    await db.member.update({ where: { id: zedId }, data: { leftAt: new Date() } });
    expect(await groupAdminId(g.id)).toBe(asha); // the old rule: the first who took a name and has not left
    expect((await releaseGuestName(g.id, asha, asha)).ok).toBe(true);
    expect(await joinExistingAsGuest(g.inviteCode, asha)).toEqual({ ok: true, memberId: asha });
    await db.member.update({ where: { id: asha }, data: { accountId: cat.id } });
    // As if Asha had left: of Zed (left) and Ravi, the old rule picks Ravi (nobody took a name, so the first still here).
    expect(await groupAdminId(g.id)).toBe(raviId);
    expect(await isGroupAdmin(g.id, asha)).toBe(false);
    expect(await isGroupAdmin(g.id, raviId)).toBe(true);
  });
  it("pickAdmin (pure): the old rule on people never freed; only when nobody is left there, the old rule on everyone", () => {
    const m = (id: string, o: Partial<{ claimedAt: Date | null; leftAt: Date | null; freedAt: Date | null }> = {}) => ({ id, claimedAt: null as Date | null, leftAt: null as Date | null, freedAt: null as Date | null, ...o });
    const day = new Date(2026, 5, 1);
    expect(pickAdmin([m("zed", { leftAt: day }), m("asha", { claimedAt: day, freedAt: day }), m("ravi")])?.id).toBe("ravi"); // not Asha, who took her name again
    expect(pickAdmin([m("asha", { claimedAt: day, freedAt: day }), m("zed", { leftAt: day })])?.id).toBe("asha"); // nobody else here: everyone
  });
});

describe("pay links stop working when a name is freed", () => {
  // The dinner (Ben +40000, Varun -20000, Asha -20000) and Lunch 100000 paid by Asha, split Asha / Ben 50000 each (Asha +50000, Ben -50000):
  // Ben -10000, Varun -20000, Asha +30000 (sum 0). The settle plan: Ben owes Asha 10000, Varun owes Asha 20000.
  async function owing() {
    const f = await flat(MIN, false);
    await db.expense.create({ data: { groupId: f.gid, description: "Lunch", splitType: "equal", amount: 100000, originalAmount: 100000, convertedAmount: 100000, paidById: f.A, createdById: f.A, shares: { create: [{ memberId: f.A, amount: 50000 }, { memberId: f.B, amount: 50000 }] } } });
    return f;
  }
  it("the link Ben>Asha works; Asha frees Ben; the link is gone and records nothing", async () => {
    const f = await owing();
    const token = await payLinkFor(f.gid, f.B, f.A, f.A);
    const state = await readPayLink(token);
    expect(state.kind).toBe("owes");
    expect(state.kind === "owes" && state.amount).toBe(10000);
    const paymentsBefore = await db.payment.count({ where: { groupId: f.gid } });
    expect((await releaseGuestName(f.gid, f.A, f.B)).ok).toBe(true);
    expect(await db.payLink.count({ where: { token } })).toBe(0);
    expect(await readPayLink(token)).toEqual({ kind: "gone" });
    expect(await recordLinkPayment(state as never)).toBe(false); // the tap on the old page records nothing
    expect(await db.payment.count({ where: { groupId: f.gid } })).toBe(paymentsBefore);
    // Asking for a new link for the pair makes a NEW token (the old one is not revived).
    expect(await payLinkFor(f.gid, f.B, f.A, f.A)).not.toBe(token);
  });
  it("a link where the freed name is the payer goes too, and 'Not now' on an invitation does the same", async () => {
    const f = await flat(MIN, false);
    const t1 = await payLinkFor(f.gid, f.B, f.A, f.A); // from Ben
    expect((await releaseGuestName(f.gid, f.A, f.B)).ok).toBe(true);
    expect(await db.payLink.count({ where: { token: t1 } })).toBe(0);
    const pat = await account("Pat");
    const row = await db.member.create({ data: { groupId: f.gid, name: "Pat", accountId: pat.id, addedBy: f.A, seenAt: null } });
    const t2 = await payLinkFor(f.gid, row.id, f.A, f.A);
    const other = await payLinkFor(f.gid, f.V, f.A, f.A); // somebody else's link is left alone
    expect((await declineInvitation({ id: pat.id, name: "Pat", email: pat.email }, `m:${row.id}`)).ok).toBe(true);
    expect(await db.payLink.count({ where: { token: t2 } })).toBe(0);
    expect(await db.payLink.count({ where: { token: other } })).toBe(1);
  });
});

describe("undoing a line about your own row (leave, rejoin, rename) made by the earlier holder", () => {
  it("earlier Ben's 'rejoined' line cannot be undone by Cat (real undoEvent); the real Ben still can", async () => {
    const f = await flat(MIN, false);
    const line = await db.groupEvent.create({ data: { groupId: f.gid, actorId: f.B, kind: "member_rejoined", text: "rejoined the group", undo: JSON.stringify({ type: "member_set", memberId: f.B, data: { leftAt: new Date().toISOString() } }) } });
    await freeAndRetake(f);
    await signIn(f);
    const snap = await snapshot(f);
    expect(await undoEvent(line.id, f.B)).toEqual({ ok: false, error: "Only Ben can undo rejoining the group." });
    expect(await snapshot(f)).toEqual(snap);
  });
  it("actorRefusal (pure): the line is the viewer's own only if made after the viewer's freedAt", () => {
    const at = new Date(2026, 10, 10, 9, 0, 0);
    const members = [{ id: "ben", name: "Ben", accountId: "acc", leftAt: null, removedAt: null }];
    const ev = { id: "e1", kind: "member_rejoined", undo: JSON.stringify({ type: "member_set", memberId: "ben", data: { leftAt: at.toISOString() } }), undoneAt: null, expenseId: null, paymentId: null, createdAt: at, actorId: "ben" };
    const viewer = { id: "ben", isAdmin: false, closed: false, members };
    expect(actorRefusal(ev, { ...viewer, freedAt: null }, at)).toBeNull();
    expect(actorRefusal(ev, { ...viewer, freedAt: new Date(2026, 10, 11) }, at)).toBe("Only Ben can undo rejoining the group.");
    expect(actorRefusal(ev, { ...viewer, freedAt: new Date(2026, 10, 9) }, at)).toBeNull();
  });
});

describe("the write itself checks again (Got it / Not received)", () => {
  it("both transactions re-read the name before writing (a freeing between the first look and the write cannot slip through)", () => {
    const src = readFileSync("src/lib/payment-ok.ts", "utf8");
    expect(src.match(/await recheckAnswerer\(tx, myMemberId!, p\);/g)?.length).toBe(2);
    expect(src).toContain("if (err instanceof NotYours) return { ok: false, error: err.message };");
    // And the set paths ask inside the write too.
    const settle = readFileSync("src/lib/settle-all.ts", "utf8");
    expect(settle.match(/beforeNameRefusal\(tx, paymentIds, actorId, groupId\)/g)?.length).toBe(2);
    expect(readFileSync("src/lib/payments.ts", "utf8")).toContain("const early = await beforeNameRefusal(tx, ids, actorId, groupId);");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Round 3: email invitations, the card-game page rule, the host's freeing as "left", guest sign-in order, "Not now", the write's rollback.

describe("email invitations belong to the holder who sent them", () => {
  const d = (day: number) => new Date(2026, 10, day);
  it("sentByMe and the People / Invite screens' words (pure)", () => {
    const inv = { invitedById: "ben", createdAt: d(10) };
    expect(sentByMe(inv, "ben", null)).toBe(true); // never freed
    expect(sentByMe(inv, "ben", d(8))).toBe(true); // freed before it was sent
    expect(sentByMe(inv, "ben", d(12))).toBe(false); // freed after: the earlier holder's
    expect(sentByMe(inv, "ben", d(10))).toBe(false); // the same instant: safe side
    expect(sentByMe(inv, "asha", null)).toBe(false);
    expect(inviteRowLabel({ email: "priya@example.test", invitedById: "ben", createdAt: d(10) }, "ben", "Ben")).toBe("priya@example.test");
    expect(inviteRowLabel({ email: "priya@example.test", invitedById: "ben", createdAt: d(10) }, "ben", "Ben", d(12))).toBe("Invited by Ben"); // the address is not shown to the new holder
  });
  it("Ben (account) invites Priya by email, deletes his account; Asha frees 'Ben'; Cat takes it and signs in: Cat can neither cancel nor redirect it; Asha still can", async () => {
    const [asha, ben, cat] = [await account("Asha"), await account("Ben"), await account("Cat")];
    const g = await db.group.create({
      data: {
        name: `Invites ${++n} ${stamp}`, inviteCode: `fi-${n}-${stamp}`, type: "trip", currency: "INR",
        members: {
          create: [
            { name: "Asha", accountId: asha.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
            { name: "Ben", accountId: ben.id, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) },
            { name: "Priya", createdAt: new Date(2026, 0, 3) },
          ],
        },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = (name: string) => g.members.find((m) => m.name === name)!.id;
    const [A, B, P] = [id("Asha"), id("Ben"), id("Priya")];
    const sent = await inviteToClaim(g.id, B, P, "priya@example.test", "https://loopin.test");
    expect(sent).toEqual({ ok: true, email: "priya@example.test" });
    // Ben deletes his account: the row keeps its name and its claim, loses the account (the same write auth.ts makes when an account is deleted).
    await db.member.updateMany({ where: { accountId: ben.id }, data: { accountId: null, grantEpoch: { increment: 1 } } });
    expect((await releaseGuestName(g.id, A, B)).ok).toBe(true);
    await pause();
    expect(await joinExistingAsGuest(g.inviteCode, B)).toEqual({ ok: true, memberId: B });
    await db.member.update({ where: { id: B }, data: { accountId: cat.id } });

    const invites = async () => (await db.invite.findMany({ where: { groupId: g.id }, orderBy: { id: "asc" }, select: { id: true, email: true, invitedById: true, declinedAt: true, acceptedAt: true, token: true, memberId: true } })).map((i) => ({ ...i, declinedAt: i.declinedAt?.getTime() ?? null }));
    const before = await invites();
    expect(before.length).toBe(1);
    const events = await db.groupEvent.count({ where: { groupId: g.id } });
    expect(await cancelInvitation(g.id, B, P)).toEqual({ ok: false, error: CANCEL_NOT_ALLOWED });
    expect(await inviteToClaim(g.id, B, P, "cat@example.test", "https://loopin.test")).toEqual({ ok: false, error: EARLIER_HOLDER_INVITE_TEXT }); // not "Only Ben…": that is the viewer's own name
    expect(await invites()).toEqual(before); // still open, still Priya's address
    expect(await db.groupEvent.count({ where: { groupId: g.id } })).toBe(events);
    // Asha looks after the group and keeps her right to cancel.
    expect(await cancelInvitation(g.id, A, P)).toEqual({ ok: true, cancelled: 1 });
  });
});

describe("the host's freeing counts as the host having left; guest order; 'Not now'; the write's rollback", () => {
  it("canRunGame (pure): the admin may step in at once when the host's name was freed after the game started (not while an active host is still the host)", () => {
    const d = (day: number) => new Date(2026, 10, day);
    const people = (benFreed: Date | null) => [
      { id: "bina", claimedAt: d(1), leftAt: null, accountId: null, freedAt: null },
      { id: "ben", claimedAt: d(1), leftAt: null, accountId: null, freedAt: benFreed },
    ];
    const game = { hostId: "ben", createdAt: d(10), lastActivityAt: new Date() }; // active just now
    expect(pot.canRunGame(game, people(d(12)), "bina")).toBe(true); // host freed after the game started: as if left
    expect(pot.canRunGame(game, people(d(8)), "bina")).toBe(false); // freed before the game: Ben really is the host, and active
    expect(pot.canRunGame(game, people(null), "bina")).toBe(false);
  });
  it("a guest new holder is told the payment is from before they took the name (not the sign-in prompt), through undoEvent with guestRules", async () => {
    const f = await flat(MIN, false);
    const transfers = (await loadGroup(f.gid, { events: false }))!.transfers;
    const done = await settleAllAndClose(f.gid, f.A, planKey(transfers));
    if (!done.ok) throw new Error(done.error);
    await freeAndRetake(f); // Cat is a guest: no sign-in
    const snap = await snapshot(f);
    expect(await undoEvent(done.eventId!, f.B, "Asia/Kolkata", { guestRules: true })).toEqual({ ok: false, error: BEFORE_NAME_TEXT });
    expect(signinKeyOf(BEFORE_NAME_TEXT)).toBeNull();
    // An earlier-holder line of another kind still gets the sign-in prompt, as before.
    const line = await db.groupEvent.create({ data: { groupId: f.gid, actorId: f.A, kind: "expense_added", text: "added Tea", undo: JSON.stringify({ type: "expense_delete", expenseId: "x" }), expenseId: "x" } });
    expect(await undoEvent(line.id, f.B, "Asia/Kolkata", { guestRules: true })).toEqual({ ok: false, error: GUEST_REFUSAL });
    await db.groupEvent.delete({ where: { id: line.id } });
    expect(await snapshot(f)).toEqual(snap);
  });
  it("'Not now' tapped a second time touches nothing (the card is gone, a link made since stays)", async () => {
    const f = await flat(MIN, false);
    const pat = await account("Pat");
    const row = await db.member.create({ data: { groupId: f.gid, name: "Pat", accountId: pat.id, addedBy: f.A, seenAt: null } });
    const first = await payLinkFor(f.gid, row.id, f.A, f.A);
    expect((await declineInvitation({ id: pat.id, name: "Pat", email: pat.email }, `m:${row.id}`)).ok).toBe(true);
    expect(await db.payLink.count({ where: { token: first } })).toBe(0);
    const freed = (await db.member.findUniqueOrThrow({ where: { id: row.id } })).freedAt!.getTime();
    // Nobody holds the row any more: a link made for the plain name now, and a stale second "Not now", must leave it alone.
    const again = await payLinkFor(f.gid, row.id, f.A, f.A);
    expect((await declineInvitation({ id: pat.id, name: "Pat", email: pat.email }, `m:${row.id}`)).ok).toBe(false); // the card is gone: the existing answer
    expect(await db.payLink.count({ where: { token: again } })).toBe(1);
    expect((await db.member.findUniqueOrThrow({ where: { id: row.id } })).freedAt!.getTime()).toBe(freed);
  });
  it("a freeing that lands between the first look and the write: the write refuses, rolls back, and even the 'undone' mark is not kept", async () => {
    // Settle everything, then Ben (not yet freed) tries to undo it; his own name is freed after the first checks and before the write.
    const f = await flat(MIN, false);
    const transfers = (await loadGroup(f.gid, { events: false }))!.transfers;
    const done = await settleAllAndClose(f.gid, f.A, planKey(transfers));
    if (!done.ok) throw new Error(done.error);
    const ids = (await db.payment.findMany({ where: { groupId: f.gid }, select: { id: true } })).map((p) => p.id);
    const before = await snapshot(f);
    const r = await applySettleAll(f.gid, f.B, ids, false, {
      mark: { eventId: done.eventId!, actorId: f.B },
      afterRead: async () => {
        expect((await releaseGuestName(f.gid, f.B, f.B)).ok).toBe(true);
      },
    });
    expect(r).toEqual({ ok: false, error: BEFORE_NAME_TEXT });
    const after = await snapshot(f);
    expect(after.payments).toEqual(before.payments); // none taken out
    expect(after.closed).toBe(true); // still closed
    expect(after.balances).toEqual({ Ben: 0, Varun: 0, Asha: 0 });
    expect(after.lines.find((l) => l.id === done.eventId)).toEqual({ id: done.eventId, undone: null, by: null }); // the mark was rolled back too
    expect(after.events).toBe(before.events + 1); // only the freeing's own line

    // The same for a Mark all paid taken off.
    const g = await flat(MIN, false);
    const made = await markAllPaid(g.gid, g.A, [{ from: g.V, to: g.B, amount: 20000 }, { from: g.A, to: g.B, amount: 20000 }], "Test", true);
    if (!made.ok) throw new Error(made.error);
    const gids = (await db.payment.findMany({ where: { groupId: g.gid }, select: { id: true } })).map((p) => p.id);
    const gb = await snapshot(g);
    const r2 = await setPaymentsDeleted(g.gid, g.B, gids, true, {
      mark: { eventId: made.eventId!, actorId: g.B },
      afterRead: async () => {
        expect((await releaseGuestName(g.gid, g.B, g.B)).ok).toBe(true);
      },
    });
    expect(r2).toEqual({ ok: false, error: BEFORE_NAME_TEXT });
    const ga = await snapshot(g);
    expect(ga.payments).toEqual(gb.payments);
    expect(ga.balances).toEqual({ Ben: 0, Varun: 0, Asha: 0 }); // 40000 - 20000 - 20000, -20000 + 20000, -20000 + 20000
    expect(ga.lines.find((l) => l.id === made.eventId)).toEqual({ id: made.eventId, undone: null, by: null });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Round 4: re-sending an invitation, wording for the new holder, the "Not now" race.

describe("re-sending an invitation of an earlier holder", () => {
  const ORIGIN = "https://loopin.test";
  // Asha (account, looks after it), Ben (account), Priya (a name), Dee (account). Ben invites priya@ for "Priya".
  async function scene(freeBen: boolean) {
    const [asha, ben, dee, cat] = [await account("Asha"), await account("Ben"), await account("Dee"), await account("Cat")];
    const g = await db.group.create({
      data: {
        name: `Resend ${++n} ${stamp}`, inviteCode: `fr4-${n}-${stamp}`, type: "trip", currency: "INR",
        members: {
          create: [
            { name: "Asha", accountId: asha.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
            { name: "Ben", accountId: ben.id, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) },
            { name: "Priya", createdAt: new Date(2026, 0, 3) },
            { name: "Dee", accountId: dee.id, claimedAt: new Date(2026, 0, 4), createdAt: new Date(2026, 0, 4) },
          ],
        },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = (name: string) => g.members.find((m) => m.name === name)!.id;
    const f = { g, A: id("Asha"), B: id("Ben"), P: id("Priya"), D: id("Dee") };
    expect(await inviteToClaim(g.id, f.B, f.P, "priya@example.test", ORIGIN)).toEqual({ ok: true, email: "priya@example.test" });
    if (freeBen) {
      await db.member.updateMany({ where: { accountId: ben.id }, data: { accountId: null, grantEpoch: { increment: 1 } } });
      expect((await releaseGuestName(g.id, f.A, f.B)).ok).toBe(true);
      await pause();
      expect(await joinExistingAsGuest(g.inviteCode, f.B)).toEqual({ ok: true, memberId: f.B });
      await db.member.update({ where: { id: f.B }, data: { accountId: cat.id } });
    }
    return f;
  }
  const inv = (gid: string) => db.invite.findFirstOrThrow({ where: { groupId: gid, email: "priya@example.test" } });

  it("Dee (not the admin) re-sends priya@ after Ben's name was freed: it is Dee's now; Cat cannot cancel or redirect it", async () => {
    const f = await scene(true);
    await pause();
    await inviteByEmail(f.g.id, f.D, "priya@example.test", ORIGIN);
    expect((await inv(f.g.id)).invitedById).toBe(f.D);
    expect(await cancelInvitation(f.g.id, f.B, f.P)).toEqual({ ok: false, error: CANCEL_NOT_ALLOWED });
    expect(await inviteToClaim(f.g.id, f.B, f.P, "cat@example.test", ORIGIN)).toEqual({ ok: false, error: "Priya is already invited (by Dee). Only Dee or the person who looks after the group can change that." });
    expect((await inv(f.g.id)).declinedAt).toBeNull();
  });
  it("Asha re-sends it (inviteByEmail, and the inviteToClaim variant): invitedById is Asha; Cat still cannot cancel or redirect", async () => {
    const f = await scene(true);
    await pause();
    await inviteByEmail(f.g.id, f.A, "priya@example.test", ORIGIN);
    expect((await inv(f.g.id)).invitedById).toBe(f.A);
    const g = await scene(true);
    await pause();
    expect(await inviteToClaim(g.g.id, g.A, g.P, "priya@example.test", ORIGIN)).toEqual({ ok: true, email: "priya@example.test" });
    expect((await inv(g.g.id)).invitedById).toBe(g.A); // not left with the earlier Ben
    for (const x of [f, g]) {
      expect(await cancelInvitation(x.g.id, x.B, x.P)).toEqual({ ok: false, error: CANCEL_NOT_ALLOWED });
      expect(await inviteToClaim(x.g.id, x.B, x.P, "cat@example.test", ORIGIN)).toEqual({ ok: false, error: "Priya is already invited (by Asha). Only Asha or the person who looks after the group can change that." });
    }
  });
  it("Cat (the new holder) re-sending the same address does not make it hers: the time is kept, so she still cannot cancel or redirect", async () => {
    const f = await scene(true);
    const before = await inv(f.g.id);
    await pause();
    await inviteByEmail(f.g.id, f.B, "priya@example.test", ORIGIN);
    const after = await inv(f.g.id);
    expect(after.invitedById).toBe(before.invitedById);
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    expect(await cancelInvitation(f.g.id, f.B, f.P)).toEqual({ ok: false, error: CANCEL_NOT_ALLOWED });
    expect(await inviteToClaim(f.g.id, f.B, f.P, "cat@example.test", ORIGIN)).toEqual({ ok: false, error: EARLIER_HOLDER_INVITE_TEXT });
    expect((await inv(f.g.id)).declinedAt).toBeNull();
  });
  it("a sender who was never freed keeps it when someone else re-sends (unchanged)", async () => {
    const f = await scene(false);
    await inviteByEmail(f.g.id, f.D, "priya@example.test", ORIGIN);
    expect((await inv(f.g.id)).invitedById).toBe(f.B);
  });
  it("the words for the new holder do not name their own name", () => {
    const list = [{ fromAccount: false, email: "priya@example.test" }];
    expect(waitingNote({ invites: list, by: "Ben", mayCancel: false, mayInvite: false })).toBe("Invited by Ben. They can change it if the address is wrong."); // anyone else
    expect(waitingNote({ invites: list, by: "Ben", mayCancel: false, mayInvite: false, earlierHolder: true })).toBe("Only the person who looks after the group can change that.");
    expect(EARLIER_HOLDER_INVITE_TEXT).toBe("Only the person who looks after the group can change that.");
  });
  it("'Not now' when another path already released the name: the transaction's update matches no row and nothing else is touched", async () => {
    const f = await flat(MIN, false);
    const pat = await account("Pat");
    const row = await db.member.create({ data: { groupId: f.gid, name: "Pat", accountId: pat.id, addedBy: f.A, seenAt: null } });
    const stale = await db.member.findUniqueOrThrow({ where: { id: row.id } }); // what the first look saw
    await db.pushSubscription.create({ data: { memberId: row.id, endpoint: `https://push.test/${stamp}-${++n}`, p256dh: "k", auth: "a" } });
    const link = await payLinkFor(f.gid, row.id, f.A, f.A);
    await db.member.update({ where: { id: row.id }, data: { accountId: null, addedBy: "" } }); // another path released it in between (without freeing)
    const spy = vi.spyOn(db.member, "findFirst").mockResolvedValueOnce(stale as never);
    try {
      expect((await declineInvitation({ id: pat.id, name: "Pat", email: pat.email }, `m:${row.id}`)).ok).toBe(true); // the answer is the same as before
    } finally {
      spy.mockRestore();
    }
    expect(await db.pushSubscription.count({ where: { memberId: row.id } })).toBe(1);
    expect(await db.payLink.count({ where: { token: link } })).toBe(1);
    expect((await db.member.findUniqueOrThrow({ where: { id: row.id } })).freedAt).toBeNull();
  });
});
