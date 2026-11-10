import { db } from "./db";

// Who looks after a group: the person who started it. If they've left, the
// next person who joined (in order) takes over. Only they can delete the
// group, change its currency or remove other people; everything else stays
// open to everyone.

export type AdminCandidate = { id: string; claimedAt: Date | null; leftAt: Date | null };

// `members` in the order they were added (createdAt, then id).
export function pickAdmin<T extends AdminCandidate>(members: T[]): T | undefined {
  return members.find((m) => m.claimedAt && !m.leftAt) ?? members.find((m) => !m.leftAt);
}

export async function groupAdminId(groupId: string): Promise<string | undefined> {
  const members = await db.member.findMany({
    where: { groupId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, claimedAt: true, leftAt: true },
  });
  return pickAdmin(members)?.id;
}

export async function isGroupAdmin(groupId: string, memberId: string): Promise<boolean> {
  return (await groupAdminId(groupId)) === memberId;
}
