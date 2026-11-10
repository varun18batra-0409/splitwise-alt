import { db } from "./db";

// Someone who left a group keeps its history (read-only) but can no longer
// change it: no edits, deletes, undos, payments or settings, until they rejoin.
export const LEFT_ERROR = "You left this group. Rejoin it to make changes.";

export async function hasLeft(groupId: string, memberId: string | undefined): Promise<boolean> {
  if (!memberId) return false;
  const m = await db.member.findFirst({ where: { id: memberId, groupId }, select: { leftAt: true } });
  return Boolean(m?.leftAt);
}
