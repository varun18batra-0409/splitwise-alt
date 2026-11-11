import { randomBytes } from "node:crypto";
import { db } from "./db";
import { loadGroup } from "./group-data";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { createPayment } from "./payments";
import { needsOkFor } from "./payment-ok";

// "I've paid" links. When Asha reminds Ravi from Settle up, the WhatsApp
// message carries a link that only does one thing: Ravi opens it (no sign-in),
// pays Asha with UPI, taps "I've paid", and Asha is asked "Did you get this?".
//
// Safe by design: the token is long and random (unguessable), it belongs to
// exactly one pair of people in one group, it can only ever record what Ravi
// owes Asha right now (never another amount), and it stops working once
// nothing is owed, the group is closed, or 30 days pass.

export const PAY_LINK_DAYS = 30;
const TOKEN = /^[A-Za-z0-9_-]{20,40}$/;

export function newPayToken(): string {
  return randomBytes(16).toString("base64url"); // 22 characters, 128 bits
}

// The link for "fromId owes toId" in this group: the same one each time (so an
// older message keeps working), with its 30 days started again.
export async function payLinkFor(groupId: string, fromId: string, toId: string, createdById: string, now = new Date()): Promise<string> {
  const expiresAt = new Date(now.getTime() + PAY_LINK_DAYS * 86_400_000);
  const found = await db.payLink.findUnique({ where: { groupId_fromId_toId: { groupId, fromId, toId } } });
  if (found) {
    await db.payLink.update({ where: { id: found.id }, data: { expiresAt } });
    return found.token;
  }
  try {
    const made = await db.payLink.create({ data: { token: newPayToken(), groupId, fromId, toId, createdById, expiresAt } });
    return made.token;
  } catch {
    // Made at the same moment by another tap: use that one.
    const again = await db.payLink.findUnique({ where: { groupId_fromId_toId: { groupId, fromId, toId } } });
    if (!again) throw new Error("Couldn’t make the link");
    return again.token;
  }
}

export type PayLinkState =
  | { kind: "gone" } // unknown, expired, or the group is gone
  | {
      kind: "owes" | "said" | "square" | "closed";
      currency: string; // the currency of `amount`: the group's now, or the waiting claim's own
      link: { id: string; token: string; groupId: string; fromId: string; toId: string; paymentId: string };
      group: { id: string; name: string; currency: string; closed: boolean };
      fromName: string;
      toName: string;
      toAccountId: string | null;
      amount: number; // what's owed right now (owes) or what they said they paid (said)
      paidAt?: Date;
      confirmed?: boolean; // square because they confirmed the payment made here
      claimId?: string; // said: the waiting "I've paid" claim (absent = an older payment that already counts and waits for "Confirm received")
      declined?: boolean; // owes: the person paid said "Not received" to the last "I've paid"
    };

// Everything the page needs, worked out fresh from the group's balances.
export async function readPayLink(token: string, now = new Date()): Promise<PayLinkState> {
  if (!TOKEN.test(token)) return { kind: "gone" };
  const link = await db.payLink.findUnique({ where: { token } });
  if (!link || link.expiresAt < now) return { kind: "gone" };
  const data = await loadGroup(link.groupId, { events: false });
  if (!data) return { kind: "gone" };
  const { group, transfers, payments } = data;
  const from = group.members.find((m) => m.id === link.fromId);
  const to = group.members.find((m) => m.id === link.toId);
  if (!from || !to) return { kind: "gone" };
  const base = {
    link: { id: link.id, token: link.token, groupId: link.groupId, fromId: link.fromId, toId: link.toId, paymentId: link.paymentId },
    group: { id: group.id, name: group.name, currency: group.currency, closed: group.closed },
    fromName: from.name,
    toName: to.name,
    toAccountId: to.accountId,
    currency: group.currency,
  };
  // An older payment made through this link (it already counts in the balances) still waiting for "Confirm received".
  const said = link.paymentId ? payments.find((p) => p.id === link.paymentId && p.needsOk && !p.okAt) : undefined;
  if (said) return { kind: "said", ...base, amount: said.amount, paidAt: said.createdAt };
  // A new "I've paid": a claim waiting for the person paid. It is not in the balances.
  const claim = await db.paymentClaim.findFirst({ where: { groupId: link.groupId, fromId: link.fromId, toId: link.toId, status: "waiting" } });
  // The claim is shown in the currency it was made in, even if the group's currency changed since.
  if (claim) return group.closed ? { kind: "closed", ...base, currency: claim.currency, amount: claim.amount } : { kind: "said", ...base, currency: claim.currency, amount: claim.amount, paidAt: claim.createdAt, claimId: claim.id };
  const owed = transfers.find((t) => t.from === link.fromId && t.to === link.toId)?.amount ?? 0;
  if (group.closed) return { kind: "closed", ...base, amount: owed };
  if (owed <= 0) {
    const last = link.paymentId ? payments.find((p) => p.id === link.paymentId) : undefined;
    return { kind: "square", ...base, amount: last?.amount ?? 0, confirmed: Boolean(last?.okAt) };
  }
  const latest = await db.paymentClaim.findFirst({ where: { groupId: link.groupId, fromId: link.fromId, toId: link.toId }, orderBy: { createdAt: "desc" }, select: { status: true } });
  if (latest?.status === "declined") return { kind: "owes", ...base, amount: owed, declined: true };
  return { kind: "owes", ...base, amount: owed };
}

// "I've paid" for someone who can't tap "Confirm received" (the person owed is only a name, or has no account):
// there is nobody to ask, so it is recorded as a payment right away, as before claims existed. It counts now,
// and is flagged for "Got it / Not received" only if the person owed can answer. Only the debt shown (`amount`) is
// recorded, and only one tap wins: the link must still point at the payment it was read with.
export async function recordLinkPayment(s: { link: { id: string; groupId: string; fromId: string; toId: string; paymentId: string }; amount: number; currency: string; toName: string }): Promise<boolean> {
  const to = await db.member.findUnique({ where: { id: s.link.toId }, select: { id: true, accountId: true, claimedAt: true } });
  const amountText = formatMoney(s.amount, s.currency);
  // Only what is really owed right now (balances may have moved since the page was read).
  const fresh = await loadGroup(s.link.groupId, { events: false });
  if (!fresh || fresh.group.closed || fresh.transfers.find((t) => t.from === s.link.fromId && t.to === s.link.toId)?.amount !== s.amount) return false;
  try {
    return await db.$transaction(async (tx) => {
      const p = await createPayment(tx, { groupId: s.link.groupId, fromId: s.link.fromId, toId: s.link.toId, amount: s.amount, createdById: s.link.fromId, needsOk: needsOkFor(to ?? undefined, s.link.fromId) });
      const claimed = await tx.payLink.updateMany({ where: { id: s.link.id, paymentId: s.link.paymentId }, data: { paymentId: p.id } });
      if (claimed.count !== 1) throw new Error("double tap"); // the other tap won: this payment is rolled back
      await logEvent(tx, {
        groupId: s.link.groupId,
        actorId: s.link.fromId,
        kind: "payment_recorded",
        text: `paid ${s.toName} ${amountText} (from the reminder link)`,
        paymentId: p.id,
        undo: { type: "payment_delete", paymentId: p.id },
      });
      return true;
    });
  } catch {
    return false;
  }
}
