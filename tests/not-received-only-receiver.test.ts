import { afterAll, describe, expect, it, vi } from "vitest";

// MB-1 (16 Nov line review): after the person who was paid says "Not received", ONLY that person can bring the payment back.
// Before, anyone in the group (even the person who said they paid) could press Undo, or "Restore payment" in Activity, and make it count
// again. No admin exception: "only the person paid decides". Both the server and the screens (canUndo, the Restore button) follow one rule.
// Throwaway database; amounts in paise, worked out by hand.
//
// The setup (every test makes its own copy): Asha, Ravi and Meera, all joined.
//   Dinner 200000 paid by Asha, Ravi's whole share: Asha +200000, Ravi -200000.
//   Meera records "Ravi paid Asha 200000" (it counts at once, Asha is asked): Asha 0, Ravi 0, Meera 0.
//   Asha taps "Not received": the payment comes off: Asha +200000, Ravi -200000, Meera 0.

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { markAsMoveOut } = await import("./helpers/move-out-marks");
const { netBalances } = await import("@/lib/balances");
const { createPayment } = await import("@/lib/payments");
const { rejectPayment } = await import("@/lib/payment-ok");
const { setPaymentDeleted } = await import("@/lib/save-expense");
const { actorRefusal, canUndo, undoEvent, undoViewerFor } = await import("@/lib/undo");
const { onlyReceiverCanBringBack, receiverOnlyText } = await import("@/lib/refused-payment");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groups: string[] = [];
let counter = 0;
afterAll(async () => {
  await eraseGroups(groups);
});

async function world() {
  const n = ++counter;
  const g = await db.group.create({
    data: {
      name: `NotReceived ${n} ${stamp}`, currency: "INR", inviteCode: `nr-${n}-${stamp}`,
      members: { create: [{ name: "Asha", claimedAt: new Date() }, { name: "Ravi", claimedAt: new Date() }, { name: "Meera", claimedAt: new Date() }] },
    },
    include: { members: true },
  });
  groups.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  const [a, r, m] = [id("Asha"), id("Ravi"), id("Meera")];
  await db.expense.create({
    data: { groupId: g.id, description: "Dinner", amount: 200000, splitType: "equal", paidById: a, createdById: a, originalAmount: 200000, convertedAmount: 200000, shares: { create: [{ memberId: r, amount: 200000 }] } },
  });
  const pay = await db.$transaction((tx) => createPayment(tx, { groupId: g.id, fromId: r, toId: a, amount: 200000, createdById: m, asksReceiver: true }));
  await markAsMoveOut(g.id, m, [pay.id]);
  const net = async () => {
    const [members, expenses, payments] = await Promise.all([
      db.member.findMany({ where: { groupId: g.id }, select: { id: true } }),
      db.expense.findMany({ where: { groupId: g.id, deletedAt: null }, include: { shares: true } }),
      db.payment.findMany({ where: { groupId: g.id, deletedAt: null } }),
    ]);
    return netBalances(members.map((x) => x.id), expenses, payments);
  };
  const row = () => db.payment.findUniqueOrThrow({ where: { id: pay.id } });
  return { gid: g.id, a, r, m, pay, net, row };
}
const sum = (n: Record<string, number>) => Object.values(n).reduce((x, y) => x + y, 0);

async function notReceived() {
  const w = await world();
  expect(await w.net()).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
  const said = await rejectPayment(w.pay.id, w.a);
  if (!said.ok || !said.eventId) throw new Error("setup failed");
  expect(await w.net()).toEqual({ [w.a]: 200000, [w.r]: -200000, [w.m]: 0 });
  const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: said.eventId } });
  return { ...w, ev };
}

