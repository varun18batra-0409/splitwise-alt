import { db } from "./db";
import { hasLeft, LEFT_ERROR } from "./active";
import { claimKey, fingerprintOf, isDuplicateKey, keyState, STALE_KEY_ERROR, withRetry } from "./once";
import { loadGroup } from "./group-data";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { createPayment, RestoreRefused, restorePayments } from "./payments";
import type { Transfer } from "./settle";
import type { Prisma } from "@prisma/client";
import { GroupChanged, groupChangedText, guardGroup, ledgerInTx } from "./money-guard";

// "We settled outside the app": record every Smart Settle payment at once and
// close the group. One logged change, one Undo (which takes the payments back
// out and reopens the group); Undo can be redone.

type Result = { ok: true; eventId?: string } | { ok: false; error: string };

// A fingerprint of the plan the person saw, so we never record a stale one.
export function planKey(transfers: Transfer[]): string {
  return transfers.map((t) => `${t.from}>${t.to}:${t.amount}`).sort().join("|");
}

const PLAN_CHANGED = "Balances changed since you opened this. Check the updated list and try again.";

// `afterRead` is for tests only: it runs after the reads and before the write begins.
export async function settleAllAndClose(groupId: string, actorId: string, expectedPlan: string, opts: { afterRead?: () => Promise<void> } = {}): Promise<Result> {
  return withRetry(() => settleAllOnce(groupId, actorId, expectedPlan, opts));
}

async function settleAllOnce(groupId: string, actorId: string, expectedPlan: string, opts: { afterRead?: () => Promise<void> }): Promise<Result> {
  const data = await loadGroup(groupId, { events: false });
  if (!data) return { ok: false, error: "This group no longer exists." };
  const { group, transfers } = data;
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can do this." };
  if (await hasLeft(groupId, actorId)) return { ok: false, error: LEFT_ERROR };
  if (group.closed) return { ok: false, error: "This group is already closed." };
  if (planKey(transfers) !== expectedPlan) return { ok: false, error: PLAN_CHANGED };

  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "Someone";
  const money = (n: number) => formatMoney(n, group.currency);
  let eventId: string;
  await opts.afterRead?.();
  try {
   eventId = await db.$transaction(async (tx) => {
    // The group must still be as read (same currency, open, not deleted, this person still in it).
    await guardGroup(tx, groupId, { currency: group.currency, actorId });
    // Close first, only if still open: a second (retried) request stops here.
    const lock = await tx.group.updateMany({ where: { id: groupId, closed: false }, data: { closed: true, closedAt: new Date() } });
    if (lock.count !== 1) throw new Error("already-closed");
    // The plan as it is now, inside the write: what is recorded is exactly what the person saw, or nothing.
    const now = await ledgerInTx(tx, groupId);
    if (planKey(now.transfers) !== expectedPlan) throw new Error("plan-changed");
    const ids: string[] = [];
    for (const t of now.transfers) {
      const p = await createPayment(tx, { groupId, fromId: t.from, toId: t.to, amount: t.amount, createdById: actorId });
      ids.push(p.id);
    }
    return logEvent(tx, {
      groupId,
      actorId,
      kind: "group_settled_closed",
      text:
        transfers.length > 0
          ? `marked everyone settled up (${transfers.length} ${transfers.length === 1 ? "payment" : "payments"}) and closed the group`
          : "closed the group (everyone was settled up)",
      details: transfers.map((t) => `${nameOf(t.from)} paid ${nameOf(t.to)} ${money(t.amount)}`),
      undo: { type: "settle_all", paymentIds: ids, apply: false },
    });
   }, { timeout: 15000 });
  } catch (err) {
    if (String((err as Error)?.message) === "already-closed") return { ok: false, error: "This group is already closed." };
    if (String((err as Error)?.message) === "plan-changed") return { ok: false, error: PLAN_CHANGED };
    if (err instanceof GroupChanged) return { ok: false, error: err.reason === "closed" ? "This group is already closed." : groupChangedText(err) };
    throw err;
  }
  return { ok: true, eventId };
}

