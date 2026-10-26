import { db } from "./db";
import { logEvent } from "./events";
import { formatMoney } from "./money";

// Payment tracking. When someone other than the person paid records a payment
// ("Ravi paid Asha ₹300"), it counts straight away (as before) but Asha is
// asked: "Got it ✓" or "Not received". Not received takes it off the balances
// (with undo), so nobody is out of pocket on someone's word.

type Result = { ok: true; eventId?: string } | { ok: false; error: string };

// Only people who can actually tap the button are asked: they've joined (not just a name).
export function needsOkFor(receiver: { id: string; accountId?: string | null; claimedAt?: Date | null } | undefined, actorId: string): boolean {
  return Boolean(receiver && receiver.id !== actorId && (receiver.accountId || receiver.claimedAt));
}

async function mine(paymentId: string, myMemberId: string | undefined) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { group: { select: { id: true, currency: true, closed: true, deletedAt: true } }, from: { select: { name: true } }, to: { select: { name: true } } } });
  if (!p || p.deletedAt || p.group.deletedAt) return { error: "That payment isn’t there any more." } as const;
  if (!myMemberId || p.toId !== myMemberId) return { error: "Only the person who was paid can confirm it." } as const;
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
  const eventId = await db.$transaction(async (tx) => {
    const changed = await tx.payment.updateMany({ where: { id: p.id, deletedAt: null, okAt: null }, data: { deletedAt: new Date(), deletedById: myMemberId } });
    if (changed.count !== 1) return "";
    return logEvent(tx, {
      groupId: p.groupId,
      actorId: myMemberId!,
      kind: "payment_deleted",
      text: `hasn’t received ${formatMoney(p.amount, p.group.currency)} from ${p.from.name}, so it’s off the balances`,
      paymentId: p.id,
      undo: { type: "payment_restore", paymentId: p.id },
    });
  });
  return { ok: true, eventId: eventId || undefined };
}

// Payments waiting for this person's "Got it".
export async function waitingForMe(groupId: string, myMemberId: string) {
  return db.payment.findMany({ where: { groupId, toId: myMemberId, needsOk: true, okAt: null, deletedAt: null }, include: { from: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 });
}
