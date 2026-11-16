import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { dayKey } from "./dates";
import { niceDate } from "./format";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { guardGroup, ledgerInTx } from "./money-guard";
import { createPayment } from "./payments";
import { changePayment } from "./payment-change";

// Batch C data step: the "I've paid" notes still waiting on the live app. A note is a claim that never counted; from Batch C nothing waits
// for anyone, so each waiting note is dealt with ONCE, right after the deploy (so old code can't make new ones in between):
//
//   converted  A note that can safely count becomes a counted payment "as if it had just been recorded" (from the note's payer, to the note's
//              person paid, the note's amount). The note is closed as "covered" and points at that payment. No phone notifications.
//              It is safe when: the group is open and not deleted, the note is in the group's currency, neither person has left or been
//              removed, and the amount is no more than what the payer owes the person paid in the group's settle plan right now.
//   expired    Any other note is closed as "expired", with a history line asking the payer to record it again if it was paid.
//
// Each note is its own transaction, so one that fails changes nothing else. Nothing here prints a name: only counts and reasons.
// scripts/convert-waiting-claims.ts is the command (dry run unless --apply); scripts/undo-convert-waiting-claims.ts puts it all back.

type Tx = Prisma.TransactionClient;

export type Reason = "group-gone" | "group-closed" | "currency" | "person-left" | "person-missing" | "more-than-owed";

export type Judged = { ok: true } | { ok: false; reason: Reason };

export type ClaimRow = { id: string; groupId: string; fromId: string; toId: string; amount: number; currency: string; createdAt: Date };

// Can this waiting note safely count? Reads only; the same question is asked again inside the write.
export async function judgeClaim(client: Tx, c: ClaimRow): Promise<Judged> {
  const group = await client.group.findUnique({ where: { id: c.groupId }, select: { deletedAt: true, closed: true, currency: true } });
  if (!group || group.deletedAt) return { ok: false, reason: "group-gone" };
  if (group.closed) return { ok: false, reason: "group-closed" };
  if (group.currency !== c.currency) return { ok: false, reason: "currency" };
  const people = await client.member.findMany({ where: { groupId: c.groupId, id: { in: [c.fromId, c.toId] } }, select: { id: true, leftAt: true, removedAt: true } });
  if (people.length !== 2) return { ok: false, reason: "person-missing" };
  if (people.some((m) => m.leftAt || m.removedAt)) return { ok: false, reason: "person-left" };
  const { transfers } = await ledgerInTx(client, c.groupId);
  const owed = transfers.find((t) => t.from === c.fromId && t.to === c.toId)?.amount ?? 0;
  if (c.amount > owed) return { ok: false, reason: "more-than-owed" };
  return { ok: true };
}

export type Change = { claimId: string; kind: "converted" | "expired"; reason?: Reason; paymentId?: string; eventId?: string };

export type ConvertSummary = {
  apply: boolean;
  waiting: number; // notes found waiting
  converted: number;
  expired: number;
  failed: number; // a note whose own step failed (nothing changed for it)
  reasons: Partial<Record<Reason, number>>; // why the others were closed
  changes: Change[]; // what an apply did, ids only (the undo file)
};

class Skip extends Error {
  constructor(public reason: Reason) {
    super(reason);
  }
}

const sayDay = (d: Date) => niceDate(dayKey(d));

