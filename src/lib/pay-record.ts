import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { claimKey, fingerprintOf, isDuplicateKey, retryOnceIfBusy } from "./once";
import { loadGroup } from "./group-data";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { createPayment } from "./payments";
import { needsOkFor } from "./payment-ok";
import { GroupChanged, groupChangedText, guardGroup, leaverBalanceBreaks, ledgerInTx } from "./money-guard";

// Recording one payment (Smart Settle's "Mark paid" and "Record a payment"), with the checks done INSIDE the write.
// The server action only reads the form and redirects to what this answers.

// How a payment reads in the history and alerts, after the name of whoever recorded it: "Ravi paid Varun ₹5,000",
// "Varun got ₹5,000 from Ravi", or "Asha recorded Ravi paid Varun ₹5,000".
export function paymentText(actorId: string, fromId: string, toId: string, from: string, to: string, amount: string): string {
  if (actorId === fromId) return `paid ${to} ${amount}`;
  if (actorId === toId) return `got ${amount} from ${from}`;
  return `recorded ${from} paid ${to} ${amount}`;
}

// The most that can be paid from `fromId` to `toId` without either of them flipping to the other side:
// the smaller of what the payer owes in total and what the person paid is owed. `side` says which one sets the limit
// ("to" = the person paid, "from" = the payer; a tie counts as the payer, which keeps the older wording).
export function overpayLimit(net: Record<string, number>, fromId: string, toId: string): { limit: number; side: "to" | "from" } {
  const payerOwes = Math.max(0, -(net[fromId] ?? 0));
  const payeeOwed = Math.max(0, net[toId] ?? 0);
  return payeeOwed < payerOwes ? { limit: payeeOwed, side: "to" } : { limit: payerOwes, side: "from" };
}

// The question asked before recording more than the limit. Amounts are in minor units.
export function overpayQuestion(o: { typed: number; limit: number; side: "to" | "from"; currency: string; fromName: string; toName: string }): string | null {
  if (!Number.isSafeInteger(o.typed) || !Number.isSafeInteger(o.limit) || o.typed <= o.limit) return null;
  const m = (n: number) => formatMoney(n, o.currency);
  if (o.side === "to") {
    if (o.limit <= 0) return `${o.toName} isn't owed anything right now, so ${o.toName} would owe ${o.fromName} ${m(o.typed)} back. Record it anyway?`;
    return `${o.toName} is owed ${m(o.limit)}. Recording ${m(o.typed)} means ${o.toName} will owe ${o.fromName} ${m(o.typed - o.limit)} back. Record it anyway?`;
  }
  return `This is ${m(o.typed - o.limit)} more than what's owed. Record it anyway?`;
}

export type PayOutcome =
  | { kind: "done"; did: string }
  | { kind: "duplicate" } // this request key was already used inside the write
  | { kind: "over"; limit: number; side: "to" | "from" } // more than the limit, and "Record it anyway" wasn't ticked
  | { kind: "refused"; error: string };

class Used extends Error {}
class Over extends Error {
  constructor(public limit: number, public side: "to" | "from") {
    super("over the limit");
  }
}

export type PayInput = {
  groupId: string;
  fromId: string;
  toId: string;
  amount: number; // minor units of `currency`
  currency: string; // the group's currency the amount was typed in (as read before)
  myId: string;
  key?: string;
  fp: string;
  warnOver: boolean; // ask first when it is more than the limit
};