// Undo (apply = false): take the payments back out and reopen.
// Redo (apply = true): put them back and close again.
export async function applySettleAll(groupId: string, actorId: string, paymentIds: string[], apply: boolean, opts: { afterRead?: () => Promise<void> } = {}): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can do this." };
  if (await hasLeft(groupId, actorId)) return { ok: false, error: LEFT_ERROR };
  if (!apply && !group.closed) return { ok: false, error: "The group was reopened since, so this can’t be undone. Delete the payments one by one instead." };
  if (apply && group.closed) return { ok: false, error: "The group is already closed." };
  let eventId: string;
  await opts.afterRead?.();
  try {
   eventId = await db.$transaction(async (tx) => {
    // First: the group is in the same currency and this person still in it; closed is checked just below (undo needs it
    // closed, redo needs it open).
    await guardGroup(tx, groupId, { currency: group.currency, actorId, allowClosed: !apply });
    if (!apply) {
      const open = await tx.group.updateMany({ where: { id: groupId, closed: true }, data: { closed: true } });
      if (open.count !== 1) throw new Error("reopened-since");
    }
    if (apply) {
      await restorePayments(tx, paymentIds, actorId, groupId);
      // "Settle everything" left every balance at 0. If an expense or payment was added since it was undone, putting
      // the payments back would close the group with someone still owing: refuse, and nothing changes.
      const now = await ledgerInTx(tx, groupId);
      if (Object.values(now.net).some((v) => v !== 0)) throw new Error("not-square");
    } else await tx.payment.updateMany({ where: { id: { in: paymentIds }, groupId }, data: { deletedAt: new Date(), deletedById: actorId } });
    await tx.group.update({ where: { id: groupId }, data: { closed: apply, closedAt: apply ? new Date() : null } });
    return logEvent(tx, {
      groupId,
      actorId,
      kind: apply ? "group_settled_closed" : "group_reopened",
      text: apply ? "marked everyone settled up and closed the group again (redo)" : "undid “settle everything”: payments taken out, group reopened",
      undo: { type: "settle_all", paymentIds, apply: !apply },
    });
   }, { timeout: 15000 });
  } catch (err) {
    if (err instanceof RestoreRefused) return { ok: false, error: err.message };
    if (err instanceof GroupChanged) return { ok: false, error: err.reason === "closed" ? "The group is already closed." : groupChangedText(err) };
    const msg = String((err as Error)?.message);
    if (msg === "not-square") return { ok: false, error: "Balances changed since, so this can't be redone." };
    if (msg === "reopened-since") return { ok: false, error: "The group was reopened since, so this can’t be undone. Delete the payments one by one instead." };
    throw err;
  }
  return { ok: true, eventId };
}

