import { after } from "next/server";
import { db } from "./db";
import { loadGroup } from "./group-data";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { createPayment } from "./payments";
import { withRetry } from "./once";
import { needsOkFor } from "./payment-ok";

// "I've paid" claims. Ravi says he paid Asha. That is a claim, NOT a payment:
// it never changes a balance. It waits for Asha's "Confirm received", which
// records the real payment (already confirmed) in the same step. "Not received"
// closes the claim and nothing else changes. See prisma/schema.prisma (PaymentClaim).

export type ClaimStatus = "waiting" | "confirmed" | "declined" | "withdrawn" | "covered" | "expired";
export type ClaimSource = "link" | "app";

export type ClaimResult =
  | { ok: true; claimId: string; already?: boolean; eventId?: string; paymentId?: string; amount?: number }
  | { ok: false; error: string; /** Confirm only: the claim is more than what's owed now, by this much. */ over?: number; /** Make only: the person paid can't tap Confirm (just a name), so record it as a payment instead. */ direct?: boolean };

// The history line of a claim carries "claim:<id>" in its payment reference (a column that already exists).
export const claimRef = (claimId: string) => `claim:${claimId}`;

const notThere = "That one isn’t there any more.";

// Phone notification for one person (the group's history line is separate).
function pushToReceiver(toId: string, p: { title: string; body: string; url: string; tag: string }, item: "payments.claimed" | "payments.answered") {
  try {
    after(async () => {
      const { sendPushTo } = await import("./push");
      await sendPushTo([toId], p, item);
    });
  } catch {
    /* not inside a request (tests, scripts): nothing is sent */
  }
}

// What the payer is told when the person paid says "Not received" (the push and the note on their Settle up row).
export const declinedNote = (toName: string, amount: number, currency: string) => `${toName} hasn’t received your ${formatMoney(amount, currency)} yet. Check your payment app.`;

// Say "I paid". `amount` is what's owed between the pair right now; it is worked
// out here (never taken from the caller), so only the real debt can be claimed.
type MakeInput = { groupId: string; fromId: string; toId: string; actorId: string; source: ClaimSource; expectAmount?: number };
// Written one after another (and retried if the database is busy), so two taps at once make one claim.
export const makeClaim = (input: MakeInput): Promise<ClaimResult> => withRetry(() => makeClaimOnce(input));

async function makeClaimOnce(input: MakeInput): Promise<ClaimResult> {
  const { groupId, fromId, toId, actorId, source } = input;
  const data = await loadGroup(groupId, { events: false });
  if (!data) return { ok: false, error: "This group no longer exists." };
  const { group, transfers } = data;
  if (group.closed) return { ok: false, error: "This group is closed, so there’s nothing to do." };
  const from = group.members.find((m) => m.id === fromId);
  const to = group.members.find((m) => m.id === toId);
  if (!from || !to || fromId === toId) return { ok: false, error: notThere };
  if (from.leftAt || from.removedAt) return { ok: false, error: "You left this group. Rejoin it to make changes." };
  // Only someone who can actually tap "Confirm received" is asked. A name-only person can't, so the caller records a payment instead.
  if (!needsOkFor(to, fromId)) return { ok: false, error: "That person can’t confirm yet.", direct: true };
  const owed = transfers.find((t) => t.from === fromId && t.to === toId)?.amount ?? 0;
  if (owed <= 0) return { ok: false, error: "Nothing is owed here right now." };
  if (input.expectAmount !== undefined && input.expectAmount !== owed) return { ok: false, error: "Balances changed since you opened this. Check the updated amount and try again." };

  const waiting = await db.paymentClaim.findFirst({ where: { groupId, fromId, toId, status: "waiting" } });
  if (waiting) return { ok: true, claimId: waiting.id, already: true, amount: waiting.amount };

  const amountText = formatMoney(owed, group.currency);
  try {
    return await db.$transaction(async (tx) => {
      const claim = await tx.paymentClaim.create({ data: { groupId, fromId, toId, amount: owed, currency: group.currency, source, status: "waiting", slot: "" } });
      const eventId = await logEvent(tx, {
        groupId,
        actorId,
        kind: "payment_claimed",
        text: `says they paid ${to.name} ${amountText} (waiting for ${to.name} to confirm)`,
        paymentId: claimRef(claim.id), // names its claim so Alerts hides exactly this line (a payment never has this id)
        touches: [], // no balance moves until it's confirmed
      });
      return { ok: true as const, claimId: claim.id, eventId, amount: owed };
    });
  } catch (err) {
    // The unique rule: another tap made it at the same moment. One claim only.
    if ((err as { code?: string })?.code === "P2002") {
      const again = await db.paymentClaim.findFirst({ where: { groupId, fromId, toId, status: "waiting" } });
      if (again) return { ok: true, claimId: again.id, already: true, amount: again.amount };
    }
    throw err;
  }
}

