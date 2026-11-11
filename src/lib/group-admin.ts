import { db } from "./db";
import { isPending } from "./membership";

// Who looks after a group: the person who started it. If they've left, the
// next person who joined (in order) takes over. Only they can delete the
// group, change its currency or remove other people; everything else stays
// open to everyone.

// addedBy / seenAt are optional so callers that don't have them (older code, tests) still work;
// someone added by another person who has never opened the group can't look after it.
export type AdminCandidate = { id: string; claimedAt: Date | null; leftAt: Date | null; addedBy?: string; seenAt?: Date | null };

const pending = (m: AdminCandidate) => isPending({ addedBy: m.addedBy ?? "", seenAt: m.seenAt ?? null });

// `members` in the order they were added (createdAt, then id).
export function pickAdmin<T extends AdminCandidate>(members: T[]): T | undefined {
  const here = members.filter((m) => !pending(m));
  return here.find((m) => m.claimedAt && !m.leftAt) ?? here.find((m) => !m.leftAt);
}

export async function groupAdminId(groupId: string): Promise<string | undefined> {
  const members = await db.member.findMany({
    where: { groupId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, claimedAt: true, leftAt: true, addedBy: true, seenAt: true },
  });
  return pickAdmin(members)?.id;
}

export async function isGroupAdmin(groupId: string, memberId: string): Promise<boolean> {
  return (await groupAdminId(groupId)) === memberId;
}
