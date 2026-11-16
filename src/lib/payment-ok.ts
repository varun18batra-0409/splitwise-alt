import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { GroupChanged, groupChangedText, guardGroup, LeaverBreak, removedPaymentsBreak } from "./money-guard";
import { reopenCoveredClaims } from "./payments";

// Payment tracking (older payments only: new "I've paid" taps are claims, see payment-claims.ts). When someone other than the person paid records a payment
// ("Ravi paid Asha ₹300"), it counts straight away (as before) but Asha is
// asked: "Got it ✓" or "Not received". Not received takes it off the balances
// (with undo), so nobody is out of pocket on someone's word.

type Result = { ok: true; eventId?: string } | { ok: false; error: string };

// Only people who can actually tap the button are asked: they've joined (not just a name).
export function needsOkFor(receiver: { id: string; accountId?: string | null; claimedAt?: Date | null } | undefined, actorId: string): boolean {
  return Boolean(receiver && receiver.id !== actorId && (receiver.accountId || receiver.claimedAt));
}

// One rule for every route that records a payment (Record a payment, Mark paid, Mark all paid, Settle everything, card games, cross-group settle,
// the pay link): when the payer or the person paid has LEFT the group, and the person paid can tap "Got it / Not received", only the person paid
// may record it (recording it is confirming it). Anyone else would be counting a leaver's debt as paid with no way for the receiver to refuse it.
// A payment to a plain name (nobody to ask) is not affected. Read INSIDE the transaction. Returns the words of the refusal, or null.
// Hand-worked: Asha left owing Ravi 40000. Meera records "Asha paid Ravi 40000": refused. Ravi records it himself: fine.
export async function thirdPartyLeaverRefusal(tx: Prisma.TransactionClient, groupId: string, fromId: string, toId: string, actorId: string): Promise<string | null> {
  if (toId === actorId) return null;
  const rows = await tx.member.findMany({ where: { groupId, id: { in: [fromId, toId] } }, select: { id: true, name: true, leftAt: true, accountId: true, claimedAt: true } });
  const to = rows.find((m) => m.id === toId);
  if (!to || !needsOkFor(to, actorId)) return null;
  const from = rows.find((m) => m.id === fromId);
  const gone = from?.leftAt ? from : to.leftAt ? to : undefined;
  return gone ? `${gone.name} has left. Only ${to.name} can mark this as received.` : null;
}

async function mine(paymentId: string, myMemberId: string | undefined) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { group: { select: { id: true, currency: true, closed: true, deletedAt: true } }, from: { select: { name: true } }, to: { select: { name: true } } } });
  if (!p || p.deletedAt || p.group.deletedAt) return { error: "That payment isn’t there any more." } as const;
  if (!myMemberId || p.toId !== myMemberId) return { error: "Only the person who was paid can confirm it." } as const;
  // Someone who left may still answer a claim for money paid TO them. Removing a payment that already counts ("Not received"
  // below) follows the leaver rule like every other change: it may not move a leaver's balance anywhere but back to 0.
  return { p } as const;
}

export async function confirmPayment(paymentId: string, myMemberId: string | undefined): Promise<Result> {
  const r = await mine(paymentId, myMemberId);
  if (!("p" in r) || !r.p) return { ok: false, error: r.error };
  const { p } = r;
  if (p.okAt) return { ok: true };
  const eventId = await db.$transaction(async (tx) => {
    const changed = await tx.payment.updateMany({ where: { id: p.id, okAt: null, deletedAt: null }, data: { okAt: new Date() } });
    if (changed.count !== 1) return "";
    return logEvent(tx, { groupId: p.groupId, actorId: myMemberId!, kind: "payment_confirmed", text: `confirmed getting ${formatMoney(p.amount, p.group.currency)} from ${p.from.name} ✓`, paymentId: p.id });
  });
  return { ok: true, eventId: eventId || undefined };
}

export async function rejectPayment(paymentId: string, myMemberId: string | undefined): Promise<Result> {
  const r = await mine(paymentId, myMemberId);
  if (!("p" in r) || !r.p) return { ok: false, error: r.error };
  const { p } = r;
  if (p.okAt) return { ok: false, error: "You already confirmed this one. Delete it from the activity if it was a mistake." };
  if (p.group.closed) return { ok: false, error: "This group is closed. Reopen it to change payments." };
  let eventId: string;
  try {
  eventId = await db.$transaction(async (tx) => {
    // First: the group is still open and in the same currency. (No actor check: a receiver who has left may still answer.)
    await guardGroup(tx, p.groupId, { currency: p.group.currency });
    // Taking a payment off the balances must not leave someone who has left owing (or owed) anything new. (Answering a
    // claim is different and stays open to a receiver who has left.)
    const gone = await removedPaymentsBreak(tx, p.groupId, [p.id]);
    if (gone.length) throw new LeaverBreak(gone[0], "changed here");
    const changed = await tx.payment.updateMany({ where: { id: p.id, deletedAt: null, okAt: null }, data: { deletedAt: new Date(), deletedById: myMemberId } });
    if (changed.count !== 1) return "";
    await reopenCoveredClaims(tx, [p.id]); // a note this payment had closed as "covered" is waiting again, so Asha can still confirm it
    return logEvent(tx, {
      groupId: p.groupId,
      actorId: myMemberId!,
      kind: "payment_deleted",
      text: `hasn’t received ${formatMoney(p.amount, p.group.currency)} from ${p.from.name}, so it’s off the balances`,
      paymentId: p.id,
      undo: { type: "payment_restore", paymentId: p.id, byReceiver: true }, // only the person paid can bring it back (see refused-payment.ts)
    });
  });
  } catch (err) {
    if (err instanceof LeaverBreak) return { ok: false, error: err.message };
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    throw err;
  }
  return { ok: true, eventId: eventId || undefined };
}

// Payments waiting for this person's "Got it".
export async function waitingForMe(groupId: string, myMemberId: string) {
  return db.payment.findMany({ where: { groupId, toId: myMemberId, needsOk: true, okAt: null, deletedAt: null }, include: { from: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 });
}
