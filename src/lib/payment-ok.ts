import { db } from "./db";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { GroupChanged, groupChangedText, guardGroup, LeaverBreak, removedPaymentsBreak } from "./money-guard";

// Payment tracking. A payment recorded by the payer ("I've paid", from 15 Nov 2026) or by anyone else for them ("Ravi paid Asha ₹300")
// counts straight away, but Asha (when she is on Loopin) is told in Updates and can tap "Confirm received" or "Not received".
// "Not received" is the reversal: it soft-deletes the payment (who did it is kept in deletedById), writes an activity line
// "Asha said they didn’t receive ₹300 from Ravi" that the payer is notified of, and has its own Undo. It works until she
// confirms, the group is closed, or something has moved since (the currency, or a person who has left).
// (Claims made before 15 Nov that are still waiting are answered in payment-claims.ts, as before.)

type Result = { ok: true; eventId?: string } | { ok: false; error: string };

// Only people who can actually tap the button are asked: they've joined (not just a name).
export function needsOkFor(receiver: { id: string; accountId?: string | null; claimedAt?: Date | null } | undefined, actorId: string): boolean {
  return Boolean(receiver && receiver.id !== actorId && (receiver.accountId || receiver.claimedAt));
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
    return logEvent(tx, {
      groupId: p.groupId,
      actorId: myMemberId!,
      kind: "payment_deleted",
      text: `said they didn’t receive ${formatMoney(p.amount, p.group.currency)} from ${p.from.name}, so it’s off the balances`,
      paymentId: p.id,
      undo: { type: "payment_restore", paymentId: p.id },
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
