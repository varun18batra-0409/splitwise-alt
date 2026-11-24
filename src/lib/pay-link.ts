import { randomBytes } from "node:crypto";
import { db } from "./db";
import { loadGroup } from "./group-data";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { createPayment, PaymentTooBig } from "./payments";
import { tellParties } from "./payment-claims";
import { guardGroup, ledgerInTx } from "./money-guard";
import { moveOutAgainIfSquare } from "./settling-db";
import type { Prisma } from "@prisma/client";

// "I've paid" links. When Asha reminds Ravi from Settle up, the WhatsApp
// message carries a link that only does one thing: Ravi opens it (no sign-in),
// pays Asha with UPI, taps "I've paid", and it counts straight away: Asha is told, and can open it and delete it if it is wrong.
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
      kind: "owes" | "paid" | "square" | "closed";
      currency: string; // the group's currency
      link: { id: string; token: string; groupId: string; fromId: string; toId: string; paymentId: string };
      group: { id: string; name: string; currency: string; closed: boolean };
      fromName: string;
      toName: string;
      toAccountId: string | null;
      amount: number; // what's owed right now (owes) or what was recorded through this link (paid)
      paidAt?: Date; // paid: when it was recorded
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
  const owed = transfers.find((t) => t.from === link.fromId && t.to === link.toId)?.amount ?? 0;
  if (group.closed) return { kind: "closed", ...base, amount: owed };
  // A payment made through this link that still counts (loadGroup only holds payments that aren't deleted), and nothing more is owed.
  const made = link.paymentId ? payments.find((p) => p.id === link.paymentId) : undefined;
  if (owed <= 0) return made ? { kind: "paid", ...base, amount: made.amount, paidAt: made.createdAt } : { kind: "square", ...base, amount: 0 };
  return { kind: "owes", ...base, amount: owed };
}

// What `from` owes `to` right now in the settle plan, read INSIDE the given transaction (so it is the same data the
// write will see). Same working as loadGroup: every member, expenses and payments that aren't deleted.
export async function owedInTx(tx: Prisma.TransactionClient, groupId: string, fromId: string, toId: string): Promise<number> {
  // The members are read in the group's own order (oldest first), exactly as the page does: the settle plan's exact-match pass depends on
  // that order, so reading them in any other order could give a different plan and refuse a payment the page showed.
  return (await ledgerInTx(tx, groupId)).transfers.find((t) => t.from === fromId && t.to === toId)?.amount ?? 0;
}

// "I've paid" from the link: recorded as a payment right away (it counts now), and the person paid is told. Only the debt shown (`amount`)
// is recorded, and only one tap wins: the link must still point at the payment it was read with.
export async function recordLinkPayment(s: { link: { id: string; groupId: string; fromId: string; toId: string; paymentId: string }; amount: number; currency: string; toName: string; fromName?: string; groupName?: string }): Promise<boolean | "toobig"> {
  const amountText = formatMoney(s.amount, s.currency);
  // Only what is really owed right now (balances may have moved since the page was read).
  const fresh = await loadGroup(s.link.groupId, { events: false });
  if (!fresh || fresh.group.closed || fresh.transfers.find((t) => t.from === s.link.fromId && t.to === s.link.toId)?.amount !== s.amount) return false;
  let made: { paymentId: string; eventId: string } | null = null;
  try {
    made = await db.$transaction(async (tx) => {
      // The group must still be as read (same currency, open), then checked again inside the write: someone may have
      // recorded this money between the read above and now.
      await guardGroup(tx, s.link.groupId, { currency: s.currency });
      if ((await owedInTx(tx, s.link.groupId, s.link.fromId, s.link.toId)) !== s.amount) throw new Error("no longer owed");
      const p = await createPayment(tx, { groupId: s.link.groupId, fromId: s.link.fromId, toId: s.link.toId, amount: s.amount, createdById: s.link.fromId });
      const claimed = await tx.payLink.updateMany({ where: { id: s.link.id, paymentId: s.link.paymentId }, data: { paymentId: p.id } });
      if (claimed.count !== 1) throw new Error("double tap"); // the other tap won: this payment is rolled back
      const eventId = await logEvent(tx, {
        groupId: s.link.groupId,
        actorId: s.link.fromId,
        kind: "payment_recorded",
        text: `paid ${s.toName} ${amountText} (from the reminder link)`,
        paymentId: p.id,
        undo: { type: "payment_delete", paymentId: p.id },
      });
      await moveOutAgainIfSquare(tx, s.link.groupId, [s.link.fromId, s.link.toId]); // settling up only and now square: moved out again, in this step
      return { paymentId: p.id, eventId };
    });
  } catch (err) {
    return err instanceof PaymentTooBig ? "toobig" : false; // "toobig": more than one payment can record, so nothing was recorded
  }
  tellParties({
    event: "recorded", actorId: s.link.fromId, actorName: fresh.group.members.find((m) => m.id === s.link.fromId)?.name ?? "Someone", fromId: s.link.fromId, toId: s.link.toId,
    fromName: fresh.group.members.find((m) => m.id === s.link.fromId)?.name ?? "Someone", toName: s.toName, amountText, groupName: fresh.group.name, groupId: s.link.groupId,
    paymentId: made.paymentId, eventId: made.eventId, direct: fresh.group.type === "direct",
  });
  return true;
}