// "Mark all paid" without closing the group (a card group plays again next
// week): records the given payments in one go, as one change with Undo.
// From Settle up, each payment must still be one of the group's current Smart
// Settle payments; a card game passes its own (already checked) payments.
class PlanChanged extends Error {}
type Pick = { from: string; to: string; amount: number }[];
export async function markAllPaid(groupId: string, actorId: string, pickIn: Pick | (() => Promise<Pick>), label: string, checkPlan = true, key?: string, opts: { afterRead?: () => Promise<void>; recheck?: (tx: Prisma.TransactionClient) => Promise<Pick> } = {}): Promise<Result> {
  // The same tap arriving twice (a slow network, two servers) is recorded once.
  // (A card game works out its own list later, so for it the group and label stand for the request.)
  const fp = fingerprintOf("settle-all", groupId, label, checkPlan, ...(typeof pickIn === "function" ? [] : pickIn.map((p) => `${p.from}|${p.to}|${p.amount}`).sort()));
  const ks = await keyState(key, fp);
  if (ks.state === "stale") return { ok: false, error: STALE_KEY_ERROR };
  if (ks.state === "done") return { ok: true };
  try {
    return await withRetry(async () => {
    const data = await loadGroup(groupId, { events: false });
    if (!data) return { ok: false, error: "This group no longer exists." };
    const { group, transfers } = data;
    if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can do this." };
  if (await hasLeft(groupId, actorId)) return { ok: false, error: LEFT_ERROR };
    if (group.closed) return { ok: false, error: "This group is closed. Reopen it to record payments." };
    // Worked out here, in the write queue, so two people tapping at once can't both record it.
    const pick = typeof pickIn === "function" ? await pickIn() : pickIn;
    if (!pick.length) return { ok: false, error: "Nothing left to mark paid." };
    // Each one must still be owed (balances may have moved since the screen loaded).
    const ids = new Set(group.members.map((m) => m.id));
    for (const p of pick) {
      const t = transfers.find((x) => x.from === p.from && x.to === p.to);
      if (!ids.has(p.from) || !ids.has(p.to) || p.from === p.to || !Number.isSafeInteger(p.amount) || p.amount <= 0 || (checkPlan && (!t || p.amount > t.amount))) return { ok: false, error: "Balances changed since you opened this. Check the updated list and try again." };
    }
    const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "Someone";
    const money = (n: number) => formatMoney(n, group.currency);
    await opts.afterRead?.();
    const eventId = await db.$transaction(async (tx) => {
      // The group must still be as read; and from Settle up every payment is checked again against the plan as it is now.
      await guardGroup(tx, groupId, { currency: group.currency, actorId });
      if (checkPlan) {
        const now = await ledgerInTx(tx, groupId);
        for (const p of pick) {
          const t = now.transfers.find((x) => x.from === p.from && x.to === p.to);
          if (!t || p.amount > t.amount) throw new PlanChanged();
        }
      }
      // A card game works out its own list: worked out again here, it must be exactly what is about to be recorded.
      if (opts.recheck) {
        const sig = (xs: Pick) => xs.map((p) => `${p.from}|${p.to}|${p.amount}`).sort().join(",");
        if (sig(await opts.recheck(tx)) !== sig(pick)) throw new PlanChanged();
      }
      await claimKey(tx, key, "paid", fp);
      const ids: string[] = [];
      for (const t of pick) {
        const r = group.members.find((m) => m.id === t.to);
        const p = await createPayment(tx, { groupId, fromId: t.from, toId: t.to, amount: t.amount, createdById: actorId, needsOk: Boolean(r && r.id !== actorId && (r.accountId || r.claimedAt)) });
        ids.push(p.id);
      }
      return logEvent(tx, {
        groupId,
        actorId,
        kind: "payment_recorded",
        text: `marked ${pick.length === 1 ? "1 payment" : `${pick.length} payments`} paid${label ? ` (${label})` : ""}`,
        details: pick.map((t) => `${nameOf(t.from)} paid ${nameOf(t.to)} ${money(t.amount)}`),
        undo: { type: "payments_set", paymentIds: ids, deleted: true },
      });
    }, { timeout: 15000 });
    return { ok: true, eventId };
  });
  } catch (err) {
    if (isDuplicateKey(err)) return { ok: true };
    if (err instanceof PlanChanged) return { ok: false, error: PLAN_CHANGED };
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    throw err;
  }
}

// Undo / redo of "Mark all paid": take those payments out, or put them back.
export async function setPaymentsDeleted(groupId: string, actorId: string, paymentIds: string[], deleted: boolean, opts: { afterRead?: () => Promise<void> } = {}): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can do this." };
  if (await hasLeft(groupId, actorId)) return { ok: false, error: LEFT_ERROR };
  if (group.closed) return { ok: false, error: "This group is closed. Reopen it to change payments." };
  let eventId: string;
  await opts.afterRead?.();
  try {
   eventId = await db.$transaction(async (tx) => {
    // First: the group is still open, in the same currency, and this person still in it.
    await guardGroup(tx, groupId, { currency: group.currency, actorId });
    if (deleted) await tx.payment.updateMany({ where: { id: { in: paymentIds }, groupId }, data: { deletedAt: new Date(), deletedById: actorId } });
    else await restorePayments(tx, paymentIds, actorId, groupId);
    return logEvent(tx, {
      groupId,
      actorId,
      kind: deleted ? "payment_deleted" : "payment_restored",
      text: deleted ? `undid marking ${paymentIds.length === 1 ? "1 payment" : `${paymentIds.length} payments`} paid` : `marked ${paymentIds.length === 1 ? "1 payment" : `${paymentIds.length} payments`} paid again`,
      undo: { type: "payments_set", paymentIds, deleted: !deleted },
    });
   });
  } catch (err) {
    if (err instanceof RestoreRefused) return { ok: false, error: err.message };
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    throw err;
  }
  return { ok: true, eventId };
}