describe("MB-1: only the person who was paid can bring a refused payment back", () => {
  it("Ravi's Undo is refused: the payment stays off and the balances don't move", async () => {
    const w = await notReceived();
    const r = await undoEvent(w.ev.id, w.r);
    expect(r).toEqual({ ok: false, error: "Only Asha can bring this back: they said it wasn’t received." });
    expect((await w.row()).deletedAt).not.toBeNull();
    expect(await w.net()).toEqual({ [w.a]: 200000, [w.r]: -200000, [w.m]: 0 });
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: w.ev.id } })).undoneAt).toBeNull(); // not used up
  });

  it("Meera's 'Restore payment' in Activity is refused too, and so is Ravi's", async () => {
    const w = await notReceived();
    for (const who of [w.m, w.r]) {
      expect(await setPaymentDeleted(w.pay.id, who, false)).toEqual({ ok: false, error: "Only Asha can bring this back: they said it wasn’t received." });
    }
    expect((await w.row()).deletedAt).not.toBeNull();
    expect(await w.net()).toEqual({ [w.a]: 200000, [w.r]: -200000, [w.m]: 0 });
  });

  it("the screens agree: canUndo is false for Ravi and Meera, true for Asha; the Restore button rule hides it for everyone but Asha", async () => {
    const w = await notReceived();
    const events = await db.groupEvent.findMany({ where: { groupId: w.gid, createdAt: { gte: w.ev.createdAt } } });
    const ask = async (who: string) => canUndo(w.ev, events, new Date(), await undoViewerFor(w.gid, who));
    expect((await ask(w.r)).ok).toBe(false);
    expect((await ask(w.m)).ok).toBe(false);
    expect((await ask(w.a)).ok).toBe(true);
    const p = await w.row();
    expect(onlyReceiverCanBringBack(p, w.r)).toBe(true);
    expect(onlyReceiverCanBringBack(p, w.m)).toBe(true);
    expect(onlyReceiverCanBringBack(p, w.a)).toBe(false);
    expect(receiverOnlyText("Asha")).toBe("Only Asha can bring this back: they said it wasn’t received.");
  });

  it("an older line written before the flag existed (no byReceiver) is still refused for Ravi, by its words and by the payment itself", async () => {
    const w = await notReceived();
    // Strip the flag, as an older line would have it.
    await db.groupEvent.update({ where: { id: w.ev.id }, data: { undo: JSON.stringify({ type: "payment_restore", paymentId: w.pay.id }) } });
    const old = await db.groupEvent.findUniqueOrThrow({ where: { id: w.ev.id } });
    expect(old.text.startsWith("hasn’t received ")).toBe(true);
    const viewerRavi = await undoViewerFor(w.gid, w.r);
    expect(actorRefusal(old, viewerRavi, new Date())).toBe("Only Asha can bring this back: they said it wasn’t received.");
    expect(actorRefusal(old, await undoViewerFor(w.gid, w.a), new Date())).toBeNull();
    expect((await undoEvent(old.id, w.r)).ok).toBe(false);
    // Even with the words and the flag both gone, the server reads who deleted the payment.
    await db.groupEvent.update({ where: { id: w.ev.id }, data: { text: "something else" } });
    expect(await undoEvent(w.ev.id, w.r)).toEqual({ ok: false, error: "Only Asha can bring this back: they said it wasn’t received." });
    expect((await w.row()).deletedAt).not.toBeNull();
  });

  it("Asha can bring it back herself: balances 0 / 0 / 0 again", async () => {
    const w = await notReceived();
    expect((await undoEvent(w.ev.id, w.a)).ok).toBe(true);
    expect((await w.row()).deletedAt).toBeNull();
    const n = await w.net();
    expect(n).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
    expect(sum(n)).toBe(0);
  });

  it("Asha can also use 'Restore payment' in Activity", async () => {
    const w = await notReceived();
    expect((await setPaymentDeleted(w.pay.id, w.a, false)).ok).toBe(true);
    expect(await w.net()).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
  });

  it("regression: a payment someone ELSE deleted (Meera) can still be restored by Ravi, by Undo or by Restore", async () => {
    const w = await world();
    const deleted = await setPaymentDeleted(w.pay.id, w.m, true);
    if (!deleted.ok || !deleted.eventId) throw new Error("setup failed");
    expect(await w.net()).toEqual({ [w.a]: 200000, [w.r]: -200000, [w.m]: 0 });
    expect((await undoEvent(deleted.eventId, w.r)).ok).toBe(true); // Ravi undoes Meera's delete
    expect(await w.net()).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
    // And again with the Restore button path.
    expect((await setPaymentDeleted(w.pay.id, w.m, true)).ok).toBe(true);
    expect((await setPaymentDeleted(w.pay.id, w.r, false)).ok).toBe(true);
    expect(await w.net()).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
  });

  it("a payment the person paid deleted THEMSELVES (not 'Not received') is also theirs alone to bring back", async () => {
    const w = await world();
    const deleted = await setPaymentDeleted(w.pay.id, w.a, true); // Asha deletes it from Activity
    if (!deleted.ok || !deleted.eventId) throw new Error("setup failed");
    expect(JSON.parse((await db.groupEvent.findUniqueOrThrow({ where: { id: deleted.eventId } })).undo)).toEqual({ type: "payment_restore", paymentId: w.pay.id, byReceiver: true });
    expect((await undoEvent(deleted.eventId, w.r)).ok).toBe(false);
    expect((await setPaymentDeleted(w.pay.id, w.m, false)).ok).toBe(false);
    expect((await undoEvent(deleted.eventId, w.a)).ok).toBe(true);
    expect(await w.net()).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
  });

  it("the new line written by 'Not received' carries the flag", async () => {
    const w = await notReceived();
    expect(JSON.parse(w.ev.undo)).toEqual({ type: "payment_restore", paymentId: w.pay.id, byReceiver: true });
  });
});
