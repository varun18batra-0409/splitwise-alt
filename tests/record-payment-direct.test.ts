import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { netBalances } from "@/lib/balances";
import { loadGroup, loadNotifications } from "@/lib/group-data";
import { loadNeedsYou } from "@/lib/needs-you";
import { makeClaim, confirmClaim } from "@/lib/payment-claims";
import { rejectPayment } from "@/lib/payment-ok";
import { recordOwnPayment, recordPaymentCore } from "@/lib/pay-record";
import { undoEvent } from "@/lib/undo";

// 15 Nov decision: when the PAYER records their own payment ("I've paid"), it counts straight away (a real Payment, through the
// same guarded write as "Mark paid"). The person paid, when on Loopin, is told in Updates and can tap "Not received", which
// soft-deletes it again. Claims made before the change and still waiting keep working. All amounts are paise.
//
// Cast: Varun and Nupur (both have joined, so Nupur can answer). Thailand trip, INR.
// Hand-worked: Nupur paid ₹35,883.08 = 3588308 for the two of them, split equally: 1794154 each.
//   Nupur: paid 3588308 - share 1794154 = +1794154.   Varun: -1794154.   (sum 0)
//   Smart Settle: Varun -> Nupur 1794154 (₹17,941.54).

const groups: string[] = [];
afterAll(async () => {
  await eraseGroups(groups);
});

const FULL = 1794154;