// After makeClaim succeeded for the first time: tell the person paid.
export function tellReceiver(c: { claimId: string; groupId: string; groupName: string; toId: string; fromName: string; amountText: string }) {
  pushToReceiver(c.toId, { title: `💸 ${c.groupName}`, body: `${c.fromName} says they paid you ${c.amountText}. Tap to confirm.`, url: `/groups/${c.groupId}/settle`, tag: `claim-${c.claimId}` }, "payments.claimed");
}

// The payer takes it back while it's still waiting. Allowed only for the person who made it.
export async function withdrawClaim(claimId: string, actorMemberId: string | undefined): Promise<ClaimResult> {
  const claim = await db.paymentClaim.findUnique({ where: { id: claimId } });
  if (!claim) return { ok: false, error: notThere };
  if (!actorMemberId || claim.fromId !== actorMemberId) return { ok: false, error: "Only the person who said they paid can take it back." };
  if (claim.status === "withdrawn") return { ok: true, claimId };
  if (claim.status !== "waiting") return { ok: false, error: claim.status === "confirmed" ? "It’s already confirmed, so it can’t be taken back." : "That one isn’t waiting any more." };
  const done = await db.paymentClaim.updateMany({ where: { id: claim.id, status: "waiting" }, data: { status: "withdrawn", slot: claim.id, decidedAt: new Date(), decidedById: actorMemberId } });
  if (done.count !== 1) {
    const now = await db.paymentClaim.findUnique({ where: { id: claim.id }, select: { status: true } });
    return { ok: false, error: now?.status === "confirmed" ? "It’s already confirmed, so it can’t be taken back." : "That one isn’t waiting any more." };
  }
  return { ok: true, claimId };
}

// The person paid says "Not received". Balances don't change, so there's no undo.
export const declineClaim = (claimId: string, myMemberId: string | undefined): Promise<ClaimResult> => withRetry(() => declineClaimOnce(claimId, myMemberId));

async function declineClaimOnce(claimId: string, myMemberId: string | undefined): Promise<ClaimResult> {
  const claim = await db.paymentClaim.findUnique({ where: { id: claimId } });
  if (!claim) return { ok: false, error: notThere };
  if (!myMemberId || claim.toId !== myMemberId) return { ok: false, error: "Only the person who was paid can answer this." };
  if (claim.status === "declined") return { ok: true, claimId };
  if (claim.status !== "waiting") return { ok: false, error: "That one isn’t waiting any more." };
  const from = await db.member.findUnique({ where: { id: claim.fromId }, select: { name: true } });
  const done = await db.$transaction(async (tx) => {
    const r = await tx.paymentClaim.updateMany({ where: { id: claim.id, status: "waiting" }, data: { status: "declined", slot: claim.id, decidedAt: new Date(), decidedById: myMemberId } });
    if (r.count !== 1) return "";
    return logEvent(tx, { groupId: claim.groupId, actorId: myMemberId, kind: "payment_claimed", text: `hasn’t received ${formatMoney(claim.amount, claim.currency)} from ${from?.name ?? "them"} yet`, touches: [] });
  });
  if (!done) return { ok: false, error: "That one isn’t waiting any more." };
  // The payer is told too (the group-wide push skips these notes), so they check their payment app.
  const to = await db.member.findUnique({ where: { id: claim.toId }, select: { name: true } });
  const g = await db.group.findUnique({ where: { id: claim.groupId }, select: { name: true } });
  pushToReceiver(claim.fromId, { title: `💬 ${g?.name ?? "Loopin"}`, body: declinedNote(to?.name ?? "They", claim.amount, claim.currency), url: `/groups/${claim.groupId}/settle`, tag: `claim-declined-${claim.id}` }, "payments.answered");
  return { ok: true, claimId, eventId: done };
}

// The person paid says "Confirm received": the claim becomes a real payment.
// All in one transaction: the claim moves waiting → confirmed (exactly one row
// must move, so tapping twice records one payment), then the payment is made.
export const confirmClaim = (claimId: string, myMemberId: string | undefined, o: { over?: boolean } = {}): Promise<ClaimResult> => withRetry(() => confirmClaimOnce(claimId, myMemberId, o));

