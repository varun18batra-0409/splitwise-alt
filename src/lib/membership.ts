import type { Prisma } from "@prisma/client";

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
