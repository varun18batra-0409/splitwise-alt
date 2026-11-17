import { db } from "./db";
import { logEvent } from "./events";
import { isGroupAdmin } from "./group-admin";
import { blockedEitherWay, isBlockedEitherWay } from "./blocks";
import { copyPushTo, inviteMemberId } from "./invites";
import { joinExisting, joinNew, NAME_NEEDED, type JoinFail, type JoinOk } from "./join";
import { clearRemovalMark, removedByEmail } from "./removal-marks";
import { claimDirectInvite } from "./direct-db";
import { MOVED_OUT_REJOIN_TEXT, ownMoveOut, undoViewerFor } from "./undo";

// Invitations from the invitee's side: the Join / Not now cards on Home and Alerts and the
// "Asha added you to this group" screen. Pure database work (no redirects) so it can be tested.
//
// Two kinds of invitation look the same to the invitee:
//  - new: someone invited their email. The group already holds a name-only row for them (the Invite
//    carries that row's id). Join links the row to their account.
//  - older: someone added them straight in before invitations existed (their row has an account,
//    addedBy set and seenAt empty). Join sets seenAt. Not now takes the account off the row, so it
//    becomes a plain name again.
// Nothing here changes any balance: the row, its expenses and payments stay as they are.

export type Invitation = {
  key: string; // the token, or "m:<memberId>" for the older kind
  token: string; // "" for the older kind
  memberId: string; // their name row (or their own row for the older kind)
  groupId: string;
  groupName: string;
  type: string;
  cover: { id: string; type: string; cover: string | null; coverAt: Date | null };
  people: number;
  byName: string;
  used: number; // expenses already using their name
};

type Account = { id: string; name: string; email: string };

// How many active expenses already have this name in them ("You're already in 3 of its expenses").
export async function usedBy(groupId: string, memberId: string): Promise<number> {
  if (!memberId) return 0;
  return db.expense.count({ where: { groupId, deletedAt: null, OR: [{ paidById: memberId }, { payers: { contains: memberId } }, { shares: { some: { memberId } } }] } });
}

// Everything this account is invited to and hasn't answered.
export async function loadInvitations(account: Account | null): Promise<Invitation[]> {
  if (!account) return [];
  const groupSelect = { id: true, name: true, type: true, cover: true, coverAt: true, inviteCode: true, deletedAt: true, members: { select: { id: true, name: true, accountId: true, leftAt: true, removedAt: true } } } as const;
  const [invites, olds] = await Promise.all([
    db.invite.findMany({ where: { email: account.email, acceptedAt: null, declinedAt: null, token: { not: "" }, group: { deletedAt: null } }, include: { group: { select: groupSelect } }, orderBy: { createdAt: "desc" } }),
    db.member.findMany({
      where: { accountId: account.id, addedBy: { not: "" }, seenAt: null, leftAt: null, removedAt: null, group: { deletedAt: null } },
      include: { group: { select: groupSelect } },
    }),
  ]);
  const out: Invitation[] = [];
  // An invitation from someone with a block between them and this person (either way) doesn't show (the name stays in the group, so the money still works).
  const blocked = await blockedEitherWay(account.id);
  const fromBlocked = (members: { id: string; accountId: string | null }[], inviterMemberId: string) => {
    const a = members.find((m) => m.id === inviterMemberId)?.accountId;
    return Boolean(a && blocked.has(a));
  };
  for (const i of invites) {
    const g = i.group;
    if (fromBlocked(g.members, i.invitedById)) continue;
    const own = g.members.find((m) => m.accountId === account.id);
    // Already in that group: nothing to answer. Someone who left on their own, or whom the admin removed, has something to answer
    // only if the invitation is for their own row (a removed person's only if the admin sent it).
    const ownBack = own && own.id === inviteMemberId(i) && (own.leftAt || own.removedAt);
    if (own && !ownBack) continue;
    // A removed person's only counts if the admin sent it AFTER the removal (an older one was closed by the removal, and never counts).
    if (own?.removedAt && (i.createdAt.getTime() < own.removedAt.getTime() || !(await isGroupAdmin(g.id, i.invitedById)))) continue;
    // Removed by the admin, then deleted their account and signed up again: only an invitation the admin sent after the removal can be
    // accepted (acceptInvitation refuses the rest), so the others are not shown.
    if (!own) {
      const mark = await removedByEmail(g.id, account.email);
      if (mark && (i.createdAt.getTime() < mark.at.getTime() || !(await isGroupAdmin(g.id, i.invitedById)))) continue;
    }
    const memberId = g.members.find((m) => m.id === inviteMemberId(i) && (own ? m.id === own.id : !m.removedAt && !m.accountId && !m.leftAt))?.id ?? "";
    // Their name was taken out of the group again (or taken by someone else): nothing to answer any more.
    if (!memberId) continue;
    out.push({
      key: i.token, token: i.token, memberId, groupId: g.id, groupName: g.name, type: g.type,
      cover: { id: g.id, type: g.type, cover: g.cover, coverAt: g.coverAt },
      people: g.members.filter((m) => !m.leftAt).length,
      byName: g.members.find((m) => m.id === i.invitedById)?.name ?? "Someone",
      used: await usedBy(g.id, memberId),
    });
  }
  for (const m of olds) {
    const g = m.group;
    if (fromBlocked(g.members, m.addedBy)) continue;
    out.push({
      key: `m:${m.id}`, token: "", memberId: m.id, groupId: g.id, groupName: g.name, type: g.type,
      cover: { id: g.id, type: g.type, cover: g.cover, coverAt: g.coverAt },
      people: g.members.filter((x) => !x.leftAt).length,
      byName: g.members.find((x) => x.id === m.addedBy)?.name ?? "Someone",
      used: await usedBy(g.id, m.id),
    });
  }
  return out;
}

