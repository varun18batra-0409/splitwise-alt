import { db } from "./db";
import { getMyMemberId } from "./identity";
import { blockedEitherWay } from "./blocks";
import { groupAdminId } from "./group-admin";
import { isPending } from "./membership";

// Who may see and do what with a moment (a photo and a few words in a trip group). EVERY read and write of a moment goes through here:
// the upload and photo routes, the actions, the pages, Home's story circles, reports and "Download my data".
//
//   canSeeMoment(viewer, moment)   pure: the access table, tested row by row (tests/moments-access.test.ts)
//   loadMomentViewer(groupId)      who is asking: their member row, account, whether they look after the group, and their blocks
//
//   canUseMomentOnPostcard(viewer, moment)   pure: may this person copy their own moment's photo onto a postcard they are writing
//
// The group always comes from the moment's own row, never from the request. A refusal is always the same plain "not found".

export type MomentViewer = {
  groupId: string;
  groupType: string;
  groupDeleted: boolean;
  memberId: string;
  accountId: string | null; // null = a guest name (no email)
  leftAt: Date | null; // left on their own
  removedAt: Date | null; // taken out by the person who looks after the group
  pending: boolean; // added by someone, never opened the group
  isAdmin: boolean; // looks after the group (pickAdmin)
  blocked: ReadonlySet<string>; // accounts with a block between them and this person, either way
};

export type MomentFacts = { groupId: string; authorId: string; authorAccountId: string; createdAt: Date };

// In the group right now and allowed to take part.
const current = (v: MomentViewer) => !v.groupDeleted && !v.pending && !v.removedAt && !v.leftAt;

// Opening the group's moments at all (someone who left on their own still can, read-only).
export function canOpenMoments(v: MomentViewer | null): v is MomentViewer {
  return Boolean(v) && !v!.groupDeleted && !v!.pending && !v!.removedAt;
}

// Why a moment can't be seen is never told: callers answer 404 for every "no".
export function canSeeMoment(v: MomentViewer | null, m: MomentFacts): boolean {
  if (!canOpenMoments(v)) return false;
  if (v.groupId !== m.groupId) return false;
  if (m.authorAccountId !== v.accountId && v.blocked.has(m.authorAccountId)) return false; // a block, either way
  if (v.leftAt && m.createdAt.getTime() > v.leftAt.getTime()) return false; // added after they left
  return true;
}

// Adding needs an account (a guest is asked to sign in) and a trip group they are still in. Closed groups are fine.
export function canAddMoment(v: MomentViewer | null): v is MomentViewer {
  return Boolean(v) && current(v!) && v!.groupType === "trip" && v!.accountId !== null;
}

export function canReactToMoment(v: MomentViewer | null, m: MomentFacts): boolean {
  return Boolean(v) && current(v!) && canSeeMoment(v, m);
}

// The author (while they can still see it, even after leaving), or whoever looks after the group (while they are in it).
export function canDeleteMoment(v: MomentViewer | null, m: MomentFacts): boolean {
  if (!v || v.groupId !== m.groupId || v.groupDeleted || v.pending || v.removedAt) return false;
  const mine = v.accountId !== null ? m.authorAccountId === v.accountId : m.authorId === v.memberId;
  if (mine && canSeeMoment(v, m)) return true;
  return v.isAdmin && current(v);
}

// A postcard may carry a photo from a moment you added yourself, while you are still in that trip group (as a signed-in member).
// Never someone else's moment, never one from a group you left, were removed from, or that was deleted.
export function canUseMomentOnPostcard(v: MomentViewer | null, m: MomentFacts): boolean {
  return Boolean(v) && current(v!) && v!.accountId !== null && m.authorAccountId === v!.accountId && v!.groupId === m.groupId;
}

// Reporting needs an account and sight of the moment; you can't report your own.
export function canReportMoment(v: MomentViewer | null, m: MomentFacts): boolean {
  return Boolean(v) && v!.accountId !== null && m.authorAccountId !== v!.accountId && canSeeMoment(v, m);
}

// Who is asking, for this group. null = not in it at all (a stranger, signed out, or a phone that doesn't know the group).
export async function loadMomentViewer(groupId: string, memberId?: string): Promise<MomentViewer | null> {
  if (!groupId) return null;
  const myId = memberId ?? (await getMyMemberId(groupId));
  if (!myId) return null;
  const m = await db.member.findFirst({
    where: { id: myId, groupId },
    select: { id: true, accountId: true, leftAt: true, removedAt: true, addedBy: true, seenAt: true, group: { select: { type: true, deletedAt: true } } },
  });
  if (!m) return null;
  const isCurrent = !m.leftAt && !m.removedAt && !m.group.deletedAt;
  return {
    groupId,
    groupType: m.group.type,
    groupDeleted: m.group.deletedAt !== null,
    memberId: m.id,
    accountId: m.accountId,
    leftAt: m.leftAt && !m.removedAt ? m.leftAt : null,
    removedAt: m.removedAt ?? null,
    pending: isPending({ addedBy: m.addedBy, seenAt: m.seenAt }),
    isAdmin: isCurrent && (await groupAdminId(groupId)) === m.id,
    blocked: m.accountId ? await blockedEitherWay(m.accountId) : new Set<string>(),
  };
}

// The refusal for everything: the same answer whatever the reason, and never kept.
export const notFoundResponse = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
