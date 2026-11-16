import { afterAll, describe, expect, it, vi } from "vitest";
import type { RateAnswer } from "@/lib/rate-cache";

// Batch A5: a person who has left (or was removed) always owes nothing and is owed nothing. Throwaway database; amounts in paise, every number
// worked by hand. After every step the same three things are asserted (check()): each expense's shares add up to its amount, the group's balances add
// up to 0, and everyone who has left or been removed has a balance of exactly 0 (leaversAtZero).
//
// How it works:
//   * A move-out records the final payments straight away, so the leaver ends at 0. A payment to someone who can answer (and isn't the one pressing
//     the button) also asks them: "Confirm received / Not received" (needsOk).
//   * "Not received" on a payment whose payer and/or receiver has left brings them back into the group, in the same step.
//
// Flat fixture F (Asha, Ravi, Meera, all with accounts): Groceries 120000 paid by Ravi, 40000 each.
//   Start: Ravi +80000, Asha -40000, Meera -40000.

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { formatMoney } = await import("@/lib/money");
const { moveOut, moveOutPreview } = await import("@/lib/home/moving-db");
const { confirmPayment, rejectPayment, waitingForMe } = await import("@/lib/payment-ok");
const { recordPaymentCore } = await import("@/lib/pay-record");
const { markAllPaid, setPaymentsDeleted, settleAllAndClose, applySettleAll, planKey } = await import("@/lib/settle-all");
const { saveExpense, setExpenseDeleted, setPaymentDeleted } = await import("@/lib/save-expense");
const { setMemberLeft } = await import("@/lib/people");
const { undoEvent, ownMoveOut, undoViewerFor } = await import("@/lib/undo");
const { receiverOnlyText } = await import("@/lib/refused-payment");
const { leaversOffZero } = await import("@/lib/money-guard");
const { notReceivedQuestion, notReceivedDone } = await import("@/lib/payment-words");
const { moveOutConfirm } = await import("@/lib/move-confirm");
const { PAIR_NO_MOVE_OUT } = await import("@/lib/direct-guard");
const { ensureLocalPair } = await import("@/lib/direct-db");
const { readFileSync } = await import("node:fs");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
const NOW = new Date("2026-11-10T06:00:00Z");
const NOW16 = new Date("2026-11-16T06:00:00Z");
const key = () => `lz-${stamp}-${++n}-abcdefgh`;
const rate1 = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-11-16" });

