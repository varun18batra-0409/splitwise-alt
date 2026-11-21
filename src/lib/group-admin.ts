import { db } from "./db";
import { isPending } from "./membership";

// Who looks after a group: the person who started it. If they've left, the
// next person who joined (in order) takes over. Only they can delete the
// group, change its currency or remove other people; everything else stays
// open to everyone.

// addedBy / seenAt / accountId are optional so callers that don't have them (older code, tests) still work; the rule below doesn't read accountId.
// someone added by another person who has never opened the group can't look after it.
export type AdminCandidate = { id: string; claimedAt: Date | null; leftAt: Date | null; addedBy?: string; seenAt?: Date | null; accountId?: string | null; freedAt?: Date | null };

const pending = (m: AdminCandidate) => isPending({ addedBy: m.addedBy ?? "", seenAt: m.seenAt ?? null });

// `members` in the order they were added (createdAt, then id).
// The live rule, unchanged: the first person who has taken their name (and not left), else the first person still here. It does NOT
// prefer people with an account: that would let a stranger with a forwarded link sign up and become admin the moment the creator
// leaves, and would change who looks after existing groups. A guest who ends up looking after the group is safe anyway: every
// admin action refuses a guest (gateGuest / signinIfGuest) and asks them to sign in.
export function pickAdmin<T extends AdminCandidate>(members: T[]): T | undefined {
  const here = members.filter((m) => !pending(m));
  // A name that has been freed passes on looking after the group as if that person had left: the next person who took their name (and
  // whose name was never freed) comes first. If nobody is left like that, the rule above applies unchanged.
  const oldRule = (list: T[]) => list.find((m) => m.claimedAt && !m.leftAt) ?? list.find((m) => !m.leftAt);
  return oldRule(here.filter((m) => !m.freedAt)) ?? oldRule(here);
}

// Who may bring a deleted group back (within 30 days): the person who deleted it, or whoever looks
// after the group now, and only if they haven't left. `members` in the order they were added.
// The Restore button on Home and restoreGroup both use this, so the screen never offers what the code refuses.
export function canRestoreGroup(group: { deletedById: string }, members: (AdminCandidate & { id: string })[], memberId: string | undefined): boolean {
  const me = members.find((m) => m.id === memberId);
  if (!me || me.leftAt) return false;
  return group.deletedById === me.id || pickAdmin(members)?.id === me.id;
}

export async function groupAdminId(groupId: string): Promise<string | undefined> {
  const members = await db.member.findMany({
    where: { groupId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, claimedAt: true, leftAt: true, addedBy: true, seenAt: true, accountId: true, freedAt: true },
  });
  return pickAdmin(members)?.id;
}

export async function isGroupAdmin(groupId: string, memberId: string): Promise<boolean> {
  return (await groupAdminId(groupId)) === memberId;
}
