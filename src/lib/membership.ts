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

// History lines written for something done FOR a person, not BY them. They never prove somebody has joined:
// the month's bill is added by the daily job in the payer's name, and "I paid" on a reminder link is typed by
// whoever holds the link (who may not have an account or have opened the group).
export const REPEAT_BILL_MARK = "· repeat bill";
export const PAY_LINK_MARK = "(from the reminder link)";

// Older people who used a group before invitations existed: added straight in, never opened the group's page,
// but have themselves added an expense or payment there. They have clearly joined, so they stay joined (and
// their seenAt is set, one benign write). Returns the ids of the rows it confirmed.
//
// "Themselves" is read from the history: an expense or payment recorded with their own hand (or another thing only they could do, see SELF_ACTION_KINDS). Expenses the daily
// job added in their name (the month's bill) and payments made from a reminder link don't count.
// One small query for the pending rows, and only when there are any; one more, limited to those rows' groups.
// Everything a person writes only by acting themselves: an expense or payment, confirming a payment they were sent,
// "We settled outside the app", and starting, finishing or reopening a game. (Not the bill run's "now paid by" edits or
// the pay-link "took back" line: those are typed in someone's name by the app or by whoever holds the link.)
export const SELF_ACTION_KINDS = ["expense_added", "payment_recorded", "payment_confirmed", "group_settled_closed", "pot_started", "pot_finished", "pot_reopened"];

export async function confirmUsedPending(accountId: string): Promise<string[]> {
  const pending = await db.member.findMany({ where: { accountId, addedBy: { not: "" }, seenAt: null }, select: { id: true, groupId: true } });
  if (!pending.length) return [];
  const ids = pending.map((p) => p.id);
  const did = await db.groupEvent.findMany({
    where: {
      groupId: { in: [...new Set(pending.map((p) => p.groupId))] },
      actorId: { in: ids },
      kind: { in: SELF_ACTION_KINDS },
      NOT: [{ text: { contains: REPEAT_BILL_MARK } }, { text: { contains: PAY_LINK_MARK } }],
    },
    select: { actorId: true },
    distinct: ["actorId"],
  });
  const used = did.map((r) => r.actorId).filter((id) => ids.includes(id));
  if (used.length) await db.member.updateMany({ where: { id: { in: used }, seenAt: null }, data: { seenAt: new Date() } });
  return used;
}