class LeftOut extends Error {}
export async function recordPaymentCore(i: PayInput, opts: { afterRead?: () => Promise<void> } = {}): Promise<PayOutcome> {
  const group = await db.group.findUnique({ where: { id: i.groupId }, select: { name: true, currency: true, members: { select: { id: true, name: true, accountId: true, claimedAt: true } } } });
  if (!group) return { kind: "refused", error: groupChangedText(new GroupChanged("gone")) };
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "Someone";
  await opts.afterRead?.();
  try {
    const did = await retryOnceIfBusy(() => db.$transaction(async (tx: Prisma.TransactionClient) => {
      await guardGroup(tx, i.groupId, { currency: i.currency, actorId: i.myId });
      // The same request again (a double tap, a retry): it already happened, whatever the balances say now.
      if (i.key && (await tx.requestKey.findUnique({ where: { key: i.key }, select: { key: true } }))) throw new Used();
      // Someone who has left may only end with the balance they had, or 0: a new payment with them can't be recorded.
      const gone = await leaverBalanceBreaks(tx, i.groupId, [i.fromId, i.toId], (l) => ({ ...l, payments: [...l.payments, { id: "new-payment", fromId: i.fromId, toId: i.toId, amount: i.amount }] }));
      if (gone.length) throw new LeftOut(gone[0]);
      if (i.warnOver) {
        const { net } = await ledgerInTx(tx, i.groupId);
        const { limit, side } = overpayLimit(net, i.fromId, i.toId);
        if (i.amount > limit) throw new Over(limit, side);
      }
      const p = await createPayment(tx, { groupId: i.groupId, fromId: i.fromId, toId: i.toId, amount: i.amount, createdById: i.myId, needsOk: needsOkFor(group.members.find((m) => m.id === i.toId), i.myId) });
      await claimKey(tx, i.key, p.id, i.fp);
      return logEvent(tx, {
        groupId: i.groupId,
        actorId: i.myId,
        kind: "payment_recorded",
        text: paymentText(i.myId, i.fromId, i.toId, nameOf(i.fromId), nameOf(i.toId), formatMoney(i.amount, i.currency)),
        paymentId: p.id,
        undo: { type: "payment_delete", paymentId: p.id },
      });
    }, { timeout: 15000 }));
    return { kind: "done", did };
  } catch (err) {
    if (err instanceof Used) return { kind: "duplicate" };
    if (err instanceof LeftOut) return { kind: "refused", error: `${err.message} has left the group, so a payment with them can't be recorded.` };
    if (err instanceof Over) return { kind: "over", limit: err.limit, side: err.side };
    if (err instanceof GroupChanged) return { kind: "refused", error: groupChangedText(err) };
    if (isDuplicateKey(err)) return { kind: "duplicate" };
    throw err;
  }
}

// "I've paid" (founder decision, 15 Nov): the payer's own record counts straight away. It is NOT a claim any more:
// it goes through recordPaymentCore, the same guarded write as "Mark paid" and "Record a payment" (group guard, one
// transaction, leaver check, over-the-limit check, an activity line with Undo). Because the person paid is on Loopin,
// the payment is born needsOk, so they see "<name> recorded paying you ₹X" in Updates with a "Not received" button
// (rejectPayment in payment-ok.ts), which soft-deletes it again, with its own Undo.
// The amount is worked out HERE from the group's current Smart Settle plan (never taken from the caller), and
// `expectAmount` (what the screen showed) must still be it, so a stale screen can't record the wrong number.
export async function recordOwnPayment(i: { groupId: string; fromId: string; toId: string; myId: string; expectAmount?: number; key?: string }): Promise<PayOutcome> {
  if (i.fromId !== i.myId) return { kind: "refused", error: "Only the person paying can say they paid. To record someone else’s payment, use Record a different payment." };
  const data = await loadGroup(i.groupId, { events: false });
  if (!data) return { kind: "refused", error: "This group no longer exists." };
  const { group, transfers } = data;
  if (group.closed) return { kind: "refused", error: "This group is closed, so there’s nothing to do." };
  const from = group.members.find((m) => m.id === i.fromId);
  const to = group.members.find((m) => m.id === i.toId);
  if (!from || !to || i.fromId === i.toId) return { kind: "refused", error: "That one isn’t there any more." };
  if (from.leftAt || from.removedAt) return { kind: "refused", error: "You left this group. Rejoin it to make changes." };
  const owed = transfers.find((t) => t.from === i.fromId && t.to === i.toId)?.amount ?? 0;
  if (owed <= 0) return { kind: "refused", error: "Nothing is owed here right now." };
  const changed = "Balances changed since you opened this. Check the updated amount and try again.";
  if (i.expectAmount !== undefined && i.expectAmount !== owed) return { kind: "refused", error: changed };
  const r = await recordPaymentCore({
    groupId: i.groupId,
    fromId: i.fromId,
    toId: i.toId,
    amount: owed,
    currency: group.currency,
    myId: i.myId,
    key: i.key,
    fp: fingerprintOf("pay-own", i.groupId, i.fromId, i.toId, owed),
    warnOver: true, // a change since the read above that makes this more than they owe is refused, never recorded
  });
  return r.kind === "over" ? { kind: "refused", error: changed } : r;
}
