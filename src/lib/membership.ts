import type { Prisma } from "@prisma/client";
import { db } from "./db";

// Who counts as having really joined a group.
//
// A member row is JOINED when nobody else added them (addedBy is empty: they
// started the group, joined by link or took a name themselves) or when they have
// opened the group since being added (seenAt is set). It is PENDING when someone
// else added them straight in and they have never opened the group.
//
// A person who has left is still joined: leaving doesn't undo having been there.
// Pending people don't get notifications, can't see or be seen on passports, and
// don't turn up in postcard, collection or search lists until they open the group.

// A Prisma "where" piece for member rows: spread it in (it holds one OR).
export const JOINED = { OR: [{ addedBy: "" }, { seenAt: { not: null } }] } satisfies Prisma.MemberWhereInput;

export function isPending(m: { addedBy: string; seenAt: Date | null }): boolean {
  return m.addedBy !== "" && m.seenAt === null;
}

// Older people who used a group before invitations existed: added straight in, never opened the group's page,
// but have themselves added an expense or payment there. They have clearly joined, so they stay joined (and
// their seenAt is set, one benign write). Returns the ids of the rows it confirmed.
export async function confirmUsedPending(accountId: string): Promise<string[]> {
  const pending = await db.member.findMany({ where: { accountId, addedBy: { not: "" }, seenAt: null }, select: { id: true } });
  if (!pending.length) return [];
  const ids = pending.map((p) => p.id);
  const [spent, paid] = await Promise.all([
    db.expense.findMany({ where: { createdById: { in: ids } }, select: { createdById: true }, distinct: ["createdById"] }),
    db.payment.findMany({ where: { createdById: { in: ids } }, select: { createdById: true }, distinct: ["createdById"] }),
  ]);
  const used = [...new Set([...spent, ...paid].map((r) => r.createdById))].filter((id) => ids.includes(id));
  if (used.length) await db.member.updateMany({ where: { id: { in: used }, seenAt: null }, data: { seenAt: new Date() } });
  return used;
}