async function confirmClaimOnce(claimId: string, myMemberId: string | undefined, o: { over?: boolean }): Promise<ClaimResult> {
  const claim = await db.paymentClaim.findUnique({ where: { id: claimId } });
  if (!claim) return { ok: false, error: notThere };
  if (!myMemberId || claim.toId !== myMemberId) return { ok: false, error: "Only the person who was paid can confirm it." };
  if (claim.status === "confirmed") return { ok: true, claimId, already: true, paymentId: claim.paymentId || undefined };
  if (claim.status !== "waiting") return { ok: false, error: claim.status === "covered" ? "That payment was already recorded another way, so nothing more was added." : "That one isn’t waiting any more." };

  const data = await loadGroup(claim.groupId, { events: false });
  if (!data) return { ok: false, error: "This group no longer exists." };
  const { group, transfers } = data;
  const from = group.members.find((m) => m.id === claim.fromId);
  const to = group.members.find((m) => m.id === claim.toId);
  if (!from || !to) return { ok: false, error: notThere };
  // Deliberate product decision: a receiver who has since left can still tap Confirm received / Not received. Do not block it.
  if (group.closed) return { ok: false, error: "This group is closed. Reopen it to confirm payments." };
  if (group.currency !== claim.currency) {
    await db.paymentClaim.updateMany({ where: { id: claim.id, status: "waiting" }, data: { status: "expired", slot: claim.id, decidedAt: new Date(), decidedById: myMemberId } });
    return { ok: false, error: `The group’s currency changed after ${from.name} said they paid, so that note is out of date. Ask ${from.name} to tap I’ve paid again.` };
  }
  // More than they owe THIS person now (the expense was edited, or part was paid another way): ask once.
  // Compared with what the payer owes the receiver in the settle plan, never their total debt to everyone,
  // so a payer who owes two people can't have a claim to one pass as if it were a claim to the other.
  const owes = transfers.find((t) => t.from === claim.fromId && t.to === claim.toId)?.amount ?? 0;
  if (claim.amount > owes && !o.over) return { ok: false, error: "More than what’s owed.", over: claim.amount - owes };

  const amountText = formatMoney(claim.amount, claim.currency);
  const result = await db.$transaction(async (tx) => {
    const moved = await tx.paymentClaim.updateMany({ where: { id: claim.id, status: "waiting" }, data: { status: "confirmed", slot: claim.id, decidedAt: new Date(), decidedById: myMemberId } });
    if (moved.count !== 1) return null; // somebody else got there first: record nothing
    const payment = await createPayment(tx, { groupId: claim.groupId, fromId: claim.fromId, toId: claim.toId, amount: claim.amount, createdById: claim.fromId, okAt: new Date() });
    await tx.paymentClaim.update({ where: { id: claim.id }, data: { paymentId: payment.id } });
    // The link page can then say "all square, confirmed".
    // (Unless the link still tracks an older payment that is waiting for "Confirm received": that one must stay reachable.)
    const link = await tx.payLink.findUnique({ where: { groupId_fromId_toId: { groupId: claim.groupId, fromId: claim.fromId, toId: claim.toId } }, select: { id: true, paymentId: true } });
    if (link) {
      const tracked = link.paymentId ? await tx.payment.findFirst({ where: { id: link.paymentId, deletedAt: null, needsOk: true, okAt: null }, select: { id: true } }) : null;
      if (!tracked) await tx.payLink.update({ where: { id: link.id }, data: { paymentId: payment.id } });
    }
    const eventId = await logEvent(tx, {
      groupId: claim.groupId,
      actorId: myMemberId,
      kind: "payment_recorded",
      text: `confirmed getting ${amountText} from ${from.name} ✓`,
      paymentId: payment.id,
      undo: { type: "payment_delete", paymentId: payment.id },
    });
    return { paymentId: payment.id, eventId };
  });
  if (!result) {
    const now = await db.paymentClaim.findUnique({ where: { id: claim.id }, select: { status: true, paymentId: true } });
    if (now?.status === "confirmed") return { ok: true, claimId, already: true, paymentId: now.paymentId || undefined };
    return { ok: false, error: "That one isn’t waiting any more." };
  }
  return { ok: true, claimId, paymentId: result.paymentId, eventId: result.eventId };
}

// Claims waiting for this person's "Confirm received".
export async function claimsWaitingFor(groupId: string, myMemberId: string) {
  const rows = await db.paymentClaim.findMany({ where: { groupId, toId: myMemberId, status: "waiting" }, orderBy: { createdAt: "desc" }, take: 20 });
  if (!rows.length) return [];
  const names = await db.member.findMany({ where: { id: { in: rows.map((r) => r.fromId) } }, select: { id: true, name: true } });
  return rows.map((r) => ({ ...r, fromName: names.find((n) => n.id === r.fromId)?.name ?? "Someone" }));
}

// Claims this person made that are still waiting (so Settle up can say "Waiting for Asha to confirm").
export async function myWaitingClaims(groupId: string, myMemberId: string) {
  return db.paymentClaim.findMany({ where: { groupId, fromId: myMemberId, status: "waiting" } });
}

// "Not received" answers this person is still looking at: for each person they owe, their latest claim, if it was
// declined (so Settle up can say so). A newer claim, or a payment that closed things, replaces it.
export async function myDeclinedClaims(groupId: string, myMemberId: string) {
  const rows = await db.paymentClaim.findMany({ where: { groupId, fromId: myMemberId }, orderBy: { createdAt: "desc" }, take: 50 });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.toId)) latest.set(r.toId, r);
  const declined = [...latest.values()].filter((r) => r.status === "declined");
  if (!declined.length) return [];
  // Any payment from this person to that person recorded after the "Not received" (and still counting) replaces the note.
  const paid = await db.payment.findMany({ where: { groupId, fromId: myMemberId, deletedAt: null }, select: { toId: true, createdAt: true } });
  return declined.filter((r) => {
    const since = r.decidedAt ?? r.createdAt;
    return !paid.some((p) => p.toId === r.toId && p.createdAt >= since);
  });
}
