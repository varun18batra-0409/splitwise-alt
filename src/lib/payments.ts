import type { Prisma } from "@prisma/client";
import { formatMoney, MAX_MINOR } from "./money";
import type { Db } from "./events";
import { payerFlagged, payerOnlyText, receiverOnlyText } from "./refused-payment";
import { moveOutAgainIfSquare } from "./settling-db";

// The ONE place a payment row is written. Every route that records a payment
// (Mark paid, Record a payment, Mark all paid, Settle everything, cross-group
// settle, pay link, move-out) calls createPayment inside its own
// transaction. A test (tests/payments-guard.test.ts) fails if tx.payment.create
// shows up anywhere else, apart from the Splitwise import.
//
// Every payment counts straight away (Batch C). The only payments that still ask the person paid
// ("Got it / Not received") are a flat move-out's final payments: those pass `asksReceiver`.

type Tx = Prisma.TransactionClient;

export type NewPayment = {
  groupId: string;
  fromId: string;
  toId: string;
  amount: number;
  createdById: string;
  asksReceiver?: true; // move-out square-up only: the person paid can say "Got it" / "Not received" (payment-ok.ts)
};

// One payment is a whole number of the smallest unit between 1 and MAX_MINOR (the database's Int limit is 2,147,483,647, so a bigger
// one could not be stored). A debt bigger than that is recorded as two payments. Thrown inside the caller's transaction, so nothing is saved.
export class PaymentTooBig extends Error {}

// Where the currency isn't at hand (the combined Settle up screens): the same sentence without the figure.
export const PAYMENT_TOO_BIG_SHORT = "That’s more than one payment can record. Record it as two payments.";

export const paymentTooBigText = (currency: string) => `That’s more than one payment can record (${formatMoney(MAX_MINOR, currency)}). Record it as two payments.`;

export async function createPayment(tx: Tx, p: NewPayment) {
  if (!Number.isSafeInteger(p.amount) || p.amount < 1 || p.amount > MAX_MINOR) {
    const g = await tx.group.findUnique({ where: { id: p.groupId }, select: { currency: true } });
    throw new PaymentTooBig(paymentTooBigText(g?.currency ?? "INR"));
  }
  const made = await tx.payment.create({
    data: { groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount, createdById: p.createdById, needsOk: Boolean(p.asksReceiver), okAt: null },
  });
  // Someone settling up only who is now exactly square is moved out again, in this same transaction (settling-db.ts). It is done HERE, with
  // restorePayments below, so no way of recording or putting back a payment can forget it.
  await moveOutAgainIfSquare(tx, p.groupId, [p.fromId, p.toId]);
  return made;
}

// The ONE place a deleted payment is brought back (Undo of a delete, restore a payment, redo of
// "Mark all paid" or "Settle everything"). Returns the ids that really came back, so a repeated tap changes nothing.
//
// Two rules refuse the whole restore (RestoreRefused is thrown, which rolls the transaction back, and the caller turns it into the message):
// 1. A payment the person paid took off ("Not received", or their own delete) can only be brought back by that same person (MB-1).
// 2. If a newer payment between the same two people, in the same direction, was recorded after (or in the same instant as) this one's deletion, bringing the old one
//    back would count that money twice. Hand-worked: Ravi deletes Asha's 40000; Asha records 40000 again; restoring the first would make
//    Asha's total 80000 against a debt of 40000. Refused; nothing changes.
export class RestoreRefused extends Error {}

// Did the payer take this payment off as a covering payment ("I can’t cover it")? Read from the payment's latest "taken off" line.
export async function takenOffByPayerLine(client: Db, p: { id: string; fromId: string; deletedById: string | null }): Promise<boolean> {
  if (!p.deletedById || p.deletedById !== p.fromId) return false;
  const line = await client.groupEvent.findFirst({ where: { paymentId: p.id, kind: "payment_deleted" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { undo: true } });
  return payerFlagged(line?.undo);
}

export async function restorePayments(tx: Tx, ids: string[], actorId: string, groupId?: string): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await tx.payment.findMany({
    where: { id: { in: ids }, deletedAt: { not: null }, ...(groupId ? { groupId } : {}) },
    select: { id: true, groupId: true, fromId: true, toId: true, amount: true, deletedAt: true, deletedById: true },
  });
  // This is the one place every restore goes through (Undo, Restore payment, Redo of "Mark all paid" and "Settle everything"),
  // so nobody can overrule the person paid.
  for (const p of rows) {
    if (p.deletedById && p.deletedById === p.toId && actorId !== p.toId) {
      const to = await tx.member.findUnique({ where: { id: p.toId }, select: { name: true } });
      throw new RestoreRefused(receiverOnlyText(to?.name ?? "the person who was paid"));
    }
  }
  // The same for a covering payment its payer took off ("I can’t cover it"): only the payer can bring it back, so the leaver can't put it back on them.
  for (const p of rows) {
    if (actorId !== p.fromId && (await takenOffByPayerLine(tx, p))) {
      const from = await tx.member.findUnique({ where: { id: p.fromId }, select: { name: true } });
      throw new RestoreRefused(payerOnlyText(from?.name ?? "the person asked to cover it"));
    }
  }
  for (const p of rows) {
    if (!p.deletedAt) continue;
    const newer = await tx.payment.findFirst({ where: { groupId: p.groupId, fromId: p.fromId, toId: p.toId, deletedAt: null, id: { not: p.id }, createdAt: { gte: p.deletedAt } }, select: { id: true } });
    if (!newer) continue;
    const [from, to, group] = await Promise.all([
      tx.member.findUnique({ where: { id: p.fromId }, select: { name: true } }),
      tx.member.findUnique({ where: { id: p.toId }, select: { name: true } }),
      tx.group.findUnique({ where: { id: p.groupId }, select: { currency: true } }),
    ]);
    throw new RestoreRefused(`${from?.name ?? "They"}’s ${formatMoney(p.amount, group?.currency ?? "INR")} payment to ${to?.name ?? "them"} was recorded again since. If both were really paid, record this one again.`);
  }
  const restored: string[] = [];
  for (const p of rows) {
    const back = await tx.payment.updateMany({ where: { id: p.id, deletedAt: { not: null } }, data: { deletedAt: null, deletedById: null } });
    if (back.count === 1) restored.push(p.id);
  }
  // A payment put back can make a settling person square (Undo of "Not received", Redo of "Mark all paid"): same rule as a new payment.
  const back = rows.filter((p) => restored.includes(p.id));
  for (const g of new Set(back.map((p) => p.groupId))) {
    await moveOutAgainIfSquare(tx, g, back.filter((p) => p.groupId === g).flatMap((p) => [p.fromId, p.toId]));
  }
  return restored;
}
