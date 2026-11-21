import { removedText, wasRemoved } from "./active";
import { db } from "./db";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { GroupChanged, groupChangedText, guardGroup, leaversOffZero } from "./money-guard";
import { bringBackLeavers, moveOutPaymentIds, NotSquare } from "./payment-change";
import { tellBroughtBack } from "./payment-claims";
import { GUEST_REFUSAL, madeBeforeFreed, madeSinceClaim } from "./guest-words";

// A flat move-out's final payments are the ONLY payments that still ask the person paid. They count straight away, and the person paid
// can answer: "Got it ✓" or "Not received". Not received takes the payment off the balances (with undo) and brings the people who left
// back into the flat, owing. Every other payment counts at once and is simply deleted if it is wrong (payment-change.ts).
// Which payments are move-out payments is read from the move-out lines themselves (moveOutPaymentIds), so older rows that were
// flagged needsOk by the earlier "tell Asha" rule are never asked about.

type Result = { ok: true; eventId?: string } | { ok: false; error: string };

class Removed extends Error {}

// Only people who can actually tap the button are asked: they've joined (not just a name).
export function needsOkFor(receiver: { id: string; accountId?: string | null; claimedAt?: Date | null } | undefined, actorId: string): boolean {
  return Boolean(receiver && receiver.id !== actorId && (receiver.accountId || receiver.claimedAt));
}

export const ONLY_PAID_TEXT = "Only the person who was paid can confirm it.";

type Answerer = { accountId: string | null; claimedAt: Date | null; freedAt?: Date | null };

// Why this person may not answer this payment, or null when they may. In order:
//  1. no such member: only the person paid can answer
//  2. the payment was made before their name was (last) freed: it belongs to the earlier holder, account or not
//  3. a person with no account may answer only a payment made after they took their name
export function answerRefusal(me: Answerer | null | undefined, payment: { createdAt: Date }): string | null {
  if (!me) return ONLY_PAID_TEXT;
  if (madeBeforeFreed(me.freedAt, payment.createdAt)) return ONLY_PAID_TEXT;
  if (me.accountId === null && !madeSinceClaim(me.claimedAt, payment.createdAt)) return GUEST_REFUSAL;
  return null;
}

export function guestMayAnswer(me: Answerer | null | undefined, payment: { createdAt: Date }): boolean {
  return answerRefusal(me, payment) === null;
}

async function mine(paymentId: string, myMemberId: string | undefined) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { group: { select: { id: true, name: true, currency: true, closed: true, deletedAt: true } }, from: { select: { name: true } }, to: { select: { name: true } } } });
  if (!p || p.deletedAt || p.group.deletedAt) return { error: "That payment isn’t there any more." } as const;
  if (!myMemberId || p.toId !== myMemberId) return { error: ONLY_PAID_TEXT } as const;
  // Someone an admin removed can't change the group's payments: not "Got it", and not "Not received" (which would bring them and the payer back).
  if (await wasRemoved(p.groupId, myMemberId)) return { error: removedText(p.group.name) } as const;
  const me = await db.member.findUnique({ where: { id: myMemberId }, select: { accountId: true, claimedAt: true, freedAt: true } });
  const refused = answerRefusal(me, p);
  if (refused) return { error: refused } as const;
  // Only a flat move-out's final payment can be answered. Everything else already counts: delete it from the activity if it is wrong.
  if (!(await moveOutPaymentIds(db, [p.groupId])).has(p.id)) return { error: "This payment already counts. If it’s wrong, delete it from the activity." } as const;
  // Someone who left may still answer a payment made TO them, and "Not received" is never refused because someone left:
  // the people who left are brought back into the group (see rejectPayment).
  return { p } as const;
}

export async function confirmPayment(paymentId: string, myMemberId: string | undefined): Promise<Result> {
  const r = await mine(paymentId, myMemberId);
  if (!("p" in r) || !r.p) return { ok: false, error: r.error };
  const { p } = r;
  if (p.okAt) return { ok: true };
  let eventId: string;
  try {
    eventId = await db.$transaction(async (tx) => {
    // Again inside the transaction (a removal could have landed since the first look).
    if (await wasRemoved(p.groupId, myMemberId, tx)) throw new Removed(p.group.name);
    const changed = await tx.payment.updateMany({ where: { id: p.id, okAt: null, deletedAt: null }, data: { okAt: new Date() } });
    if (changed.count !== 1) return "";
    return logEvent(tx, { groupId: p.groupId, actorId: myMemberId!, kind: "payment_confirmed", text: `confirmed getting ${formatMoney(p.amount, p.group.currency)} from ${p.from.name} ✓`, paymentId: p.id });
    });
  } catch (err) {
    if (err instanceof Removed) return { ok: false, error: removedText(p.group.name) };
    throw err;
  }
  return { ok: true, eventId: eventId || undefined };
}

