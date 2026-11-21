import { db } from "./db";
import { setPushResyncCookie } from "./identity";
import { logEvent } from "./events";
import { cleanNames } from "./names";
import { freeName } from "./invites";
import { newInviteCode } from "./group-setup";
import { isGroupAdmin, pickAdmin } from "./group-admin";
import { ownMoveOut, undoViewerFor } from "./undo";
import { removedByEmail } from "./removal-marks";
import { allow } from "./rate-limit";
import { GUEST_REFUSAL } from "./guest-rules";

// Joining a group from its invite link, and making a new link. Pure database
// work, no redirects, so it can be tested. The actions in app/actions.ts turn
// the answers into screens.
//
// - Someone the admin removed can't join again on their own: not with the old
//   link, not with a new one, not by taking over a different unclaimed name.
//   The admin can bring them back from People.
// - Someone who left on their own can rejoin from the link, as before.

// "moved_out": they moved out with Loopin and can still undo it, so the link doesn't quietly put them back (groupId and memberId say where to send them).
export type JoinFail = { ok: false; reason: "gone" | "removed" | "claimed" | "retry" | "name" | "moved_out" | "left" | "full";  adminName?: string; groupId?: string; memberId?: string };
export const NAME_NEEDED = "Add your name so the group knows who you are.";
export type JoinOk = { ok: true; memberId: string };
export type JoinAccount = { id: string; name: string; email: string };