// The invitation to one group, if this account has one (for the group's own screen).
export async function invitationFor(account: Account | null, groupId: string): Promise<Invitation | null> {
  return (await loadInvitations(account)).find((i) => i.groupId === groupId) ?? null;
}

class InviteClosed extends Error {}

// Is there a block (either way) between this account and the account behind a member row (the person who added or invited them)?
async function blockedWith(accountId: string, memberId: string): Promise<boolean> {
  if (!memberId) return false;
  const by = await db.member.findUnique({ where: { id: memberId }, select: { accountId: true } });
  return Boolean(by?.accountId && (await isBlockedEitherWay(accountId, by.accountId)));
}

export type Answer = { ok: true; groupId: string; memberId: string } | { ok: false; error: string; movedOut?: { groupId: string; memberId: string } };
const GONE = "This invitation is no longer there.";
const CLOSED = "This invitation is no longer open.";

// Join. `key` is the token, or "m:<memberId>" for the older kind.
export async function acceptInvitation(account: Account, key: string): Promise<Answer> {
  if (key.startsWith("m:")) {
    const m = await db.member.findFirst({ where: { id: key.slice(2), accountId: account.id, addedBy: { not: "" }, seenAt: null, leftAt: null, removedAt: null, group: { deletedAt: null } } });
    if (!m) return { ok: false, error: GONE };
    // A block either way with whoever added them: the invitation is gone (nothing is written).
    if (await blockedWith(account.id, m.addedBy)) return { ok: false, error: GONE };
    await db.member.updateMany({ where: { id: m.id, seenAt: null, leftAt: null, removedAt: null }, data: { seenAt: new Date() } });
    return { ok: true, groupId: m.groupId, memberId: m.id };
  }
  const inv = key ? await db.invite.findFirst({ where: { token: key, email: account.email }, include: { group: { select: { id: true, inviteCode: true, deletedAt: true, type: true } } } }) : null;
  if (!inv || inv.group.deletedAt) return { ok: false, error: GONE };
  // A block either way with whoever sent it: the invitation is gone (nothing is written).
  if (await blockedWith(account.id, inv.invitedById)) return { ok: false, error: GONE };
  // Closed on purpose (Not now, cancelled by the person who sent it, or replaced by an invitation to another address).
  if (inv.declinedAt && !inv.acceptedAt) return { ok: false, error: CLOSED };
  // Someone shared expenses with you directly: the name row becomes you (and the pair's key becomes the two of you) in one step.
  // If you two already share a pair, nothing merges: the invitation is closed with a clear message. Never falls back to joining as someone new.
  if (inv.group.type === "direct") {
    if (inv.acceptedAt) return { ok: false, error: CLOSED };
    return claimDirectInvite(account, { id: inv.id, groupId: inv.groupId, memberId: inviteMemberId(inv), invitedById: inv.invitedById });
  }
  const code = inv.group.inviteCode;
  const memberId = inviteMemberId(inv);
  // The invitation is for one row. If that row is gone (undone) or was removed, there is nothing to join: no joining as someone new instead.
  // The invitation itself is left as it is, so if the row comes back (Redo) the card comes back with it.
  const row = memberId ? await db.member.findFirst({ where: { id: memberId, groupId: inv.groupId } }) : null;
  // A name that has left is never taken over by another account either (AS-5).
  if (!row || ((row.removedAt || row.leftAt) && row.accountId !== account.id)) return { ok: false, error: CLOSED };
  let r: JoinOk | JoinFail;
  if (row.accountId === account.id) {
    // Their own row. Closing the invitation and clearing the left / removed mark happen in ONE step, each guarded on what was read:
    // if any part fails, nothing is changed. A removed person only comes back through an invitation the admin sent AFTER the removal.
    const wasOut = Boolean(row.leftAt || row.removedAt);
    // Someone who moved out with Loopin and can still undo it is told about "Undo my move-out" first, not put back without it
    // (only while that undo can really go through: otherwise nothing is left to protect).
    if (row.leftAt && !row.removedAt && (await ownMoveOut(inv.groupId, await undoViewerFor(inv.groupId, row.id), new Date()))?.check.ok) {
      return { ok: false, error: MOVED_OUT_REJOIN_TEXT, movedOut: { groupId: inv.groupId, memberId: row.id } };
    }
    if (row.removedAt && (inv.acceptedAt || inv.createdAt.getTime() < row.removedAt.getTime() || !(await isGroupAdmin(inv.groupId, inv.invitedById)))) return { ok: false, error: CLOSED };
    try {
      await db.$transaction(async (tx) => {
        const closed = await tx.invite.updateMany({ where: { id: inv.id, acceptedAt: null, declinedAt: null }, data: { acceptedAt: new Date() } });
        if (wasOut) {
          if (closed.count !== 1) throw new InviteClosed();
          const back = await tx.member.updateMany({ where: { id: row.id, accountId: account.id, leftAt: row.leftAt, removedAt: row.removedAt }, data: { leftAt: null, removedAt: null, removedById: "" } });
          if (back.count !== 1) throw new InviteClosed();
          // This counts as a change to that person, so an older undo (say, the admin's old removal) can't push them out again.
          await logEvent(tx, {
            groupId: inv.groupId,
            actorId: row.id,
            kind: "member_rejoined",
            text: "rejoined the group",
            undo: {
              type: "member_set",
              memberId: row.id,
              data: row.removedAt
                ? { leftAt: (row.leftAt ?? row.removedAt).toISOString(), removedAt: row.removedAt.toISOString(), removedById: row.removedById }
                : { leftAt: row.leftAt!.toISOString() },
            },
          });
        }
        await tx.member.updateMany({ where: { id: row.id, seenAt: null }, data: { seenAt: new Date() } });
      });
    } catch (e) {
      if (e instanceof InviteClosed) return { ok: false, error: CLOSED };
      throw e;
    }
    await copyPushTo(account.id, row.id);
    return { ok: true, groupId: inv.groupId, memberId: row.id };
  } else {
    // Removed by the admin, then deleted their account and signed up again: only an invitation the admin sent AFTER the removal lets them in,
    // and accepting it clears the group's scrambled note of their email (removal-marks.ts).
    const mark = await removedByEmail(inv.groupId, account.email);
    if (mark && (inv.createdAt.getTime() < mark.at.getTime() || !(await isGroupAdmin(inv.groupId, inv.invitedById)))) {
      const by = mark.by ? (await db.member.findFirst({ where: { id: mark.by, groupId: inv.groupId }, select: { name: true } }))?.name : "";
      return { ok: false, error: `${by || "The person who looks after the group"} removed you from this group. Ask them to invite you again.` };
    }
    // Link their name row if it is still free; if someone else took that name meanwhile, join as themselves (a new row, with their own name).
    const skipRemovalMark = Boolean(mark);
    r = await joinExisting(code, account, memberId, { skipRemovalMark });
    if (!r.ok && r.reason === "claimed") r = await joinNew(code, account, account.name, { skipRemovalMark });
    if (r.ok && mark) await clearRemovalMark(inv.groupId, account.email);
  }
  if (!r.ok) {
    return { ok: false, error: r.reason === "name" ? NAME_NEEDED : r.reason === "removed" ? `${r.adminName || "The person who looks after the group"} removed you from this group. Ask them to invite you again.` : GONE };
  }
  await db.$transaction([
    db.invite.updateMany({ where: { groupId: inv.groupId, email: account.email, acceptedAt: null }, data: { acceptedAt: new Date() } }),
    db.member.updateMany({ where: { id: r.memberId, seenAt: null }, data: { seenAt: new Date() } }),
  ]);
  await copyPushTo(account.id, r.memberId);
  return { ok: true, groupId: inv.groupId, memberId: r.memberId };
}

