import { db } from "./db";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { GroupChanged, groupChangedText, guardGroup, leaversOffZero } from "./money-guard";
import { reopenCoveredClaims } from "./payments";
import { tellBroughtBack } from "./payment-claims";

// Payment tracking (older payments only: new "I've paid" taps are claims, see payment-claims.ts). When someone other than the person paid records a payment
// ("Ravi paid Asha ₹300"), it counts straight away (as before) but Asha is
// asked: "Got it ✓" or "Not received". Not received takes it off the balances
// (with undo), so nobody is out of pocket on someone's word.

type Result = { ok: true; eventId?: string } | { ok: false; error: string };

// Only people who can actually tap the button are asked: they've joined (not just a name).
export function needsOkFor(receiver: { id: string; accountId?: string | null; claimedAt?: Date | null } | undefined, actorId: string): boolean {
  return Boolean(receiver && receiver.id !== actorId && (receiver.accountId || receiver.claimedAt));
}

async function mine(paymentId: string, myMemberId: string | undefined) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { group: { select: { id: true, name: true, currency: true, closed: true, deletedAt: true } }, from: { select: { name: true } }, to: { select: { name: true } } } });
  if (!p || p.deletedAt || p.group.deletedAt) return { error: "That payment isn’t there any more." } as const;
  if (!myMemberId || p.toId !== myMemberId) return { error: "Only the person who was paid can confirm it." } as const;
  // Someone who left may still answer a payment made TO them, and "Not received" is never refused because someone left:
  // the people who left are brought back into the group (see rejectPayment).
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

export type RejectResult = { ok: true; eventId?: string; back: { id: string; name: string }[] } | { ok: false; error: string };

// "Not received". The payment comes off the balances. The rule is that a person who has left (or was removed) owes nothing and is owed
// nothing, so if the payer and/or the person paid has left, they are put back into the group IN THE SAME TRANSACTION: the money is
// owed again, and the people who owe it can see it and settle it.
// Hand-worked: Asha left after paying Ravi 40000 (both at 0). Ravi says Not received: the payment goes, Asha is back at -40000, Ravi +40000.
class NotSquare extends Error {
  constructor(public who: string) {
    super("not square");
  }
}

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
      // The payer and the person paid, as they are now (inside the write).
      const people = await tx.member.findMany({
        where: { groupId: p.groupId, id: { in: [p.fromId, p.toId] } },
        select: { id: true, name: true, leftAt: true, removedAt: true, removedById: true, accountId: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const changed = await tx.payment.updateMany({ where: { id: p.id, deletedAt: null, okAt: null }, data: { deletedAt: new Date(), deletedById: myMemberId } });
      if (changed.count !== 1) return { eventId: "", back: [] };
      await reopenCoveredClaims(tx, [p.id]); // a note this payment had closed as "covered" is waiting again, so Asha can still confirm it
      const eventId = await logEvent(tx, {
        groupId: p.groupId,
        actorId: myMemberId!,
        kind: "payment_deleted",
        text: `hasn’t received ${amountText} from ${p.from.name}, so it’s off the balances`,
        paymentId: p.id,
        undo: { type: "payment_restore", paymentId: p.id, byReceiver: true }, // only the person paid can bring it back (see refused-payment.ts)
      });
      // Whoever has left or been removed comes back, each written only if still exactly as read (otherwise everything rolls back).
      const back: { id: string; name: string; accountId: string | null }[] = [];
      for (const m of people) {
        if (!m.leftAt && !m.removedAt) continue;
        const wrote = await tx.member.updateMany({ where: { id: m.id, leftAt: m.leftAt, removedAt: m.removedAt }, data: { leftAt: null, removedAt: null, removedById: "" } });
        if (wrote.count !== 1) throw new NotSquare(m.name);
        // The undo of this line puts them back exactly as they were (the same shape as invitations.ts).
        const undoData: { leftAt?: string | null; removedAt?: string | null; removedById?: string } = m.removedAt
          ? { leftAt: (m.leftAt ?? m.removedAt).toISOString(), removedAt: m.removedAt.toISOString(), removedById: m.removedById }
          : { leftAt: m.leftAt!.toISOString() };
        await logEvent(tx, {
          groupId: p.groupId,
          actorId: myMemberId!,
          kind: "member_rejoined",
          text: m.id === myMemberId ? `came back into ${p.group.name} until the ${amountText} is sorted` : `brought ${m.name} back into ${p.group.name} until the ${amountText} is sorted`,
          undo: { type: "member_set", memberId: m.id, data: undoData },
          touches: [m.id], // no paymentId: this line never stands in the way of undoing the "Not received"
        });
        back.push({ id: m.id, name: m.name, accountId: m.accountId });
      }
      // Last check: nobody this touched is left (or was left) off zero.
      const off = await leaversOffZero(tx, p.groupId, [p.fromId, p.toId]);
      if (off.length) throw new NotSquare(off[0]);
      return { eventId, back };
    });
  } catch (err) {
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
export async function waitingForMe(groupId: string, myMemberId: string) {
  return db.payment.findMany({ where: { groupId, toId: myMemberId, needsOk: true, okAt: null, deletedAt: null }, include: { from: { select: { name: true, leftAt: true, removedAt: true } } }, orderBy: { createdAt: "desc" }, take: 20 });
}