async function world(opts: { nupurJoined?: boolean } = {}) {
  const g = await db.group.create({
    data: {
      name: "Thailand trip",
      currency: "INR",
      inviteCode: `direct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      members: { create: [{ name: "Varun", claimedAt: new Date() }, { name: "Nupur", ...(opts.nupurJoined === false ? {} : { claimedAt: new Date() }) }] },
    },
    include: { members: true },
  });
  groups.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  const [varun, nupur] = [id("Varun"), id("Nupur")];
  await db.expense.create({
    data: {
      groupId: g.id, description: "Villa", amount: 3588308, splitType: "equal", paidById: nupur, createdById: nupur, originalAmount: 3588308, convertedAmount: 3588308,
      shares: { create: [{ memberId: nupur, amount: FULL }, { memberId: varun, amount: FULL }] },
    },
  });
  return { gid: g.id, varun, nupur };
}

async function net(gid: string) {
  const members = await db.member.findMany({ where: { groupId: gid }, select: { id: true } });
  const [expenses, payments] = await Promise.all([
    db.expense.findMany({ where: { groupId: gid, deletedAt: null }, include: { shares: true } }),
    db.payment.findMany({ where: { groupId: gid, deletedAt: null } }),
  ]);
  return netBalances(members.map((x) => x.id), expenses, payments);
}
const sum = (n: Record<string, number>) => Object.values(n).reduce((x, y) => x + y, 0);
const livePayments = (gid: string) => db.payment.count({ where: { groupId: gid, deletedAt: null } });

async function varunRecords(w: Awaited<ReturnType<typeof world>>) {
  const r = await recordOwnPayment({ groupId: w.gid, fromId: w.varun, toId: w.nupur, myId: w.varun, expectAmount: FULL });
  if (r.kind !== "done") throw new Error(`not recorded: ${JSON.stringify(r)}`);
  const payment = await db.payment.findFirstOrThrow({ where: { groupId: w.gid, deletedAt: null } });
  return { r, payment };
}

describe("the payer's own record counts at once", () => {
  it("Varun records ₹17,941.54 in full: a real payment, both balances 0, no claim, Nupur is told with Not received", async () => {
    const w = await world();
    expect(await net(w.gid)).toEqual({ [w.nupur]: FULL, [w.varun]: -FULL });

    const { r, payment } = await varunRecords(w);
    expect([payment.fromId, payment.toId, payment.amount, payment.createdById]).toEqual([w.varun, w.nupur, 1794154, w.varun]);
    expect(payment.okAt).toBeNull(); // Nupur has not answered: needsOk is what puts it in her Updates
    expect(payment.needsOk).toBe(true);

    // Varun 0 and Nupur 0 (1794154 - 1794154), so the group still sums to 0.
    const n = await net(w.gid);
    expect(n).toEqual({ [w.nupur]: 0, [w.varun]: 0 });
    expect(sum(n)).toBe(0);
    expect((await loadGroup(w.gid, { events: false }))!.transfers).toEqual([]);

    // No claim was made: nothing waits for a "Confirm received".
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(0);

    // The history line has an Undo, like "Mark paid".
    const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: r.did } });
    expect([ev.kind, ev.actorId, ev.text, ev.paymentId]).toEqual(["payment_recorded", w.varun, "paid Nupur ₹17,941.54", payment.id]);
    expect(JSON.parse(ev.undo)).toEqual({ type: "payment_delete", paymentId: payment.id });

    // Nupur's Updates carry it, with the Not received button's payment id.
    const needs = await loadNeedsYou({ [w.gid]: w.nupur }, null, 0);
    expect(needs.items).toHaveLength(1);
    expect(needs.items[0]).toMatchObject({ kind: "payment", text: "Varun recorded paying you ₹17,941.54", where: "Thailand trip", paymentId: payment.id });
    // Varun has nothing to answer.
    expect((await loadNeedsYou({ [w.gid]: w.varun }, null, 0)).items).toEqual([]);
  });

  it("recording twice in a row records once: nothing is owed the second time", async () => {
    const w = await world();
    await varunRecords(w);
    const again = await recordOwnPayment({ groupId: w.gid, fromId: w.varun, toId: w.nupur, myId: w.varun });
    expect(again).toEqual({ kind: "refused", error: "Nothing is owed here right now." });
    expect(await livePayments(w.gid)).toBe(1);
  });

  it("a screen that is out of date (it showed another amount) records nothing", async () => {
    const w = await world();
    const r = await recordOwnPayment({ groupId: w.gid, fromId: w.varun, toId: w.nupur, myId: w.varun, expectAmount: 1794153 });
    expect(r).toEqual({ kind: "refused", error: "Balances changed since you opened this. Check the updated amount and try again." });
    expect(await livePayments(w.gid)).toBe(0);
    expect(await net(w.gid)).toEqual({ [w.nupur]: FULL, [w.varun]: -FULL });
  });

  it("only the person paying can say they paid: Nupur can't record Varun's payment this way", async () => {
    const w = await world();
    const r = await recordOwnPayment({ groupId: w.gid, fromId: w.varun, toId: w.nupur, myId: w.nupur });
    expect(r.kind).toBe("refused");
    expect(await livePayments(w.gid)).toBe(0);
  });

  it("someone who isn't on Loopin yet (just a name) is paid straight away too, with nobody to answer", async () => {
    const w = await world({ nupurJoined: false });
    await varunRecords(w);
    const p = await db.payment.findFirstOrThrow({ where: { groupId: w.gid } });
    expect(p.needsOk).toBe(false);
    expect(await net(w.gid)).toEqual({ [w.nupur]: 0, [w.varun]: 0 });
  });
});

describe("a part payment", () => {
  it("₹10,000 (1000000) of ₹17,941.54 leaves ₹7,941.54 (794154); more than is owed is asked about, not recorded", async () => {
    const w = await world();
    // More than what is owed (1794155 > 1794154): asked first, nothing saved.
    const over = await recordPaymentCore({ groupId: w.gid, fromId: w.varun, toId: w.nupur, amount: 1794155, currency: "INR", myId: w.varun, fp: "t-over", warnOver: true });
    expect(over).toEqual({ kind: "over", limit: 1794154, side: "from" });
    expect(await livePayments(w.gid)).toBe(0);

    // The "Paid a different amount?" path (recordCustomPayment) is recordPaymentCore with the typed amount.
    const part = await recordPaymentCore({ groupId: w.gid, fromId: w.varun, toId: w.nupur, amount: 1000000, currency: "INR", myId: w.varun, fp: "t-part", warnOver: true });
    expect(part.kind).toBe("done");
    const n = await net(w.gid);
    expect(n).toEqual({ [w.nupur]: 794154, [w.varun]: -794154 }); // 1794154 - 1000000
    expect(sum(n)).toBe(0);
    expect((await loadGroup(w.gid, { events: false }))!.transfers.map((t) => [t.from, t.to, t.amount])).toEqual([[w.varun, w.nupur, 794154]]);
    const p = await db.payment.findFirstOrThrow({ where: { groupId: w.gid } });
    expect([p.amount, p.needsOk]).toEqual([1000000, true]); // Nupur is told about this one too
  });
});

describe("Not received reverses it", () => {
  it("Nupur taps Not received: soft-deleted, Varun -1794154 / Nupur +1794154 again, a line is logged, Varun is notified", async () => {
    const w = await world();
    const { payment } = await varunRecords(w);
    expect(await net(w.gid)).toEqual({ [w.nupur]: 0, [w.varun]: 0 });

    const rej = await rejectPayment(payment.id, w.nupur);
    expect(rej.ok).toBe(true);
    const gone = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.deletedById).toBe(w.nupur); // who reversed it is kept
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(1); // soft: the row stays in history

    const n = await net(w.gid);
    expect(n).toEqual({ [w.nupur]: 1794154, [w.varun]: -1794154 });
    expect(sum(n)).toBe(0);
    expect((await loadGroup(w.gid, { events: false }))!.transfers.map((t) => [t.from, t.to, t.amount])).toEqual([[w.varun, w.nupur, 1794154]]);

    // The activity line: "Nupur said they didn’t receive ₹17,941.54 from Varun, so it’s off the balances", with its own Undo.
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: w.gid, kind: "payment_deleted" } });
    expect([ev.actorId, ev.text, ev.paymentId]).toEqual([w.nupur, "said they didn’t receive ₹17,941.54 from Varun, so it’s off the balances", payment.id]);
    expect(JSON.parse(ev.undo)).toEqual({ type: "payment_restore", paymentId: payment.id });

    // Varun is notified: the line is in his Updates, from Nupur.
    const mine = await loadNotifications({ [w.gid]: w.varun }, 50);
    const line = mine.items.find((i) => i.event.id === ev.id);
    expect(line).toBeDefined();
    expect(line!.actorName).toBe("Nupur");
    expect(line!.event.text).toContain("didn’t receive ₹17,941.54");

    // Nothing is left for Nupur to answer, and a second tap changes nothing.
    expect((await loadNeedsYou({ [w.gid]: w.nupur }, null, 0)).items).toEqual([]);
    expect((await rejectPayment(payment.id, w.nupur)).ok).toBe(false);
    expect(await db.groupEvent.count({ where: { groupId: w.gid, kind: "payment_deleted" } })).toBe(1);

    // And the reversal itself can be undone (the existing undo): back to 0 / 0.
    expect((await undoEvent(ev.id, w.nupur)).ok).toBe(true);
    expect(await net(w.gid)).toEqual({ [w.nupur]: 0, [w.varun]: 0 });
  });

  it("anyone other than the person paid is refused, and nothing changes", async () => {
    const w = await world();
    const { payment } = await varunRecords(w);
    const events = await db.groupEvent.count({ where: { groupId: w.gid } });
    expect(await rejectPayment(payment.id, w.varun)).toEqual({ ok: false, error: "Only the person who was paid can confirm it." });
    expect(await rejectPayment(payment.id, undefined)).toEqual({ ok: false, error: "Only the person who was paid can confirm it." });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).deletedAt).toBeNull();
    expect(await db.groupEvent.count({ where: { groupId: w.gid } })).toBe(events);
    expect(await net(w.gid)).toEqual({ [w.nupur]: 0, [w.varun]: 0 });
  });

  it("once Nupur has confirmed it she can't reverse it (and a closed group refuses it)", async () => {
    const w = await world();
    const { payment } = await varunRecords(w);
    await db.payment.update({ where: { id: payment.id }, data: { okAt: new Date() } });
    expect((await rejectPayment(payment.id, w.nupur)).ok).toBe(false);

    const c = await world();
    const { payment: p2 } = await varunRecords(c);
    await db.group.update({ where: { id: c.gid }, data: { closed: true } });
    expect(await rejectPayment(p2.id, c.nupur)).toEqual({ ok: false, error: "This group is closed. Reopen it to change payments." });
    expect((await db.payment.findUniqueOrThrow({ where: { id: p2.id } })).deletedAt).toBeNull();
  });
});

describe("claims made before the change keep working", () => {
  it("an old waiting claim is confirmed by Nupur and counts exactly once", async () => {
    const w = await world();
    // Made the old way (this is what a Remind link still makes, and what was in flight on 15 Nov).
    const c = await makeClaim({ groupId: w.gid, fromId: w.varun, toId: w.nupur, actorId: w.varun, source: "app", expectAmount: FULL });
    if (!c.ok) throw new Error(c.error);
    expect(await livePayments(w.gid)).toBe(0);
    expect(await net(w.gid)).toEqual({ [w.nupur]: FULL, [w.varun]: -FULL }); // a claim moves nothing

    expect((await confirmClaim(c.claimId, w.nupur)).ok).toBe(true);
    await Promise.all([confirmClaim(c.claimId, w.nupur), confirmClaim(c.claimId, w.nupur)]);
    expect(await livePayments(w.gid)).toBe(1);
    const n = await net(w.gid);
    expect(n).toEqual({ [w.nupur]: 0, [w.varun]: 0 });
    expect(sum(n)).toBe(0);
    const p = await db.payment.findFirstOrThrow({ where: { groupId: w.gid } });
    expect([p.amount, p.okAt !== null]).toEqual([1794154, true]);
  });

  it("an old claim is still 'not received'-able the old way, and a new direct record covers a waiting one (never twice)", async () => {
    const w = await world();
    const c = await makeClaim({ groupId: w.gid, fromId: w.varun, toId: w.nupur, actorId: w.varun, source: "app", expectAmount: FULL });
    if (!c.ok) throw new Error(c.error);
    // Varun now records it directly: the waiting claim is closed as covered in the same write.
    await varunRecords(w);
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: c.claimId } })).status).toBe("covered");
    // Nupur taps Confirm on the old claim: nothing more is added.
    expect((await confirmClaim(c.claimId, w.nupur)).ok).toBe(false);
    expect(await livePayments(w.gid)).toBe(1);
    expect(await net(w.gid)).toEqual({ [w.nupur]: 0, [w.varun]: 0 });
  });
});

describe("a closed group refuses it, as before", () => {
  it("recording in a closed group saves nothing", async () => {
    const w = await world();
    await db.group.update({ where: { id: w.gid }, data: { closed: true } });
    expect(await recordOwnPayment({ groupId: w.gid, fromId: w.varun, toId: w.nupur, myId: w.varun })).toEqual({ kind: "refused", error: "This group is closed, so there’s nothing to do." });
    // The guarded write itself says no too (not just the pre-check).
    const direct = await recordPaymentCore({ groupId: w.gid, fromId: w.varun, toId: w.nupur, amount: FULL, currency: "INR", myId: w.varun, fp: "t-closed", warnOver: true });
    expect(direct.kind).toBe("refused");
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(0);
    expect(await net(w.gid)).toEqual({ [w.nupur]: FULL, [w.varun]: -FULL });
  });
});
