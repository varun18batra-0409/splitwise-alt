import { db } from "./db";
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
  const data = await loadGroup(groupId);
  if (!data) return { ok: false, error: "This group no longer exists." };
  const { group, transfers } = data;
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can do this." };
  if (group.closed) return { ok: false, error: "This group is already closed." };
  if (planKey(transfers) !== expectedPlan) return { ok: false, error: "Balances changed since you opened this. Check the updated list and try again." };

  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "Someone";
  const money = (n: number) => formatMoney(n, group.currency);
  const eventId = await db.$transaction(async (tx) => {
    const ids: string[] = [];
    for (const t of transfers) {
      const p = await tx.payment.create({ data: { groupId, fromId: t.from, toId: t.to, amount: t.amount, createdById: actorId } });
      ids.push(p.id);
    }
    await tx.group.update({ where: { id: groupId }, data: { closed: true, closedAt: new Date() } });
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
  return { ok: true, eventId };
}

// Undo (apply = false): take the payments back out and reopen.
// Redo (apply = true): put them back and close again.
export async function applySettleAll(groupId: string, actorId: string, paymentIds: string[], apply: boolean): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId } });
  if (!group) return { ok: false, error: "This group no longer exists." };
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