// A pair of two people (type "direct") has no join link: its code is never shown, and nothing finds it unless `allowDirect` (never set by a page).
export async function loadByCode(code: string, opts: { allowDirect?: boolean } = {}) {
  const group = await db.group.findUnique({ where: { inviteCode: code }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (group?.type === "direct" && !opts.allowDirect) return null;
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

// Removed by the admin, then deleted their account and signed up again with the same email: the group kept a scrambled note of the
// address (removal-marks.ts). Only for an account with no row of its own in the group. The admin inviting them back (and them
// accepting) is the only way in, and clears the note.
async function removedAfterReSignup(group: Loaded, account: JoinAccount): Promise<JoinFail | null> {
  if (group.members.some((m) => m.accountId === account.id)) return null;
  const mark = await removedByEmail(group.id, account.email);
  return mark ? { ok: false, reason: "removed", adminName: removedBy(group, { removedById: mark.by }) } : null;
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
// `forGuest`: a visitor with no account (see reservedForGuest): a closed invitation keeps the name reserved too.
export async function invitedNameRows(groupId: string, opts: { forGuest?: boolean } = {}): Promise<Set<string>> {
  const rows = await db.invite.findMany({ where: { groupId, acceptedAt: null, ...(opts.forGuest ? {} : { declinedAt: null }) }, select: { memberId: true, token: true } });
  return new Set(rows.map((r) => r.memberId || (r.token.includes(".") ? r.token.split(".")[0] : "")).filter(Boolean));
}

// A name that was invited by email stays reserved for that email as far as a guest is concerned, even when the invitation is closed
// (a new link closes every open invitation, and "Not now" closes one): a guest has no email to match, so only a signed-in person with
// the right address, or the person who looks after the group, can hand the name on. Accepted ones belong to an account already.
export async function reservedForGuest(groupId: string, memberId: string): Promise<boolean> {
  return (await db.invite.count({ where: { groupId, acceptedAt: null, OR: [{ memberId }, { token: { startsWith: `${memberId}.` } }] } })) > 0;
}

// Joining counts as having opened the group: an older pending row (added straight in) stops being pending.
async function markSeen(memberId: string) {
  await db.member.updateMany({ where: { id: memberId, seenAt: null }, data: { seenAt: new Date() } });
}

// "That's me": take over a name someone added before invitations existed.
// `skipRemovalMark`: only for an invitation the admin sent after the removal (invitations.ts), which clears the note itself.
export async function joinExisting(code: string, account: JoinAccount, memberId: string, opts: { allowDirect?: boolean; skipRemovalMark?: boolean } = {}): Promise<JoinOk | JoinFail> {
  const group = await loadByCode(code, opts);
  if (!group) return { ok: false, reason: "gone" };
  const gone = removedRow(group, account.id);
  if (gone) return { ok: false, reason: "removed", adminName: removedBy(group, gone) };
  if (!opts.skipRemovalMark) {
    const marked = await removedAfterReSignup(group, account);
    if (marked) return marked;
  }
  const mine = group.members.find((m) => m.accountId === account.id);
  if (mine) {
    await markSeen(mine.id);
    return { ok: true, memberId: mine.id };
  }
  const member = group.members.find((m) => m.id === memberId);
  // Only names nobody has claimed yet (and nobody removed), and only one person can win the claim.
  if (!member || member.accountId || member.claimedAt || member.removedAt) return { ok: false, reason: "claimed" };
  // A name that has left the group can't be taken over (its history is not for a new account to pick up).
  if (member.leftAt) return { ok: false, reason: "left" };
  // A name someone was invited as (by email) belongs to that invitation: only the invited email can take it.
  const open = await openInviteEmails(group.id, member.id);
  if (open.length && !open.includes(account.email.toLowerCase())) return { ok: false, reason: "claimed" };
  // The name changes owner: in the same write its epoch goes up (an old guest copy of it on another phone stops working) and
  // its notification rows go (that phone stops hearing about it). The callers copy the joiner's own phones onto it afterwards.
  const won = await db.$transaction(async (tx) => {
    const w = await tx.member.updateMany({ where: { id: member.id, accountId: null, claimedAt: null, removedAt: null, leftAt: null }, data: { accountId: account.id, claimedAt: new Date(), seenAt: new Date(), grantEpoch: { increment: 1 } } });
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

// Someone who already has a row in this group and comes back through the link (an account, or a guest name this phone holds).
// Returns an answer to hand back, or null when they are simply in (the caller marks them seen and says ok).
async function rejoinHeld(group: Loaded, mine: Loaded["members"][number], afterRead?: () => Promise<void>): Promise<JoinFail | null> {
  // (Only while the move-out can really still be undone: if it can't, nothing is left to protect and the link rejoins as before.)
  if (mine.leftAt && (await ownMoveOut(group.id, await undoViewerFor(group.id, mine.id), new Date()))?.check.ok) {
    return { ok: false, reason: "moved_out", groupId: group.id, memberId: mine.id };
  }
  // Only if they are still not removed (a removal landing a moment ago must not be undone by this write).
  // Coming back through the link is a line in the history like every other way back (people.ts, invitations.ts): it says when the
  // stay began again, and its undo puts them back as they were. Clearing leftAt and writing that line are ONE write: if the line
  // fails, leftAt is not cleared (a stay with no line would otherwise be counted as starting later than it did).
  if (mine.leftAt) {
    const leftAt = mine.leftAt;
    await afterRead?.();
    // The write only matches the row as it was read (still left on that same day): a second tap, or another phone, finds it already back
    // and writes no second line. Back already (and not removed) is the answer they wanted; anything else is "try again".
    const back = await db.$transaction(async (tx) => {
      if ((await tx.member.updateMany({ where: { id: mine.id, removedAt: null, leftAt }, data: { leftAt: null } })).count !== 1) {
        return (await tx.member.count({ where: { id: mine.id, removedAt: null, leftAt: null } })) === 1;
      }
      await logEvent(tx, { groupId: group.id, actorId: mine.id, kind: "member_rejoined", text: "rejoined the group", undo: { type: "member_set", memberId: mine.id, data: { leftAt: leftAt.toISOString() } } });
      return true;
    });
    if (!back) return { ok: false, reason: "retry" };
  }
  return null;
}

// Join as yourself (your verified account), or come back after leaving on your own.
// (`opts.afterRead` is for tests only, like the other money and membership writes: it runs between the read and the write. No caller
// passes it from a request.)
export async function joinNew(code: string, account: JoinAccount, typedName: string, opts: { skipRemovalMark?: boolean; afterRead?: () => Promise<void> } = {}): Promise<JoinOk | JoinFail> {
  const group = await loadByCode(code);
  if (!group) return { ok: false, reason: "gone" };
  const gone = removedRow(group, account.id);
  if (gone) return { ok: false, reason: "removed", adminName: removedBy(group, gone) };
  if (!opts.skipRemovalMark) {
    const marked = await removedAfterReSignup(group, account);
    if (marked) return marked;
  }
  const mine = group.members.find((m) => m.accountId === account.id);
  if (mine) {
    const back = await rejoinHeld(group, mine, opts.afterRead);
    if (back) return back;
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


// ---------- Joining without an account (a "guest") ----------
// The same rules as above, for a person with no account: the name is held by a signed note on their phone (setMyMemberId writes it),
// and the group's own people see it on People ("no account yet"). `heldMemberId` is the name this phone already holds in the group, if any.

// Most people a guest join can bring a group to (guests only; an account holder is not counted against it).
export const GUEST_GROUP_CAP = 60;
export const GUEST_JOIN_PER_IP = 20; // an hour (the account join keeps its own, looser 120 for a whole party on one Wi-Fi)
export const GUEST_JOIN_PER_LINK = 30; // a day

// The limits on guest joins (both actions); false means "busy".
// Every attempt counts against the network (20 an hour). Only a SUCCESSFUL new guest join counts against the link (30 a day), and the
// link is the invite code, so a new link starts fresh. A phone that already holds a name in the group is sent straight in, uncounted.
export async function guestAttemptAllowed(ip: string, now = new Date()): Promise<boolean> {
  return allow(`join-guest-ip:${ip}`, GUEST_JOIN_PER_IP, 3600, now);
}
const linkKey = (code: string) => `join-guest-link:${code.slice(0, 60)}`;
// Is the link still under its daily limit? Only looks, uses nothing. (Simultaneous joins can overshoot 30 slightly: accepted, it is a soft cap, and the 20 an hour per network keeps it small.)
export async function guestLinkOpen(code: string, now = new Date()): Promise<boolean> {
  try {
    const row = await db.rateLimit.findUnique({ where: { key: linkKey(code) } });
    return !(row && row.resetAt > now && row.count >= GUEST_JOIN_PER_LINK);
  } catch {
    return true; // never block people because the counter itself failed
  }
}
// A new guest really joined through this link: one more for today.
export async function countGuestJoin(code: string, now = new Date()): Promise<void> {
  await allow(linkKey(code), GUEST_JOIN_PER_LINK, 86400, now);
}
// Both checks together, before the join (nothing is counted against the link yet).
export async function guestJoinAllowed(ip: string, code: string, now = new Date()): Promise<boolean> {
  return (await guestAttemptAllowed(ip, now)) && (await guestLinkOpen(code, now));
}

// The phone's own name in this group, if it is still a way in: a removed name is refused (the cookie still holds it).
function heldRow(group: Loaded, heldMemberId?: string) {
  return heldMemberId ? group.members.find((m) => m.id === heldMemberId && !m.accountId) ?? null : null;
}

// "That's me" with no account: take over a name nobody has joined as. Reserved (an open email invitation), left, removed or already
// taken names are refused. One conditional write decides between two phones; the winner's epoch goes up, so any old copy is refused.
export async function joinExistingAsGuest(code: string, memberId: string, heldMemberId?: string): Promise<JoinOk | JoinFail> {
  const group = await loadByCode(code);
  if (!group) return { ok: false, reason: "gone" };
  const held = heldRow(group, heldMemberId);
  if (held?.removedAt) return { ok: false, reason: "removed", adminName: removedBy(group, held) };
  // This phone already holds a name here: that is who they are (no second name).
  if (held && !held.leftAt) {
    await markSeen(held.id);
    return { ok: true, memberId: held.id };
  }
  const member = group.members.find((m) => m.id === memberId);
  if (!member || member.accountId || member.claimedAt || member.removedAt) return { ok: false, reason: "claimed" };
  if (member.leftAt) return { ok: false, reason: "left" };
  // A guest has no email to match, so ANY invitation on the name that was never accepted (open or closed) means it is reserved.
  if (await reservedForGuest(group.id, member.id)) return { ok: false, reason: "claimed" };
  const won = await db.$transaction(async (tx) => {
    const w = await tx.member.updateMany({ where: { id: member.id, accountId: null, claimedAt: null, removedAt: null, leftAt: null }, data: { claimedAt: new Date(), seenAt: new Date(), grantEpoch: { increment: 1 } } });
    if (w.count === 1) await tx.pushSubscription.deleteMany({ where: { memberId: member.id } });
    return w.count;
  });
  if (won !== 1) return { ok: false, reason: "claimed" };
  await logEvent(db, { groupId: group.id, actorId: member.id, kind: "members_added", text: "joined the group" });
  return { ok: true, memberId: member.id };
}

// Join as someone new with no account (or come back, on the phone that holds the name, after leaving on your own).
export async function joinNewAsGuest(code: string, typedName: string, heldMemberId?: string, opts: { afterRead?: () => Promise<void> } = {}): Promise<JoinOk | JoinFail> {
  const group = await loadByCode(code);
  if (!group) return { ok: false, reason: "gone" };
  const held = heldRow(group, heldMemberId);
  if (held?.removedAt) return { ok: false, reason: "removed", adminName: removedBy(group, held) };
  if (held) {
    const back = await rejoinHeld(group, held, opts.afterRead);
    if (back) return back;
    await markSeen(held.id);
    return { ok: true, memberId: held.id };
  }
  const typed = cleanNames([typedName])[0];
  if (!typed) return { ok: false, reason: "name" };
  if (group.members.filter((m) => !m.leftAt).length >= GUEST_GROUP_CAP) return { ok: false, reason: "full" };
  const name = freeName(group.members.map((m) => m.name), typed);
  let member;
  try {
    member = await db.member.create({ data: { name, groupId: group.id, claimedAt: new Date(), seenAt: new Date(), accountId: null, splitWeight: group.joinWeight } });
  } catch {
    return { ok: false, reason: "retry" };
  }
  // No Undo on a guest's own "joined the group" line: undoing it would mark them removed by themselves and lock them out.
  await logEvent(db, { groupId: group.id, actorId: member.id, kind: "members_added", text: "joined the group" });
  return { ok: true, memberId: member.id };
}

// "Free this name": a name held with no account (the wrong person took it, or the phone was lost) goes back to "Which one is you?".
// Who may: whoever looks after the group (with an account), or the guest on their own name ("Not me"). One write clears claimedAt,
// raises the epoch (the old phone is refused) and drops that name's notification rows; the history gets a line. Balances do not change.
export async function releaseGuestName(groupId: string, actorId: string, memberId: string): Promise<{ ok: true; eventId?: string } | { ok: false; error: string }> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (group.type === "direct") return { ok: false, error: "This is just between two people." };
  const me = group.members.find((m) => m.id === actorId);
  const target = group.members.find((m) => m.id === memberId);
  if (!me || me.removedAt) return { ok: false, error: "Only people in this group can do this." };
  if (!target) return { ok: false, error: "That person is no longer in the group." };
  const self = actorId === memberId;
  if (me.leftAt) return { ok: false, error: "Only people still in this group can do this." }; // someone who has left frees nothing, not even their own name
  if (!self) {
    if (!(await isGroupAdmin(groupId, actorId))) return { ok: false, error: "Only the person who looks after this group can free someone else’s name." };
    if (me.accountId === null) return { ok: false, error: GUEST_REFUSAL };
    if (target.leftAt || target.removedAt) return { ok: false, error: "That person has left the group, so their name stays as it is." };
  }
  if (target.accountId || !target.claimedAt) return { ok: false, error: "That name isn’t held by someone without an account." };
  const eventId = await db.$transaction(async (tx) => {
    const w = await tx.member.updateMany({ where: { id: target.id, accountId: null, claimedAt: { not: null }, ...(self ? {} : { leftAt: null, removedAt: null }) }, data: { claimedAt: null, freedAt: new Date(), grantEpoch: { increment: 1 } } });
    if (w.count !== 1) return "";
    await tx.pushSubscription.deleteMany({ where: { memberId: target.id } });
    return logEvent(tx, { groupId, actorId, kind: "members_added", text: self ? "freed their name (it was not them)" : `freed the name ${target.name}` });
  });
  if (!eventId) return { ok: false, error: "That name was already freed." };
  await setPushResyncCookie();
  return { ok: true, eventId };
}

// How many email invites are still waiting (they stop working with a new link).
export async function waitingInvites(groupId: string): Promise<number> {
  return db.invite.count({ where: { groupId, acceptedAt: null, declinedAt: null } }); // closed (cancelled, declined, or by a new link) ones are not waiting
}

export const NEW_LINK_ADMIN_ONLY = "Only the person who looks after this group can make a new invite link.";

// A new invite link: the old link (and any email invite not yet accepted, which
// carries the old link) stops working. Only for whoever looks after the group.
export async function newInviteLink(groupId: string, actorId: string): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true, leftAt: true } } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (group.type === "direct") return { ok: false, error: "This is just between two people, so there is no invite link." };
  const me = group.members.find((m) => m.id === actorId);
  if (!me) return { ok: false, error: "Only people in this group can do this." };
  if (me.leftAt || !(await isGroupAdmin(groupId, actorId))) return { ok: false, error: NEW_LINK_ADMIN_ONLY };
  const code = newInviteCode();
  // The old email invitations carry the old link, so they close in the same step as the code changes (never one without the other).
  await db.$transaction([
    db.group.update({ where: { id: groupId }, data: { inviteCode: code } }),
    db.invite.updateMany({ where: { groupId, acceptedAt: null, declinedAt: null }, data: { declinedAt: new Date() } }),
  ]);
  return { ok: true, code };
}
