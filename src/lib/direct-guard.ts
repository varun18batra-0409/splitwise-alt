import { db } from "./db";
import { DIRECT } from "./direct";

// One small read for the places that must never work on a pair (a hidden two-person group): moving out, "settle everything and close",
// removing or restoring people. Kept on its own (db only) so any lib file can import it without a cycle.
export const PAIR_NO_MOVE_OUT = "This is just between two people, so there is no moving out.";
export const PAIR_NO_CLOSE = "This is just between two people, so it can’t be closed. Record payments one by one instead.";
export const PAIR_NO_PEOPLE = "This is just between two people, so nobody can be added or removed.";

export async function isPairGroup(groupId: string): Promise<boolean> {
  return (await db.group.findUnique({ where: { id: groupId }, select: { type: true } }))?.type === DIRECT;
}
