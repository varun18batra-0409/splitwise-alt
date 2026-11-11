import type { Prisma } from "@prisma/client";

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
  const waiting = await tx.paymentClaim.findMany({ where: { groupId: p.groupId, fromId: p.fromId, toId: p.toId, status: "waiting" }, select: { id: true } });
  for (const c of waiting) {
    await tx.paymentClaim.updateMany({
      where: { id: c.id, status: "waiting" },
      data: { status: "covered", slot: c.id, paymentId: payment.id, decidedAt: now, decidedById: p.createdById },
    });
  }
  return payment;
}