export type RejectResult = { ok: true; eventId?: string; back: { id: string; name: string }[] } | { ok: false; error: string };

// "Not received". The payment comes off the balances. The rule is that a person who has left (or was removed) owes nothing and is owed
// nothing, so if the payer and/or the person paid has left, they are put back into the group IN THE SAME TRANSACTION: the money is
// owed again, and the people who owe it can see it and settle it.
// Hand-worked: Asha left after paying Ravi 40000 (both at 0). Ravi says Not received: the payment goes, Asha is back at -40000, Ravi +40000.
export async function rejectPayment(paymentId: string, myMemberId: string | undefined): Promise<RejectResult> {
  const r = await mine(paymentId, myMemberId);
  if (!("p" in r) || !r.p) return { ok: false, error: r.error };
  const { p } = r;
  if (p.okAt) return { ok: false, error: "You already confirmed this one. Delete it from the activity if it was a mistake." };
  if (p.group.closed) return { ok: false, error: "This group is closed. Reopen it to change payments." };
  const amountText = formatMoney(p.amount, p.group.currency);
  let out: { eventId: string; back: { id: string; name: string; accountId: string | null }[] };
  try {
    out = await db.$transaction(async (tx) => {
      // First: the group is still open and in the same currency. (No actor check: a receiver who has left may still answer.)
      await guardGroup(tx, p.groupId, { currency: p.group.currency });
      // Again inside the transaction (a removal could have landed since the first look).
      if (await wasRemoved(p.groupId, myMemberId, tx)) throw new Removed(p.group.name);
      const changed = await tx.payment.updateMany({ where: { id: p.id, deletedAt: null, okAt: null }, data: { deletedAt: new Date(), deletedById: myMemberId } });
      if (changed.count !== 1) return { eventId: "", back: [] };
      const eventId = await logEvent(tx, {
        groupId: p.groupId,
        actorId: myMemberId!,
        kind: "payment_deleted",
        text: `hasn’t received ${amountText} from ${p.from.name}, so it’s off the balances`,
        paymentId: p.id,
        undo: { type: "payment_restore", paymentId: p.id, byReceiver: true }, // only the person paid can bring it back (see refused-payment.ts)
      });
      // Whoever has left or been removed comes back, each written only if still exactly as read (otherwise everything rolls back);
      // then nobody this touched is left (or was left) off zero.
      const back = await bringBackLeavers(tx, { groupId: p.groupId, groupName: p.group.name, amountText, actorId: myMemberId!, people: [p.fromId, p.toId] });
      const off = await leaversOffZero(tx, p.groupId, [p.fromId, p.toId]);
      if (off.length) throw new NotSquare(off[0]);
      return { eventId, back };
    });
  } catch (err) {
    if (err instanceof Removed) return { ok: false, error: removedText(p.group.name) };
    if (err instanceof NotSquare) return { ok: false, error: "Balances just changed. Look again, then try once more." };
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    throw err;
  }
  // Each person put back who has an account is told (after it is saved). The person answering knows already.
  for (const m of out.back) {
    if (m.accountId && m.id !== myMemberId) tellBroughtBack({ groupId: p.groupId, groupName: p.group.name, memberId: m.id, receiverName: p.to.name, amountText, paymentId: p.id, receiverId: myMemberId });
  }
  return { ok: true, eventId: out.eventId || undefined, back: out.back.map((m) => ({ id: m.id, name: m.name })) };
}

// Payments waiting for this person's "Got it". `from` carries whether the payer has left, for the wording of the "Not received" question.
// Only move-out final payments (older needsOk rows from the earlier rule are not asked about).
export async function waitingForMe(groupId: string, myMemberId: string) {
  const rows = await db.payment.findMany({ where: { groupId, toId: myMemberId, needsOk: true, okAt: null, deletedAt: null }, include: { from: { select: { name: true, leftAt: true, removedAt: true } } }, orderBy: { createdAt: "desc" }, take: 20 });
  if (!rows.length) return rows;
  if (await wasRemoved(groupId, myMemberId)) return []; // someone an admin removed can't answer it, so it isn't shown to them
  const mine = await moveOutPaymentIds(db, [groupId]);
  const me = await db.member.findUnique({ where: { id: myMemberId }, select: { accountId: true, claimedAt: true, freedAt: true } });
  return rows.filter((r) => mine.has(r.id) && guestMayAnswer(me, r)); // a payment from before they took the name is not theirs to answer
}