// `apply` false (the default everywhere): nothing is written, the summary says what would happen.
// `groupIds` (tests only) limits it to those groups; the script never passes it.
// `onChange` is called with each note's change the moment it is saved (the script appends it to the undo file), so a crash part-way never
// loses what was already done. If it throws, the run stops there (the change is already in the file or the caller knows it is not).
export async function convertWaitingClaims(o: { apply: boolean; now?: Date; groupIds?: string[]; onChange?: (c: Change) => void } = { apply: false }): Promise<ConvertSummary> {
  const now = o.now ?? new Date();
  const rows = await db.paymentClaim.findMany({ where: { status: "waiting", ...(o.groupIds ? { groupId: { in: o.groupIds } } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const out: ConvertSummary = { apply: o.apply, waiting: rows.length, converted: 0, expired: 0, failed: 0, reasons: {}, changes: [] };
  for (const c of rows) {
    let change: Change | null = null;
    try {
      // Each note is its own step, including the question of whether it can count: one that fails changes nothing else.
      const verdict = await judgeClaim(db, c);
      if (!o.apply) {
        if (verdict.ok) out.converted++;
        else {
          out.expired++;
          out.reasons[verdict.reason] = (out.reasons[verdict.reason] ?? 0) + 1;
        }
        continue;
      }
      change = verdict.ok ? await convertOne(c, now) : await expireOne(c, verdict.reason, now);
    } catch {
      out.failed++;
      continue;
    }
    if (change.kind === "converted") out.converted++;
    else {
      out.expired++;
      if (change.reason) out.reasons[change.reason] = (out.reasons[change.reason] ?? 0) + 1;
    }
    out.changes.push(change);
    o.onChange?.(change);
  }
  return out;
}

async function convertOne(c: ClaimRow, now: Date): Promise<Change> {
  try {
    return await db.$transaction(async (tx) => {
      // The group is still open and in the same currency; then the whole question again, inside the write.
      await guardGroup(tx, c.groupId, { currency: c.currency });
      const again = await judgeClaim(tx, c);
      if (!again.ok) throw new Skip(again.reason);
      const names = await tx.member.findMany({ where: { id: { in: [c.fromId, c.toId] } }, select: { id: true, name: true } });
      const toName = names.find((m) => m.id === c.toId)?.name ?? "them";
      const closed = await tx.paymentClaim.updateMany({ where: { id: c.id, status: "waiting" }, data: { status: "covered", slot: c.id, decidedAt: now, decidedById: c.fromId } });
      if (closed.count !== 1) throw new Skip("group-gone"); // somebody else closed it first: nothing is recorded
      const pay = await createPayment(tx, { groupId: c.groupId, fromId: c.fromId, toId: c.toId, amount: c.amount, createdById: c.fromId });
      await tx.paymentClaim.update({ where: { id: c.id }, data: { paymentId: pay.id } });
      const eventId = await logEvent(tx, {
        groupId: c.groupId,
        actorId: c.fromId,
        kind: "payment_recorded",
        text: `paid ${toName} ${formatMoney(c.amount, c.currency)} (from an earlier “I’ve paid”)`,
        paymentId: pay.id,
        undo: { type: "payment_delete", paymentId: pay.id },
      });
      return { claimId: c.id, kind: "converted" as const, paymentId: pay.id, eventId };
    }, { timeout: 15000 });
  } catch (err) {
    // The note changed between the read and the write: it is closed instead (the same transaction rolled back, so nothing half-done is left).
    if (err instanceof Skip) return expireOne(c, err.reason, now);
    throw err;
  }
}

async function expireOne(c: ClaimRow, reason: Reason, now: Date): Promise<Change> {
  return db.$transaction(async (tx) => {
    const closed = await tx.paymentClaim.updateMany({ where: { id: c.id, status: "waiting" }, data: { status: "expired", slot: c.id, decidedAt: now, decidedById: c.fromId } });
    if (closed.count !== 1) throw new Error("already closed");
    // The history line: only while the group still exists (a deleted group's lines are erased with it).
    const g = await tx.group.findUnique({ where: { id: c.groupId }, select: { id: true } });
    let eventId = "";
    if (g) {
      eventId = await logEvent(tx, {
        groupId: c.groupId,
        actorId: c.fromId,
        kind: "payment_note_closed",
        text: `said “I’ve paid ${formatMoney(c.amount, c.currency)}” on ${sayDay(c.createdAt)}, but it couldn’t be counted. Record it again if it was paid.`,
        touches: [],
      });
    }
    return { claimId: c.id, kind: "expired" as const, reason, eventId };
  });
}

async function putNoteBack(tx: Tx, claimId: string, expect: string, eventId: string | undefined, fromId: string, now: Date) {
  await tx.paymentClaim.updateMany({ where: { id: claimId, status: expect }, data: { status: "waiting", slot: "", paymentId: "", decidedAt: null, decidedById: "" } });
  if (eventId) await tx.groupEvent.updateMany({ where: { id: eventId, undoneAt: null }, data: { undoneAt: now, undoneById: fromId } });
}

// Put a conversion back (the undo file lists the ids it made). Converted notes: the payment is taken off the same safe way as when the payer
// deletes it (the group must be open, and anyone who has left comes back owing so they stay at 0) and the note waits again, unless another note
// for the same pair is waiting now (only one may wait) or the payment can't be taken off now (counted as skipped). Closed notes: the note
// waits again on the same terms. Every history line the conversion wrote is marked undone. Returns how many of each were put back.
export async function undoConvertedClaims(changes: Change[], o: { apply: boolean; now?: Date } = { apply: false }): Promise<{ apply: boolean; putBack: number; skipped: number }> {
  const now = o.now ?? new Date();
  let putBack = 0;
  let skipped = 0;
  for (const ch of changes) {
    const c = await db.paymentClaim.findUnique({ where: { id: ch.claimId } });
    const expect = ch.kind === "converted" ? "covered" : "expired";
    if (!c || c.status !== expect || (ch.kind === "converted" && c.paymentId !== ch.paymentId)) {
      skipped++;
      continue;
    }
    const other = await db.paymentClaim.findFirst({ where: { groupId: c.groupId, fromId: c.fromId, toId: c.toId, status: "waiting" }, select: { id: true } });
    if (other) {
      skipped++;
      continue;
    }
    if (ch.kind === "converted") {
      // Read-only first (a dry run says the same): the payment must still be counting, the group open, and the payer not removed.
      const pay = ch.paymentId ? await db.payment.findUnique({ where: { id: ch.paymentId }, select: { deletedAt: true, groupId: true } }) : null;
      const group = await db.group.findUnique({ where: { id: c.groupId }, select: { deletedAt: true, closed: true } });
      const payer = await db.member.findFirst({ where: { id: c.fromId, groupId: c.groupId }, select: { removedAt: true } });
      if (!pay || pay.deletedAt || pay.groupId !== c.groupId || !group || group.deletedAt || group.closed || !payer || payer.removedAt) {
        skipped++;
        continue;
      }
    }
    if (!o.apply) {
      putBack++;
      continue;
    }
    if (ch.kind === "converted" && ch.paymentId) {
      // The payer deletes it: the group checks, the closed check, leavers brought back owing, deletedById set (payment-change.ts).
      // The note goes back to waiting INSIDE that same transaction (opts.inside), so a crash can never leave the payment gone and the note
      // still "covered" (a rerun would skip it for good).
      const r = await changePayment(ch.paymentId, c.fromId, true, { inside: (tx) => putNoteBack(tx, c.id, expect, ch.eventId, c.fromId, now) });
      if (!r.ok || (await db.paymentClaim.count({ where: { id: c.id, status: expect } }))) {
        skipped++; // (the second case: someone else took the payment off first, so the hook never ran and the note was not touched)
        continue;
      }
    } else {
      await db.$transaction((tx) => putNoteBack(tx, c.id, expect, ch.eventId, c.fromId, now));
    }
    putBack++;
  }
  return { apply: o.apply, putBack, skipped };
}
