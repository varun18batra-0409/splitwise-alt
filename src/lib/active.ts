import { db } from "./db";

// Someone who left a group keeps its history (read-only) but can no longer
// change it: no edits, deletes, undos, payments or settings, until they rejoin.
export const LEFT_ERROR = "You left this group. Rejoin it to make changes.";

export async function hasLeft(groupId: string, memberId: string | undefined, client: Pick<typeof db, "member"> = db): Promise<boolean> {
  if (!memberId) return false;
  const m = await client.member.findFirst({ where: { id: memberId, groupId }, select: { leftAt: true } });
  return Boolean(m?.leftAt);
}

// Someone an admin REMOVED (removedAt set) can't change the group's payments themselves: not delete, not restore, not Undo.
// (Someone who simply left can still delete their own payment and come back, see payment-change.ts. The OTHER person in a payment
// can still delete it, and that brings the removed person back owing.)
export const removedText = (groupName?: string) => `You were removed from ${groupName || "this group"}, so you can't change its payments.`;

export async function wasRemoved(groupId: string, memberId: string | undefined, client: Pick<typeof db, "member"> = db): Promise<boolean> {
  if (!memberId) return false;
  const m = await client.member.findFirst({ where: { id: memberId, groupId }, select: { removedAt: true } });
  return Boolean(m?.removedAt);
}