// Not now. The name stays in the group exactly as it is (its expenses and payments, and every balance);
// the invitation card goes away. For someone who left or was removed, the row stays left / removed and keeps its account:
// only the invitation is closed (a row with history is never unlinked, so nobody else can claim it). They can still join later from the group's invite link or a new invitation.
export async function declineInvitation(account: Account, key: string): Promise<Answer> {
  if (key.startsWith("m:")) {
    const m = await db.member.findFirst({ where: { id: key.slice(2), accountId: account.id, addedBy: { not: "" }, seenAt: null, leftAt: null, removedAt: null, group: { deletedAt: null } } });
    if (!m) return { ok: false, error: GONE };
    // Same as the live app: the account is taken off the row, which stays as a plain name (used or not): expenses, payments and
    // balances don't move. (People who left or were removed never get an "m:" card: they are invited back with a real invitation.)
    await db.$transaction([
      db.member.updateMany({ where: { id: m.id, accountId: account.id, seenAt: null, leftAt: null, removedAt: null }, data: { accountId: null, claimedAt: null, addedBy: "" } }),
      db.pushSubscription.deleteMany({ where: { memberId: m.id } }),
    ]);
    return { ok: true, groupId: m.groupId, memberId: m.id };
  }
  const inv = key ? await db.invite.findFirst({ where: { token: key, email: account.email } }) : null;
  if (!inv) return { ok: false, error: GONE };
  // Only closes the invitation (and only if it is still open): the member row is not touched.
  await db.invite.updateMany({ where: { id: inv.id, acceptedAt: null }, data: { declinedAt: new Date() } });
  return { ok: true, groupId: inv.groupId, memberId: inviteMemberId(inv) };
}

