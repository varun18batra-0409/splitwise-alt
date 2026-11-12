import type { Prisma } from "@prisma/client";
import { netBalances } from "./balances";
import { smartSettle, type Transfer } from "./settle";

// Re-checking the group INSIDE the transaction that writes money.
//
// Most money actions read the group, check it, then write in a separate step. Another server can commit a change in
// that gap (a currency change, closing the group, someone leaving). Nothing here is a lock held in memory (that can't
// work across servers). Instead the first statement of the committing transaction is a WRITE that only matches if the
// group is still exactly as it was read. In SQLite a write takes the single write lock from that moment, so every read
// after it is current and nobody else can commit until this transaction ends. Writing first makes it not matter whether
// the transaction started "deferred" or "immediate".
//
// Tests use the `afterRead` hook (like group-changes.ts): it runs after the reads and before the transaction.

type Tx = Prisma.TransactionClient;

export type ChangeReason = "gone" | "closed" | "currency" | "left" | "actor_left";

// Thrown inside the transaction: rolls everything back. `reason` says what changed.
export class GroupChanged extends Error {
  constructor(
    public reason: ChangeReason,
    public detail = "", // currency: the group's new currency; left: the name of the person who left
  ) {
    super(`group changed: ${reason}`);
  }
}

// The words the person sees (nothing was saved in any of these cases).
export function groupChangedText(e: GroupChanged): string {
  switch (e.reason) {
    case "currency":
      return `The group's currency changed to ${e.detail} while you were saving, so nothing was saved. Check the amount and save again.`;
    case "closed":
      return "This group was closed while you were saving, so nothing was saved.";
    case "gone":
      return "This group was deleted while you were saving.";
    case "actor_left":
      return "You're no longer in this group, so nothing was saved.";
    case "left":
      return `${e.detail || "Someone"} just left the group. Check who it's for and save again.`;
  }
}

export type GuardOptions = {
  currency: string; // the currency the amounts were worked out in (the group's, as read)
  actorId?: string; // must still be in the group
  involvedIds?: string[]; // everyone in a NEW expense: must still be in the group
  allowClosed?: boolean; // card-game moves are allowed in a closed group
};

// Must be the FIRST statement in a committing transaction.
export async function guardGroup(tx: Tx, groupId: string, o: GuardOptions): Promise<void> {
  const hit = await tx.group.updateMany({
    where: { id: groupId, deletedAt: null, currency: o.currency, ...(o.allowClosed ? {} : { closed: false }) },
    data: { currency: o.currency },
  });
  if (hit.count !== 1) {
    const now = await tx.group.findUnique({ where: { id: groupId }, select: { deletedAt: true, closed: true, currency: true } });
    if (!now || now.deletedAt) throw new GroupChanged("gone");
    if (now.currency !== o.currency) throw new GroupChanged("currency", now.currency);
    throw new GroupChanged("closed");
  }
  const ids = [...new Set([...(o.actorId ? [o.actorId] : []), ...(o.involvedIds ?? [])])];
  if (!ids.length) return;
  const rows = await tx.member.findMany({ where: { groupId, id: { in: ids } }, select: { id: true, name: true, leftAt: true } });
  const by = new Map(rows.map((m) => [m.id, m]));
  if (o.actorId) {
    const me = by.get(o.actorId);
    if (!me || me.leftAt) throw new GroupChanged("actor_left");
  }
  for (const id of o.involvedIds ?? []) {
    const m = by.get(id);
    if (!m || m.leftAt) throw new GroupChanged("left", m?.name ?? "");
  }
}

// Of these people, the names of those who have left the group (read inside the transaction). Used to refuse changes that
// would move a leaver's balance: they left square, and only they can come back to change it.
export async function leftAmong(tx: Tx, groupId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await tx.member.findMany({ where: { groupId, id: { in: [...new Set(ids)] }, leftAt: { not: null } }, select: { name: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map((m) => m.name);
}

// The group's balances and settle-up plan, read INSIDE the transaction (after guardGroup). The same working as
// loadGroup: every member (oldest first), and the expenses and payments that aren't deleted.
export async function ledgerInTx(tx: Tx, groupId: string): Promise<{ memberIds: string[]; net: Record<string, number>; transfers: Transfer[] }> {
  const [members, expenses, payments] = await Promise.all([
    tx.member.findMany({ where: { groupId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } }),
    tx.expense.findMany({ where: { groupId, deletedAt: null }, include: { shares: true } }),
    tx.payment.findMany({ where: { groupId, deletedAt: null } }),
  ]);
  const memberIds = members.map((m) => m.id);
  const net = netBalances(memberIds, expenses, payments);
  return { memberIds, net, transfers: smartSettle(net) };
}

// Everyone an expense touches (payer, payers and sharers) - the people guardGroup must find still in the group.
export function peopleInExpense(e: { paidById: string; payers: { memberId: string }[]; shares: { memberId: string }[] }): string[] {
  return [...new Set([e.paidById, ...e.payers.map((p) => p.memberId), ...e.shares.map((s) => s.memberId)].filter(Boolean))];
}