afterAll(async () => {
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `lz-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}

type Person = { name: string; joined?: boolean };

// A group. People are added in the order given (the first one who has joined looks after the group). `joined: false` = only a name.
async function world(kind: "home" | "trip", people: Person[]) {
  const accounts = await Promise.all(people.map((p) => (p.joined === false ? Promise.resolve(null) : account(p.name))));
  const g = await db.group.create({
    data: {
      name: `Flat ${402 + ++n} ${stamp}`, type: kind, currency: "INR", inviteCode: `lz-${n}-${stamp}`,
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
        groupId: g.id, description, category: "other", amount, paidById, createdById: paidById, splitType: "exact", forMode: "selected",
        originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, spentAt: new Date("2026-11-01T12:00:00Z"),
        shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) },
      },
    });
  const net = async () => {
    const x = await db.group.findUniqueOrThrow({ where: { id: g.id }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
    return netBalances(x.members.map((m) => m.id), x.expenses, x.payments);
  };
  const payments = () => db.payment.findMany({ where: { groupId: g.id, deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const row = (memberId: string) => db.member.findUniqueOrThrow({ where: { id: memberId } });
  const events = (kind: string) => db.groupEvent.findMany({ where: { groupId: g.id, kind }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  // The three things that must hold after every step.
  const check = async () => {
    for (const e of await db.expense.findMany({ where: { groupId: g.id }, include: { shares: true } })) {
      expect(e.shares.reduce((s, x) => s + x.amount, 0), `shares of ${e.description}`).toBe(e.amount);
    }
    const nets = await net();
    expect(Object.values(nets).reduce((a, b) => a + b, 0)).toBe(0);
    const gone = await db.member.findMany({ where: { groupId: g.id, OR: [{ leftAt: { not: null } }, { removedAt: { not: null } }] } });
    for (const m of gone) expect(nets[m.id] ?? 0, `${m.name} has left, so should be at 0`).toBe(0);
  };
  return { gid: g.id, name: g.name, id, expense, net, payments, row, events, check };
}
type World = Awaited<ReturnType<typeof world>>;

const out = (gid: string, actor: string, leaver: string, now = NOW) => moveOut(gid, actor, { leaverId: leaver, lastDay: "2026-11-10", requestKey: key() }, now);
const record = (w: World, from: string, to: string, amount: number, by = from) =>
  recordPaymentCore({ groupId: w.gid, fromId: from, toId: to, amount, currency: "INR", myId: by, key: key(), fp: `fp-${key()}`, warnOver: false });
const leave = (w: World, member: string) => setMemberLeft(w.gid, member, member, true);
const money = (x: number) => formatMoney(x, "INR");
// Every payment counts at once, so "Not received" on an ordinary payment is now the person paid deleting it. Someone who left comes back owing.
// Returns the people who were brought back (left or removed before, in the group again after).
const del = async (w: World, paymentId: string, by: string) => {
  const goneNow = () => db.member.findMany({ where: { groupId: w.gid, OR: [{ leftAt: { not: null } }, { removedAt: { not: null } }] }, select: { id: true, name: true } });
  const before = await goneNow();
  const r = await setPaymentDeleted(paymentId, by, true);
  if (!r.ok) throw new Error(r.error);
  const after = new Set((await goneNow()).map((m) => m.id));
  return { ...r, back: before.filter((m) => !after.has(m.id)) };
};
const reject = async (paymentId: string, by: string) => {
  const r = await rejectPayment(paymentId, by);
  if (!r.ok) throw new Error(r.error);
  return r;
};

// Flat fixture F.
async function flatF() {
  const w = await world("home", [{ name: "Asha" }, { name: "Ravi" }, { name: "Meera" }]);
  const [A, R, M] = [w.id("Asha"), w.id("Ravi"), w.id("Meera")];
  await w.expense("Groceries", 120000, R, [[A, 40000], [R, 40000], [M, 40000]]);
  expect(await w.net()).toEqual({ [A]: -40000, [R]: 80000, [M]: -40000 });
  return { w, A, R, M };
}

// Trip Goa (Asha, Ravi, Meera): Dinner 60000 paid by Ravi, all of it Asha's share: Ravi +60000, Asha -60000.
async function trip(people: Person[] = [{ name: "Asha" }, { name: "Ravi" }, { name: "Meera" }]) {
  const w = await world("trip", people);
  const [A, R, M] = [w.id("Asha"), w.id("Ravi"), w.id("Meera")];
  await w.expense("Dinner", 60000, R, [[A, 60000]]);
  expect(await w.net()).toEqual({ [A]: -60000, [R]: 60000, [M]: 0 });
  return { w, A, R, M };
}

describe("1-4. Asha moves herself out of the flat, and Ravi answers", () => {
  it("1. moving out records one payment Asha -> Ravi 40000 that asks Ravi; no note; she is at 0", async () => {
    const { w, A, R, M } = await flatF();
    expect((await out(w.gid, A, A)).ok).toBe(true);
    const pays = await w.payments();
    expect(pays.map((p) => [p.fromId, p.toId, p.amount, p.needsOk, p.okAt])).toEqual([[A, R, 40000, true, null]]);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(0);
    expect((await w.row(A)).leftAt).not.toBeNull();
    expect(await w.net()).toEqual({ [A]: 0, [R]: 40000, [M]: -40000 });
    const waiting = await waitingForMe(w.gid, R);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].from.leftAt).not.toBeNull(); // the screen words the question from this
    await w.check();
  });

  it("2. Ravi taps Not received: Asha is back at -40000 (Ravi +80000, Meera -40000); one payment_deleted (byReceiver) and one member_rejoined by Ravi", async () => {
    const { w, A, R, M } = await flatF();
    expect((await out(w.gid, A, A)).ok).toBe(true);
    const pay = (await w.payments())[0];
    const leftBefore = (await w.row(A)).leftAt!;
    const r = await reject(pay.id, R);
    expect(r.back).toEqual([{ id: A, name: "Asha" }]);
    const gone = await db.payment.findUniqueOrThrow({ where: { id: pay.id } });
    expect([gone.deletedAt !== null, gone.deletedById]).toEqual([true, R]);
    const asha = await w.row(A);
    expect([asha.leftAt, asha.removedAt]).toEqual([null, null]);
    expect(await w.net()).toEqual({ [A]: -40000, [R]: 80000, [M]: -40000 });
    const deleted = await w.events("payment_deleted");
    expect(deleted).toHaveLength(1);
    expect(JSON.parse(deleted[0].undo)).toEqual({ type: "payment_restore", paymentId: pay.id, byReceiver: true });
    const rejoined = await w.events("member_rejoined");
    expect(rejoined).toHaveLength(1);
    expect(rejoined[0].actorId).toBe(R);
    expect(rejoined[0].text).toBe(`brought Asha back into ${w.name} until the ${money(40000)} is sorted`);
    expect(rejoined[0].paymentId).toBeNull(); // so it never blocks the Undo of the Not received
    expect(JSON.parse(rejoined[0].undo)).toEqual({ type: "member_set", memberId: A, data: { leftAt: leftBefore.toISOString() } });
    await w.check();
  });

  it("3. after 2: Meera can't Restore or Undo (only Ravi can); Ravi's Undo counts it again with Asha still in at 0; Asha can step out again; her old move-out can't be undone", async () => {
    const { w, A, R, M } = await flatF();
    expect((await out(w.gid, A, A)).ok).toBe(true);
    const pay = (await w.payments())[0];
    const leftBefore = (await w.row(A)).leftAt!;
    await reject(pay.id, R);
    const deletedEv = (await w.events("payment_deleted"))[0];
    const rejoinEv = (await w.events("member_rejoined"))[0];
    // Meera: Restore and Undo both refused, nothing moves.
    expect(await setPaymentDeleted(pay.id, M, false)).toEqual({ ok: false, error: receiverOnlyText("Ravi") });
    expect(await undoEvent(deletedEv.id, M)).toEqual({ ok: false, error: receiverOnlyText("Ravi") });
    expect(await w.net()).toEqual({ [A]: -40000, [R]: 80000, [M]: -40000 });
    await w.check();
    // Ravi's Undo: the payment counts again and asks him again; Asha stays in the group at 0.
    expect((await undoEvent(deletedEv.id, R)).ok).toBe(true);
    expect(await w.net()).toEqual({ [A]: 0, [R]: 40000, [M]: -40000 });
    const back = await db.payment.findUniqueOrThrow({ where: { id: pay.id } });
    expect([back.deletedAt, back.needsOk, back.okAt]).toEqual([null, true, null]);
    expect((await w.row(A)).leftAt).toBeNull();
    await w.check();
    // Asha undoes the "brought back" line: she steps out again, on her original last day.
    expect((await undoEvent(rejoinEv.id, A)).ok).toBe(true);
    expect((await w.row(A)).leftAt?.toISOString()).toBe(leftBefore.toISOString());
    expect(await w.net()).toEqual({ [A]: 0, [R]: 40000, [M]: -40000 });
    await w.check();
    // Her original move-out is not offered again (a newer change to her, and its payment, stand in the way).
    const own = await ownMoveOut(w.gid, await undoViewerFor(w.gid, A), new Date());
    expect(own === null || own.check.ok === false).toBe(true);
  });

  it("4. Ravi taps Confirm received instead: it is confirmed, balances unchanged; a later Not received is refused", async () => {
    const { w, A, R, M } = await flatF();
    expect((await out(w.gid, A, A)).ok).toBe(true);
    const pay = (await w.payments())[0];
    expect((await confirmPayment(pay.id, R)).ok).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: pay.id } })).okAt).not.toBeNull();
    expect(await w.net()).toEqual({ [A]: 0, [R]: 40000, [M]: -40000 });
    const late = await rejectPayment(pay.id, R);
    expect(late.ok).toBe(false);
    expect(!late.ok && late.error).toContain("You already confirmed this one");
    expect((await w.row(A)).leftAt).not.toBeNull();
    await w.check();
  });
});

describe("5. M1: who is asked when someone marks Asha out", () => {
  it("Meera marks Asha out: the payment Asha -> Ravi asks Ravi; Ravi marks her out himself: no question; Ravi only a name: no question; each ends Asha at 0", async () => {
    const a = await flatF();
    expect((await out(a.w.gid, a.M, a.A)).ok).toBe(true);
    expect((await a.w.payments()).map((p) => [p.fromId, p.toId, p.amount, p.needsOk])).toEqual([[a.A, a.R, 40000, true]]);
    expect((await a.w.net())[a.A]).toBe(0);
    await a.w.check();

    const b = await flatF();
    expect((await out(b.w.gid, b.R, b.A)).ok).toBe(true);
    expect((await b.w.payments()).map((p) => [p.fromId, p.toId, p.amount, p.needsOk])).toEqual([[b.A, b.R, 40000, false]]);
    expect((await b.w.net())[b.A]).toBe(0);
    await b.w.check();

    const c = await world("home", [{ name: "Asha" }, { name: "Ravi", joined: false }, { name: "Meera" }]);
    const [A, R, M] = [c.id("Asha"), c.id("Ravi"), c.id("Meera")];
    await c.expense("Groceries", 120000, R, [[A, 40000], [R, 40000], [M, 40000]]);
    expect((await out(c.gid, M, A)).ok).toBe(true);
    expect((await c.payments()).map((p) => [p.fromId, p.toId, p.amount, p.needsOk])).toEqual([[A, R, 40000, false]]);
    expect((await c.net())[A]).toBe(0);
    await c.check();
  });
});

describe("6. OB-3: Varun owes Asha and marks her out", () => {
  it("Varun -> Asha 80000 asks Asha; both at 0; Asha (who has left) says Not received: she is back at +80000, Varun -80000", async () => {
    const w = await world("home", [{ name: "Asha" }, { name: "Varun" }, { name: "Meera" }]);
    const [A, V] = [w.id("Asha"), w.id("Varun")];
    await w.expense("Cab", 80000, A, [[V, 80000]]);
    expect(await w.net()).toEqual({ [A]: 80000, [V]: -80000, [w.id("Meera")]: 0 });
    expect((await out(w.gid, V, A)).ok).toBe(true);
    const pays = await w.payments();
    expect(pays.map((p) => [p.fromId, p.toId, p.amount, p.needsOk])).toEqual([[V, A, 80000, true]]);
    expect(await w.net()).toEqual({ [A]: 0, [V]: 0, [w.id("Meera")]: 0 });
    await w.check();
    const r = await reject(pays[0].id, A);
    expect(r.back).toEqual([{ id: A, name: "Asha" }]);
    expect((await w.row(A)).leftAt).toBeNull();
    expect(await w.net()).toEqual({ [A]: 80000, [V]: -80000, [w.id("Meera")]: 0 });
    const line = (await w.events("member_rejoined"))[0];
    expect(line.text).toBe(`came back into ${w.name} until the ${money(80000)} is sorted`); // she brought herself back
    await w.check();
  });
});

describe("7-8. a trip: the one paid has left, or the payer has left, or both", () => {
  it("7. Asha records paying Ravi 60000, Ravi leaves; Ravi deletes the payment: Ravi is back at +60000, Asha -60000", async () => {
    const { w, A, R, M } = await trip();
    expect((await record(w, A, R, 60000)).kind).toBe("done");
    const pay = (await w.payments())[0];
    expect([pay.needsOk, pay.okAt]).toEqual([false, null]); // it counts at once and asks nobody
    expect(await w.net()).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
    expect((await leave(w, R)).ok).toBe(true);
    expect((await w.row(R)).leftAt).not.toBeNull();
    await w.check();
    const r = await del(w, pay.id, R);
    expect(r.back).toEqual([{ id: R, name: "Ravi" }]);
    expect((await w.row(R)).leftAt).toBeNull();
    expect(await w.net()).toEqual({ [A]: -60000, [R]: 60000, [M]: 0 });
    await w.check();
  });

  it("8. Asha records paying Ravi 60000, then leaves; Ravi deletes the payment: Asha is back at -60000, Ravi +60000", async () => {
    const { w, A, R, M } = await trip();
    expect((await record(w, A, R, 60000)).kind).toBe("done");
    const pay = (await w.payments())[0];
    expect((await leave(w, A)).ok).toBe(true);
    await w.check();
    const r = await del(w, pay.id, R);
    expect(r.back).toEqual([{ id: A, name: "Asha" }]);
    expect(await w.net()).toEqual({ [A]: -60000, [R]: 60000, [M]: 0 });
    await w.check();
  });

  it("8b. both leave, then Ravi deletes the payment: both are brought back", async () => {
    const { w, A, R, M } = await trip();
    expect((await record(w, A, R, 60000)).kind).toBe("done");
    const pay = (await w.payments())[0];
    expect((await leave(w, A)).ok).toBe(true);
    expect((await leave(w, R)).ok).toBe(true);
    await w.check();
    const r = await del(w, pay.id, R);
    expect(r.back.map((b) => b.id).sort()).toEqual([A, R].sort());
    for (const id of [A, R]) {
      const m = await w.row(id);
      expect([m.leftAt, m.removedAt]).toEqual([null, null]);
    }
    expect(await w.net()).toEqual({ [A]: -60000, [R]: 60000, [M]: 0 });
    expect(await w.events("member_rejoined")).toHaveLength(2);
    await w.check();
  });
});

describe("9. H1: nobody but the person paid can bring a refused payment back", () => {
  it("(a) Meera marks all paid, undoes it, Asha's own 'I've paid' is confirmed, Asha leaves: Meera's Redo is refused; 0 / 0; Asha still left", async () => {
    const w = await world("trip", [{ name: "Asha" }, { name: "Ravi" }, { name: "Meera" }]);
    const [A, R, M] = [w.id("Asha"), w.id("Ravi"), w.id("Meera")];
    await w.expense("Dinner", 40000, R, [[A, 40000]]); // Asha -40000, Ravi +40000
    expect((await markAllPaid(w.gid, M, [{ from: A, to: R, amount: 40000 }], "", true)).ok).toBe(true);
    const ids = (await w.payments()).map((p) => p.id);
    expect(ids).toHaveLength(1);
    // Meera recorded it for others, so she may Undo it (and Redo it) inside the 10 minutes: recorderOk is what the Undo button passes.
    expect((await setPaymentsDeleted(w.gid, M, ids, true, { recorderOk: true })).ok).toBe(true);
    expect(await w.net()).toEqual({ [A]: -40000, [R]: 40000, [M]: 0 });
    expect((await recordPaymentCore({ groupId: w.gid, fromId: A, toId: R, amount: 40000, currency: "INR", myId: A, key: key(), fp: `fp-${key()}`, warnOver: false })).kind).toBe("done"); // Asha's own "I've paid" counts at once
    expect(await w.net()).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
    expect((await leave(w, A)).ok).toBe(true);
    const redo = await setPaymentsDeleted(w.gid, M, ids, false, { recorderOk: true });
    expect(redo.ok).toBe(false); // refused even inside Meera's window: Asha has left, and it would count her 40000 twice
    // Without the recorder window, Meera (not in the payment) is refused for that reason instead.
    expect(await setPaymentsDeleted(w.gid, M, ids, false)).toEqual({ ok: false, error: "Only the people in each payment can take these off." });
    expect(await w.net()).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
    expect((await w.row(A)).leftAt).not.toBeNull();
    await w.check();
  });

  it("(b) Meera marks Asha's 40000 as paid, Ravi deletes it: Meera's direct restore is refused with the receiver-only words; Ravi +40000, Asha -40000", async () => {
    const w = await world("trip", [{ name: "Asha" }, { name: "Ravi" }, { name: "Meera" }]);
    const [A, R, M] = [w.id("Asha"), w.id("Ravi"), w.id("Meera")];
    await w.expense("Dinner", 40000, R, [[A, 40000]]);
    expect((await markAllPaid(w.gid, M, [{ from: A, to: R, amount: 40000 }], "", true)).ok).toBe(true);
    const pay = (await w.payments())[0];
    expect(pay.needsOk).toBe(false); // it counts at once
    await del(w, pay.id, R); // Ravi deletes it
    expect(await setPaymentsDeleted(w.gid, M, [pay.id], false)).toEqual({ ok: false, error: receiverOnlyText("Ravi") });
    expect(await w.net()).toEqual({ [A]: -40000, [R]: 40000, [M]: 0 });
    await w.check();
    // (c) Meera's undo of that Mark all paid does not overwrite who took it off: it is still Ravi.
    expect((await setPaymentsDeleted(w.gid, M, [pay.id], true, { recorderOk: true })).ok).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: pay.id } })).deletedById).toBe(R);
    expect(await w.net()).toEqual({ [A]: -40000, [R]: 40000, [M]: 0 });
    await w.check();
  });

  it("(d) the same for Settle everything: the group is reopened, Ravi deletes it, and Meera's Redo is refused with the receiver-only words", async () => {
    const w = await world("trip", [{ name: "Asha" }, { name: "Ravi" }, { name: "Meera" }]);
    const [A, R, M] = [w.id("Asha"), w.id("Ravi"), w.id("Meera")];
    await w.expense("Dinner", 40000, R, [[A, 40000]]);
    expect((await settleAllAndClose(w.gid, M, planKey([{ from: A, to: R, amount: 40000 }]))).ok).toBe(true);
    const ids = (await w.payments()).map((p) => p.id);
    expect(ids).toHaveLength(1);
    await db.group.update({ where: { id: w.gid }, data: { closed: false, closedAt: null } }); // reopened, so Ravi can delete it
    await del(w, ids[0], R);
    expect(await applySettleAll(w.gid, M, ids, true)).toEqual({ ok: false, error: receiverOnlyText("Ravi") });
    expect((await db.payment.findUniqueOrThrow({ where: { id: ids[0] } })).deletedById).toBe(R);
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).closed).toBe(false);
    expect(await w.net()).toEqual({ [A]: -40000, [R]: 40000, [M]: 0 });
    await w.check();
  });
});

describe("10. H2: the expense behind a leaver's payment can't be changed under her", () => {
  it("Asha moves out (payment 40000 asks Ravi): deleting Groceries, editing her share, and deleting the payment are all refused; Ravi's Not received still works", async () => {
    const w = await world("home", [{ name: "Asha" }, { name: "Ravi" }, { name: "Meera" }]);
    const [A, R, M] = [w.id("Asha"), w.id("Ravi"), w.id("Meera")];
    const groceries = await w.expense("Groceries", 40000, R, [[A, 40000]]);
    expect((await out(w.gid, A, A)).ok).toBe(true);
    const pay = (await w.payments())[0];
    expect([pay.fromId, pay.toId, pay.amount, pay.needsOk]).toEqual([A, R, 40000, true]);
    expect(await w.net()).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
    await w.check();

    expect(await setExpenseDeleted(groceries.id, M, true)).toEqual({ ok: false, error: "Asha has left the group, so this can't be deleted. Ask them to rejoin first." });
    // Editing Asha's 40000 over to Meera would move Asha to +40000.
    const edit = await saveExpense({
      groupId: w.gid, name: "Groceries", category: "", amount: "400", currency: "INR", paidById: R, forMode: "selected", selected: [M], onePersonId: "",
      splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", expenseId: groceries.id,
    }, M, rate1);
    expect(edit.ok).toBe(false);
    expect(!edit.ok && edit.error).toContain("Asha has left the group");
    // Only the payer and the person paid can delete a payment (Batch C): Meera is neither, so she is told so. (Deleting is never refused
    // because someone left: Asha or Ravi deleting it brings Asha back owing, which is what Ravi's Not received below does.)
    const del = await setPaymentDeleted(pay.id, M, true);
    expect(del).toEqual({ ok: false, error: "Only Asha or Ravi can change this payment." });
    expect(await w.net()).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
    await w.check();

    await reject(pay.id, R);
    expect(await w.net()).toEqual({ [A]: -40000, [R]: 40000, [M]: 0 });
    await w.check();
  });
});

describe("11. M2: an earlier leaver is never touched by a later move-out, and Settle everything works", () => {
  it("Groceries 90000 by Meera: Asha leaves (payment 30000), Ravi's preview and move-out pay Meera 30000; everyone 0 and the group closes", async () => {
    const w = await world("home", [{ name: "Asha" }, { name: "Ravi" }, { name: "Meera" }]);
    const [A, R, M] = [w.id("Asha"), w.id("Ravi"), w.id("Meera")];
    await w.expense("Groceries", 90000, M, [[M, 30000], [A, 30000], [R, 30000]]);
    expect(await w.net()).toEqual({ [A]: -30000, [R]: -30000, [M]: 60000 });
    expect((await out(w.gid, A, A)).ok).toBe(true);
    expect(await w.net()).toEqual({ [A]: 0, [R]: -30000, [M]: 30000 });
    await w.check();
    const p = await moveOutPreview(w.gid, R, "2026-11-10", NOW, R);
    if (!p.ok) throw new Error(p.error);
    expect(p.balanceToday).toBe(-30000);
    expect(p.payments).toEqual([{ from: R, to: M, amount: 30000 }]);
    expect((await out(w.gid, R, R)).ok).toBe(true);
    expect(await w.net()).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
    expect((await w.payments()).map((x) => [x.fromId, x.toId, x.amount]).sort()).toEqual([[A, M, 30000], [R, M, 30000]].sort());
    await w.check();
    // Settle everything: nothing to pay, and the group closes.
    const closed = await settleAllAndClose(w.gid, M, planKey([]));
    expect(closed.ok).toBe(true);
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).closed).toBe(true);
    expect(await w.payments()).toHaveLength(2);
    await w.check();
  });
});

describe("12. no double rent cut when someone is brought back and moves out again (today 2026-11-16)", () => {
  it("Rent 900000 by Meera (300000 each): Asha leaves on 10 Nov and keeps 100000; Not received, Undo, then leaving again leaves her share at 100000 (not 33333)", async () => {
    const w = await world("home", [{ name: "Asha" }, { name: "Ravi" }, { name: "Meera" }]);
    const [A, R, M] = [w.id("Asha"), w.id("Ravi"), w.id("Meera")];
    const rent = await w.expense("Rent", 900000, M, [[A, 300000], [R, 300000], [M, 300000]]);
    const bill = await db.bill.create({ data: { groupId: w.gid, name: "Rent", nature: "fixed", amount: 900000, day: 1, startMonth: "2026-11", payer: M } });
    await db.billRun.create({ data: { billId: bill.id, period: "2026-11", status: "added", expenseId: rent.id } });
    const shares = async () => Object.fromEntries((await db.expenseShare.findMany({ where: { expenseId: rent.id } })).map((s) => [s.memberId, s.amount]));
    expect(await w.net()).toEqual({ [A]: -300000, [R]: -300000, [M]: 600000 });

    // She keeps floor(300000 x 10 / 30) = 100000; the freed 200000 goes 100000 to Ravi and 100000 to Meera.
    expect((await out(w.gid, A, A, NOW16)).ok).toBe(true);
    expect(await shares()).toEqual({ [A]: 100000, [R]: 400000, [M]: 400000 });
    // Before her payment: Meera +900000 - 400000 = +500000, Ravi -400000, Asha -100000. Her payment of 100000 to Meera: Meera +400000, Asha 0.
    const pay = (await w.payments())[0];
    expect([pay.fromId, pay.toId, pay.amount, pay.needsOk]).toEqual([A, M, 100000, true]);
    expect(await w.net()).toEqual({ [A]: 0, [R]: -400000, [M]: 400000 });
    await w.check();

    await reject(pay.id, M); // Meera: Not received
    expect(await w.net()).toEqual({ [A]: -100000, [R]: -400000, [M]: 500000 });
    await w.check();
    const deletedEv = (await w.events("payment_deleted"))[0];
    expect((await undoEvent(deletedEv.id, M)).ok).toBe(true); // Meera undoes it
    expect(await w.net()).toEqual({ [A]: 0, [R]: -400000, [M]: 400000 });
    expect((await w.row(A)).leftAt).toBeNull(); // Asha is still in the flat, at 0
    await w.check();

    // She moves out again on the same day: nothing to pay, and the Rent share is not cut a second time.
    expect((await out(w.gid, A, A, NOW16)).ok).toBe(true);
    expect(await shares()).toEqual({ [A]: 100000, [R]: 400000, [M]: 400000 });
    expect(await w.payments()).toHaveLength(1);
    expect(await w.net()).toEqual({ [A]: 0, [R]: -400000, [M]: 400000 });
    expect((await w.row(A)).leftAt).not.toBeNull();
    await w.check();
  });
});

describe("13. someone the admin removed is put back too", () => {
  it("Asha records paying Ravi 60000, admin Meera removes her; Ravi deletes the payment: Asha is back (no left / removed mark), Asha -60000, Ravi +60000; the undo data carries the removal", async () => {
    const w = await world("trip", [{ name: "Meera" }, { name: "Asha" }, { name: "Ravi" }]);
    const [M, A, R] = [w.id("Meera"), w.id("Asha"), w.id("Ravi")];
    await w.expense("Dinner", 60000, R, [[A, 60000]]);
    expect((await record(w, A, R, 60000)).kind).toBe("done");
    const pay = (await w.payments())[0];
    expect((await setMemberLeft(w.gid, M, A, true)).ok).toBe(true); // the admin removes her
    const removed = await w.row(A);
    expect(removed.removedAt).not.toBeNull();
    expect(removed.removedById).toBe(M);
    await w.check();
    const r = await del(w, pay.id, R);
    expect(r.back).toEqual([{ id: A, name: "Asha" }]);
    const asha = await w.row(A);
    expect([asha.leftAt, asha.removedAt, asha.removedById]).toEqual([null, null, ""]);
    expect(await w.net()).toEqual({ [A]: -60000, [R]: 60000, [M]: 0 });
    const line = (await w.events("member_rejoined"))[0];
    const undo = JSON.parse(line.undo) as { data: { leftAt: string; removedAt: string; removedById: string } };
    expect(undo.data.removedAt).toBe(removed.removedAt!.toISOString());
    expect(undo.data.removedById).toBe(M);
    expect(undo.data.leftAt).toBe((removed.leftAt ?? removed.removedAt)!.toISOString());
    await w.check();
  });
});

describe("14. closed and deleted groups", () => {
  it("closed: deleting is refused and Asha stays left at 0; after reopening it works", async () => {
    const { w, A, R, M } = await trip();
    expect((await record(w, A, R, 60000)).kind).toBe("done");
    const pay = (await w.payments())[0];
    expect((await leave(w, A)).ok).toBe(true);
    await db.group.update({ where: { id: w.gid }, data: { closed: true } });
    expect(await setPaymentDeleted(pay.id, R, true)).toEqual({ ok: false, error: "This group is closed. Reopen it to change payments." });
    expect((await w.row(A)).leftAt).not.toBeNull();
    expect(await w.net()).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
    await w.check();
    await db.group.update({ where: { id: w.gid }, data: { closed: false } });
    expect((await setPaymentDeleted(pay.id, R, true)).ok).toBe(true);
    expect(await w.net()).toEqual({ [A]: -60000, [R]: 60000, [M]: 0 });
  });

  it("deleted: This group was deleted.", async () => {
    const { w, A, R } = await trip();
    expect((await record(w, A, R, 60000)).kind).toBe("done");
    const pay = (await w.payments())[0];
    await db.group.update({ where: { id: w.gid }, data: { deletedAt: new Date() } });
    expect(await setPaymentDeleted(pay.id, R, true)).toEqual({ ok: false, error: "This group was deleted." });
  });
});

describe("15. a pair", () => {
  it("deleting works, no member_rejoined is written, nobody has left; moving out is still refused", async () => {
    const a = await account("PairPia");
    const p = await ensureLocalPair({ id: a.id }, "Rohan", { currency: "INR", myName: "Pia" });
    if (!p.ok) throw new Error("refused");
    groupIds.push(p.groupId);
    await db.member.update({ where: { id: p.otherId }, data: { claimedAt: new Date() } }); // Rohan has joined: he can be asked
    const done = await recordPaymentCore({ groupId: p.groupId, fromId: p.myId, toId: p.otherId, amount: 3000, currency: "INR", myId: p.myId, key: key(), fp: `fp-${key()}`, warnOver: false });
    expect(done.kind).toBe("done");
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: p.groupId, deletedAt: null } });
    expect(pay.needsOk).toBe(false);
    const r = await setPaymentDeleted(pay.id, p.otherId, true);
    expect(r.ok).toBe(true);
    expect(await db.groupEvent.count({ where: { groupId: p.groupId, kind: "member_rejoined" } })).toBe(0);
    expect(await db.member.count({ where: { groupId: p.groupId, OR: [{ leftAt: { not: null } }, { removedAt: { not: null } }] } })).toBe(0);
    expect(await moveOut(p.groupId, p.myId, { leaverId: p.myId, lastDay: "2026-11-10", requestKey: key() }, NOW)).toEqual({ ok: false, error: PAIR_NO_MOVE_OUT });
  });
});

describe("16. the words", () => {
  const base = "Haven’t received ₹400 from Asha? It comes off the balances (you can undo).";
  it("the Not received question, for each case", () => {
    const q = (fromLeft: boolean, iLeft: boolean) => notReceivedQuestion({ amount: "₹400", fromName: "Asha", fromLeft, iLeft, groupName: "Flat 402" });
    expect(q(false, false)).toBe(base);
    expect(q(true, false)).toBe(`${base} Asha has left, so Asha comes back into Flat 402, owing it, until it’s sorted.`);
    expect(q(false, true)).toBe(`${base} You’ve left, so you come back into Flat 402 until it’s sorted.`);
    expect(q(true, true)).toBe(`${base} You and Asha both come back into Flat 402 until it’s sorted.`);
  });
  it("the message after tapping", () => {
    expect(notReceivedDone({ others: [], iBack: false, groupName: "Flat 402" })).toBe("Taken off the balances, and they’ll see you haven’t received it.");
    expect(notReceivedDone({ others: ["Asha"], iBack: false, groupName: "Flat 402" })).toBe("Taken off the balances. Asha is back in Flat 402 until it’s sorted, and they’ll see it.");
    expect(notReceivedDone({ others: [], iBack: true, groupName: "Flat 402" })).toBe("Taken off the balances. You’re back in Flat 402 until it’s sorted.");
    expect(notReceivedDone({ others: ["Asha"], iBack: true, groupName: "Flat 402" })).toBe("Taken off the balances. You and Asha are back in Flat 402 until it’s sorted, and they’ll see it.");
  });
  it("the move-out question", () => {
    const nameOf = (id: string) => (id === "asha" ? "Asha" : "Ravi");
    const m = (x: number) => `₹${x / 100}`;
    expect(moveOutConfirm({ leaverName: "Asha", payments: [{ from: "asha", to: "ravi", amount: 40000, waits: true }], nameOf, money: m })).toBe(
      "Final payments: Asha pays Ravi ₹400 (Ravi is asked to confirm it). They are recorded as paid and everyone is told. If a payment isn’t received, Asha comes back into the flat until it’s sorted. Mark Asha as moved out?",
    );
    expect(moveOutConfirm({ leaverName: "Asha", payments: [{ from: "asha", to: "ravi", amount: 40000 }], nameOf, money: m })).toBe(
      "Final payments: Asha pays Ravi ₹400. They are recorded as paid and everyone is told. Mark Asha as moved out?",
    );
  });
  it("the page footnote, the notification and the 'back' link are wired (source checks: they are screens and pushes)", () => {
    const page = readFileSync("src/app/groups/[id]/people/[memberId]/move/page.tsx", "utf8");
    expect(page).toContain("The payments above are recorded as paid. Anyone paid who is on Loopin is asked to confirm; if they say it wasn’t received,");
    expect(page).toContain("back in the flat until it’s sorted. Everyone is told.");
    const claims = readFileSync("src/lib/payment-claims.ts", "utf8");
    expect(claims).toContain("hasn’t received your ${c.amountText}, so you’re back in ${c.groupName} until it’s sorted.");
    expect(readFileSync("src/lib/payment-ok.ts", "utf8")).toContain("tellBroughtBack(");
    expect(readFileSync("src/app/pay-actions.ts", "utf8")).toContain("back: r.back.map((b) => b.id).join(\",\")");
    const settle = readFileSync("src/app/groups/[id]/settle/page.tsx", "utf8");
    expect(settle).toContain("notReceivedQuestion(");
    expect(settle).toContain("notReceivedDone(");
  });
});

describe("17. kept from Batch A", () => {
  it("the waiting-note block, FB-4's key, FB-2's eligible list, MB-1/MB-7's reopening and the removed leaver exceptions", () => {
    const moving = readFileSync("src/lib/home/moving-db.ts", "utf8");
    expect(moving).toContain("MOVE_OUT_WAITING_NOTE");
    expect(moving).toContain("waitingNoteFor(");
    expect(moving).toContain("MOVE_OUT_KEY_CHANGED");
    expect(moving).toContain("proRataShares(e.shares, leaverId, days, daysInMonth(period), weights, stillHere)"); // FB-2
    expect(moving).toContain("resplitAlready(");
    expect(moving).not.toContain("splitSquareUp");
    expect(moving).not.toContain("tellReceiver");
    expect(readFileSync("src/lib/payment-change.ts", "utf8")).toContain("tellBroughtBack("); // a delete or a Not received brings the people who left back
    expect(readFileSync("src/lib/payments.ts", "utf8")).toContain("receiverOnlyText("); // MB-1 for every restore
    for (const f of ["payment-claims", "payment-change", "pay-record", "settle-all", "cross-settle-db", "pay-link", "money-guard", "payment-ok"]) {
      const src = readFileSync(`src/lib/${f}.ts`, "utf8");
      expect(src, f).not.toContain("thirdPartyLeaverRefusal");
      expect(src, f).not.toContain("claimConfirmBreaks");
    }
    expect(readFileSync("src/lib/home/moving.ts", "utf8")).not.toContain("eligible?: ReadonlySet<string>): Transfer[]");
  });
});

describe("18. leaversOffZero looks only at the people it is given", () => {
  it("a person who has left and is not at 0 is named; at 0, or still in the group, or not asked about: not named", async () => {
    const w = await world("trip", [{ name: "Asha" }, { name: "Ravi" }, { name: "Meera" }]);
    const [A, R, M] = [w.id("Asha"), w.id("Ravi"), w.id("Meera")];
    await w.expense("Dinner", 60000, R, [[A, 60000]]); // Asha -60000, Ravi +60000
    const ask = (ids: string[]) => db.$transaction((tx) => leaversOffZero(tx, w.gid, ids));
    expect(await ask([A, R, M])).toEqual([]); // nobody has left
    await db.member.update({ where: { id: A }, data: { leftAt: new Date("2026-11-05T12:00:00Z") } }); // an old row: left owing 60000
    expect(await ask([A])).toEqual(["Asha"]);
    expect(await ask([R, M])).toEqual([]); // not asked about: an old row can't block someone else
    expect(await ask([])).toEqual([]);
    await db.member.update({ where: { id: R }, data: { removedAt: new Date("2026-11-06T12:00:00Z"), leftAt: new Date("2026-11-06T12:00:00Z") } });
    expect(await ask([A, R])).toEqual(["Asha", "Ravi"]); // removed counts as left
    await db.payment.create({ data: { groupId: w.gid, fromId: A, toId: R, amount: 60000, createdById: A } });
    expect(await ask([A, R])).toEqual([]); // both now at 0
  });
});
