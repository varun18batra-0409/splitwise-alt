import { db } from "./db";
import { withRetry } from "./once";
import { loadGroup } from "./group-data";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import type { Transfer } from "./settle";

// "We settled outside the app": record every Smart Settle payment at once and
// close the group. One logged change, one Undo (which takes the payments back
// out and reopens the group); Undo can be redone.

type Result = { ok: true; eventId?: string } | { ok: false; error: string };

// A fingerprint of the plan the person saw, so we never record a stale one.
export function planKey(transfers: Transfer[]): string {
  return transfers.map((t) => `${t.from}>${t.to}:${t.amount}`).sort().join("|");
}

export async function settleAllAndClose(groupId: string, actorId: string, expectedPlan: string): Promise<Result> {
  return withRetry(() => settleAllOnce(groupId, actorId, expectedPlan));
}

async function settleAllOnce(groupId: string, actorId: string, expectedPlan: string): Promise<Result> {
  const data = await loadGroup(groupId);
  if (!data) return { ok: false, error: "This group no longer exists." };
  const { group, transfers } = data;
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can do this." };
  if (group.closed) return { ok: false, error: "This group is already closed." };
  if (planKey(transfers) !== expectedPlan) return { ok: false, error: "Balances changed since you opened this. Check the updated list and try again." };

  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "Someone";
  const money = (n: number) => formatMoney(n, group.currency);
  let eventId: string;
  try {
   eventId = await db.$transaction(async (tx) => {
    // Close first, only if still open: a second (retried) request stops here.
    const lock = await tx.group.updateMany({ where: { id: groupId, closed: false }, data: { closed: true, closedAt: new Date() } });
    if (lock.count !== 1) throw new Error("already-closed");
    const ids: string[] = [];
    for (const t of transfers) {
      const p = await tx.payment.create({ data: { groupId, fromId: t.from, toId: t.to, amount: t.amount, createdById: actorId } });
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
   });
  } catch (err) {
    if (String((err as Error)?.message) === "already-closed") return { ok: false, error: "This group is already closed." };
    throw err;
  }
  return { ok: true, eventId };
}

// Undo (apply = false): take the payments back out and reopen.
// Redo (apply = true): put them back and close again.
export async function applySettleAll(groupId: string, actorId: string, paymentIds: string[], apply: boolean): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can do this." };
  if (!apply && !group.closed) return { ok: false, error: "The group was reopened since, so this can’t be undone. Delete the payments one by one instead." };
  if (apply && group.closed) return { ok: false, error: "The group is already closed." };
  const eventId = await db.$transaction(async (tx) => {
    await tx.payment.updateMany({
      where: { id: { in: paymentIds }, groupId },
      data: apply ? { deletedAt: null, deletedById: null } : { deletedAt: new Date(), deletedById: actorId },
    });
    await tx.group.update({ where: { id: groupId }, data: { closed: apply, closedAt: apply ? new Date() : null } });
    return logEvent(tx, {
      groupId,
      actorId,
      kind: apply ? "group_settled_closed" : "group_reopened",
      text: apply ? "marked everyone settled up and closed the group again (redo)" : "undid “settle everything”: payments taken out, group reopened",
      undo: { type: "settle_all", paymentIds, apply: !apply },
    });
  });
  return { ok: true, eventId };
}

// "Mark all paid" without closing the group (a card group plays again next
// week): records the given payments in one go, as one change with Undo.
// From Settle up, each payment must still be one of the group's current Smart
// Settle payments; a card game passes its own (already checked) payments.
export async function markAllPaid(groupId: string, actorId: string, pick: { from: string; to: string; amount: number }[], label: string, checkPlan = true): Promise<Result> {
  return withRetry(async () => {
    const data = await loadGroup(groupId);
    if (!data) return { ok: false, error: "This group no longer exists." };
    const { group, transfers } = data;
    if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can do this." };
    if (group.closed) return { ok: false, error: "This group is closed. Reopen it to record payments." };
    if (!pick.length) return { ok: false, error: "Nothing left to mark paid." };
    // Each one must still be owed (balances may have moved since the screen loaded).
    const ids = new Set(group.members.map((m) => m.id));
    for (const p of pick) {
      const t = transfers.find((x) => x.from === p.from && x.to === p.to);
      if (!ids.has(p.from) || !ids.has(p.to) || p.from === p.to || !Number.isSafeInteger(p.amount) || p.amount <= 0 || (checkPlan && (!t || p.amount > t.amount))) return { ok: false, error: "Balances changed since you opened this. Check the updated list and try again." };
    }
    const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "Someone";
    const money = (n: number) => formatMoney(n, group.currency);
    const eventId = await db.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const t of pick) {
        const r = group.members.find((m) => m.id === t.to);
        const p = await tx.payment.create({ data: { groupId, fromId: t.from, toId: t.to, amount: t.amount, createdById: actorId, needsOk: Boolean(r && r.id !== actorId && (r.accountId || r.claimedAt)) } });
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
    });
    return { ok: true, eventId };
  });
}

// Undo / redo of "Mark all paid": take those payments out, or put them back.
export async function setPaymentsDeleted(groupId: string, actorId: string, paymentIds: string[], deleted: boolean): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can do this." };
  if (group.closed) return { ok: false, error: "This group is closed. Reopen it to change payments." };
  const eventId = await db.$transaction(async (tx) => {
    await tx.payment.updateMany({ where: { id: { in: paymentIds }, groupId }, data: deleted ? { deletedAt: new Date(), deletedById: actorId } : { deletedAt: null, deletedById: null } });
    return logEvent(tx, {
      groupId,
      actorId,
      kind: deleted ? "payment_deleted" : "payment_restored",
      text: deleted ? `undid marking ${paymentIds.length === 1 ? "1 payment" : `${paymentIds.length} payments`} paid` : `marked ${paymentIds.length === 1 ? "1 payment" : `${paymentIds.length} payments`} paid again`,
      undo: { type: "payments_set", paymentIds, deleted: !deleted },
    });
  });
  return { ok: true, eventId };
}
