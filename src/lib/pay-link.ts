import { randomBytes } from "node:crypto";
import { db } from "./db";
import { loadGroup } from "./group-data";

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
      link: { id: string; token: string; groupId: string; fromId: string; toId: string; paymentId: string };
      group: { id: string; name: string; currency: string; closed: boolean };
      fromName: string;
      toName: string;
      toAccountId: string | null;
      amount: number; // what's owed right now (owes) or what they said they paid (said)
      paidAt?: Date;
      confirmed?: boolean; // square because they confirmed the payment made here
    };

// Everything the page needs, worked out fresh from the group's balances.
export async function readPayLink(token: string, now = new Date()): Promise<PayLinkState> {
  if (!TOKEN.test(token)) return { kind: "gone" };
  const link = await db.payLink.findUnique({ where: { token } });
  if (!link || link.expiresAt < now) return { kind: "gone" };
  const data = await loadGroup(link.groupId);
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
  };
  // Said they paid through this link, and it's still waiting for a "Got it".
  const said = link.paymentId ? payments.find((p) => p.id === link.paymentId && p.needsOk && !p.okAt) : undefined;
  if (said) return { kind: "said", ...base, amount: said.amount, paidAt: said.createdAt };
  const owed = transfers.find((t) => t.from === link.fromId && t.to === link.toId)?.amount ?? 0;
  if (group.closed) return { kind: "closed", ...base, amount: owed };
  if (owed <= 0) {
    const last = link.paymentId ? payments.find((p) => p.id === link.paymentId) : undefined;
    return { kind: "square", ...base, amount: last?.amount ?? 0, confirmed: Boolean(last?.okAt) };
  }
  return { kind: "owes", ...base, amount: owed };
}
