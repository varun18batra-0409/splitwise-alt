import type { Prisma } from "@prisma/client";
import { formatMoney } from "./money";
import { receiverOnlyText } from "./refused-payment";

// The ONE place a payment row is written. Every route that records a payment
// (Mark paid, Record a payment, Mark all paid, Settle everything, cross-group
// settle, move-out, "Confirm received") calls createPayment inside its own
// transaction. A test (tests/payments-guard.test.ts) fails if tx.payment.create
// shows up anywhere else, apart from the Splitwise import.
//
// Why: an "I've paid" claim never counts in balances. If the same money is then
// recorded another way (say "Mark all paid"), the waiting claim from that person
// to that person is closed as "covered" in the SAME transaction, so when the
// person paid taps "Confirm received" on it later nothing more is recorded. The
// worst case is that the payer taps "I've paid" again; a payment can never count twice.

type Tx = Prisma.TransactionClient;

export type NewPayment = {
  groupId: string;
  fromId: string;
  toId: string;
  amount: number;
  createdById: string;
  needsOk?: boolean;
  okAt?: Date; // set only by "Confirm received": the payment is born confirmed
};

export async function createPayment(tx: Tx, p: NewPayment, now = new Date()) {
  const payment = await tx.payment.create({
    data: { groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount, createdById: p.createdById, needsOk: p.needsOk ?? Boolean(p.okAt), okAt: p.okAt ?? null },
  });
  // At most one claim per pair can be waiting (the unique rule), so this is zero or one row.
  // Only when this payment is at least what the note said: a smaller one leaves the note waiting (the person paid can still confirm it,
  // and the "more than owed" check at that moment catches any overlap).
  const waiting = await tx.paymentClaim.findMany({ where: { groupId: p.groupId, fromId: p.fromId, toId: p.toId, status: "waiting", amount: { lte: p.amount } }, select: { id: true } });
  for (const c of waiting) {
    await tx.paymentClaim.updateMany({
      where: { id: c.id, status: "waiting" },
      data: { status: "covered", slot: c.id, paymentId: payment.id, decidedAt: now, decidedById: p.createdById },
    });
  }
  return payment;
}

// The ONE place a deleted payment is brought back (Undo of "Not received", restore a payment, redo of
// "Mark all paid" or "Settle everything"). Bringing it back makes the money count again, so any "I've paid"
// claim still waiting for the same pair is closed as "covered" in the SAME transaction, exactly like
// createPayment does. Otherwise tapping "Confirm received" on that claim would record the same money a
// second time. Only payments that are deleted right now are touched (`groupId` limits it to one group).
// Returns the ids that really came back, so a repeated tap changes nothing.
//
// One more rule: if "Confirm received" recorded money for the same pair AFTER this payment was deleted, bringing
// the old payment back would count that money twice. So the whole restore is refused (RestoreRefused is thrown, which
// rolls the transaction back, and the caller turns it into the message). Nothing changes.
export class RestoreRefused extends Error {}

export async function restorePayments(tx: Tx, ids: string[], actorId: string, groupId?: string, now = new Date()): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await tx.payment.findMany({
    where: { id: { in: ids }, deletedAt: { not: null }, ...(groupId ? { groupId } : {}) },
    select: { id: true, groupId: true, fromId: true, toId: true, amount: true, deletedAt: true, deletedById: true },
  });
  // A payment the person paid took off ("Not received") can only be brought back by that same person. This is the one place every
  // restore goes through (Undo, Restore payment, Redo of "Mark all paid" and "Settle everything"), so nobody else can overrule them.
  for (const p of rows) {
    if (p.deletedById && p.deletedById === p.toId && actorId !== p.toId) {
      const to = await tx.member.findUnique({ where: { id: p.toId }, select: { name: true } });
      throw new RestoreRefused(receiverOnlyText(to?.name ?? "the person who was paid"));
    }
  }
  for (const p of rows) {
    if (!p.deletedAt) continue;
    const since = await tx.paymentClaim.findFirst({ where: { groupId: p.groupId, fromId: p.fromId, toId: p.toId, status: "confirmed", decidedAt: { gt: p.deletedAt } }, select: { id: true } });
    if (!since) continue;
    const [from, to, group] = await Promise.all([
      tx.member.findUnique({ where: { id: p.fromId }, select: { name: true } }),
      tx.member.findUnique({ where: { id: p.toId }, select: { name: true } }),
      tx.group.findUnique({ where: { id: p.groupId }, select: { currency: true } }),
    ]);
    throw new RestoreRefused(`${from?.name ?? "They"}’s ${formatMoney(p.amount, group?.currency ?? "INR")} payment to ${to?.name ?? "them"} was confirmed since. If both were really paid, record this one again.`);
  }
  const restored: string[] = [];
  for (const p of rows) {
    const back = await tx.payment.updateMany({ where: { id: p.id, deletedAt: { not: null } }, data: { deletedAt: null, deletedById: null } });
    if (back.count !== 1) continue;
    restored.push(p.id);
    const waiting = await tx.paymentClaim.findMany({ where: { groupId: p.groupId, fromId: p.fromId, toId: p.toId, status: "waiting", amount: { lte: p.amount } }, select: { id: true } });
    for (const c of waiting) {
      await tx.paymentClaim.updateMany({
        where: { id: c.id, status: "waiting" },
        data: { status: "covered", slot: c.id, paymentId: p.id, decidedAt: now, decidedById: actorId },
      });
    }
  }
  return restored;
}

// A payment that closed an "I've paid" note as "covered" is taken off (deleted, or "Not received"): the note is waiting again, so the person
// paid can still confirm it. Skipped when another note for the same pair is already waiting (only one may wait: the unique rule).
// Call inside the same transaction as the deletion.
export async function reopenCoveredClaims(tx: Tx, paymentIds: string[]): Promise<void> {
  if (!paymentIds.length) return;
  const covered = await tx.paymentClaim.findMany({ where: { paymentId: { in: paymentIds }, status: "covered" }, select: { id: true, groupId: true, fromId: true, toId: true } });
  for (const c of covered) {
    const other = await tx.paymentClaim.findFirst({ where: { groupId: c.groupId, fromId: c.fromId, toId: c.toId, status: "waiting" }, select: { id: true } });
    if (other) continue;
    await tx.paymentClaim.updateMany({ where: { id: c.id, status: "covered" }, data: { status: "waiting", slot: "", paymentId: "", decidedAt: null, decidedById: "" } });
  }
}
