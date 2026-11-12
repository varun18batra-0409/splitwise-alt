import { db } from "./db";
import { setPushResyncCookie } from "./identity";
import { logEvent } from "./events";
import { cleanNames } from "./names";
import { freeName } from "./invites";
import { newInviteCode } from "./group-setup";
import { isGroupAdmin, pickAdmin } from "./group-admin";

// Joining a group from its invite link, and making a new link. Pure database
// work, no redirects, so it can be tested. The actions in app/actions.ts turn
// the answers into screens.
//
// - Someone the admin removed can't join again on their own: not with the old
//   link, not with a new one, not by taking over a different unclaimed name.
//   The admin can bring them back from People.
// - Someone who left on their own can rejoin from the link, as before.

export type JoinFail = { ok: false; reason: "gone" | "removed" | "claimed" | "retry" | "name"; adminName?: string };
export const NAME_NEEDED = "Add your name so the group knows who you are.";
export type JoinOk = { ok: true; memberId: string };
export type JoinAccount = { id: string; name: string; email: string };

async function loadByCode(code: string) {
  const group = await db.group.findUnique({ where: { inviteCode: code }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  return group && !group.deletedAt ? group : null;
}
type Loaded = NonNullable<Awaited<ReturnType<typeof loadByCode>>>;

// Has the admin removed this account from the group? Any row counts.
export function removedRow(group: Loaded, accountId: string) {
  return group.members.find((m) => m.accountId === accountId && m.removedAt) ?? null;
}

function removedBy(group: Loaded, row: { removedById: string }): string {
  return group.members.find((m) => m.id === row.removedById)?.name ?? pickAdmin(group.members)?.name ?? "";
}

// Emails with an open invitation (not joined, not declined) for this name row. Older tokens carried the row id before a dot.
export async function openInviteEmails(groupId: string, memberId: string): Promise<string[]> {
  const rows = await db.invite.findMany({
    where: { groupId, acceptedAt: null, declinedAt: null, OR: [{ memberId }, { token: { startsWith: `${memberId}.` } }] },
    select: { email: true },
  });
  return rows.map((r) => r.email.toLowerCase());
}

// Name rows nobody may take with "That's me" because an email invitation is open for them (for the join page's list).
export async function invitedNameRows(groupId: string): Promise<Set<string>> {
  const rows = await db.invite.findMany({ where: { groupId, acceptedAt: null, declinedAt: null }, select: { memberId: true, token: true } });
  return new Set(rows.map((r) => r.memberId || (r.token.includes(".") ? r.token.split(".")[0] : "")).filter(Boolean));
}

// Joining counts as having opened the group: an older pending row (added straight in) stops being pending.
async function markSeen(memberId: string) {
  await db.member.updateMany({ where: { id: memberId, seenAt: null }, data: { seenAt: new Date() } });
}

// "That's me": take over a name someone added before invitations existed.
export async function joinExisting(code: string, account: JoinAccount, memberId: string): Promise<JoinOk | JoinFail> {
  const group = await loadByCode(code);
  if (!group) return { ok: false, reason: "gone" };
  const gone = removedRow(group, account.id);
  if (gone) return { ok: false, reason: "removed", adminName: removedBy(group, gone) };
  const mine = group.members.find((m) => m.accountId === account.id);
  if (mine) {
    await markSeen(mine.id);
    return { ok: true, memberId: mine.id };
  }
  const member = group.members.find((m) => m.id === memberId);
  // Only names nobody has claimed yet (and nobody removed), and only one person can win the claim.
  if (!member || member.accountId || member.claimedAt || member.removedAt) return { ok: false, reason: "claimed" };
  // A name someone was invited as (by email) belongs to that invitation: only the invited email can take it.
  const open = await openInviteEmails(group.id, member.id);
  if (open.length && !open.includes(account.email.toLowerCase())) return { ok: false, reason: "claimed" };
  // The name changes owner: in the same write its epoch goes up (an old guest copy of it on another phone stops working) and
  // its notification rows go (that phone stops hearing about it). The callers copy the joiner's own phones onto it afterwards.
  const won = await db.$transaction(async (tx) => {
    const w = await tx.member.updateMany({ where: { id: member.id, accountId: null, claimedAt: null, removedAt: null }, data: { accountId: account.id, claimedAt: new Date(), seenAt: new Date(), grantEpoch: { increment: 1 } } });
    const dropped = w.count === 1 ? (await tx.pushSubscription.deleteMany({ where: { memberId: member.id } })).count : 0;
    return { count: w.count, dropped };
  });
  if (won.count !== 1) return { ok: false, reason: "claimed" };
  // Only when this name's notification rows actually went (the joiner's phones then re-register at once).
  if (won.dropped > 0) await setPushResyncCookie();
  if (!account.name) await db.account.update({ where: { id: account.id }, data: { name: member.name } });
  await logEvent(db, { groupId: group.id, actorId: member.id, kind: "members_added", text: "joined the group" });
  return { ok: true, memberId: member.id };
}

// Join as yourself (your verified account), or come back after leaving on your own.
export async function joinNew(code: string, account: JoinAccount, typedName: string): Promise<JoinOk | JoinFail> {
  const group = await loadByCode(code);
  if (!group) return { ok: false, reason: "gone" };
  const gone = removedRow(group, account.id);
  if (gone) return { ok: false, reason: "removed", adminName: removedBy(group, gone) };
  const mine = group.members.find((m) => m.accountId === account.id);
  if (mine) {
    if (mine.leftAt) await db.member.update({ where: { id: mine.id }, data: { leftAt: null } });
    await markSeen(mine.id);
    return { ok: true, memberId: mine.id };
  }
  // A name is never made up from the email address: if nobody gave one, ask for it.
  const typed = cleanNames([typedName])[0] ?? account.name;
  if (!typed) return { ok: false, reason: "name" };
  const name = freeName(group.members.map((m) => m.name), typed);
  if (!account.name) await db.account.update({ where: { id: account.id }, data: { name: typed } });
  let member;
  try {
    member = await db.member.create({ data: { name, groupId: group.id, claimedAt: new Date(), seenAt: new Date(), accountId: account.id, splitWeight: group.joinWeight } });
  } catch {
    // Pressed twice, or someone took the same name at the same moment: try again.
    return { ok: false, reason: "retry" };
  }
  await logEvent(db, {
    groupId: group.id,
    actorId: member.id,
    kind: "members_added",
    text: "joined the group",
    undo: { type: "members_remove", memberIds: [member.id] },
  });
  return { ok: true, memberId: member.id };
}

// How many email invites are still waiting (they stop working with a new link).
export async function waitingInvites(groupId: string): Promise<number> {
  return db.invite.count({ where: { groupId, acceptedAt: null } });
}

export const NEW_LINK_ADMIN_ONLY = "Only the person who looks after this group can make a new invite link.";

// A new invite link: the old link (and any email invite not yet accepted, which
// carries the old link) stops working. Only for whoever looks after the group.
export async function newInviteLink(groupId: string, actorId: string): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true, leftAt: true } } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  const me = group.members.find((m) => m.id === actorId);
  if (!me) return { ok: false, error: "Only people in this group can do this." };
  if (me.leftAt || !(await isGroupAdmin(groupId, actorId))) return { ok: false, error: NEW_LINK_ADMIN_ONLY };
  const code = newInviteCode();
  await db.group.update({ where: { id: groupId }, data: { inviteCode: code } });
  return { ok: true, code };
}
