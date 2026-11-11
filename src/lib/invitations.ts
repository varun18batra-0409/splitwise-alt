import { db } from "./db";
import { copyPushTo, inviteMemberId } from "./invites";
import { joinExisting, joinNew, type JoinFail, type JoinOk } from "./join";

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
  for (const i of invites) {
    const g = i.group;
    const own = g.members.find((m) => m.accountId === account.id);
    // Already in, or taken out of, that group: nothing to answer. (Someone who left on their own and was invited to their own row does have something to answer.)
    if (own && !(own.leftAt && !own.removedAt && own.id === inviteMemberId(i))) continue;
    const memberId = g.members.find((m) => m.id === inviteMemberId(i) && !m.removedAt && (own ? m.id === own.id : !m.accountId && !m.leftAt))?.id ?? "";
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

export type Answer = { ok: true; groupId: string; memberId: string } | { ok: false; error: string };
const GONE = "This invitation is no longer there.";
const CLOSED = "This invitation is no longer open.";

// Join. `key` is the token, or "m:<memberId>" for the older kind.
export async function acceptInvitation(account: Account, key: string): Promise<Answer> {
  if (key.startsWith("m:")) {
    const m = await db.member.findFirst({ where: { id: key.slice(2), accountId: account.id, addedBy: { not: "" }, seenAt: null, removedAt: null, group: { deletedAt: null } } });
    if (!m) return { ok: false, error: GONE };
    await db.member.updateMany({ where: { id: m.id, seenAt: null }, data: { seenAt: new Date(), leftAt: null } });
    return { ok: true, groupId: m.groupId, memberId: m.id };
  }
  const inv = key ? await db.invite.findFirst({ where: { token: key, email: account.email }, include: { group: { select: { id: true, inviteCode: true, deletedAt: true } } } }) : null;
  if (!inv || inv.group.deletedAt) return { ok: false, error: GONE };
  // Closed on purpose (Not now, cancelled by the person who sent it, or replaced by an invitation to another address).
  if (inv.declinedAt && !inv.acceptedAt) return { ok: false, error: CLOSED };
  const code = inv.group.inviteCode;
  const memberId = inviteMemberId(inv);
  // The invitation is for one row. If that row is gone (undone) or was removed, there is nothing to join: no joining as someone new instead.
  // The invitation itself is left as it is, so if the row comes back (Redo) the card comes back with it.
  const row = memberId ? await db.member.findFirst({ where: { id: memberId, groupId: inv.groupId } }) : null;
  if (!row || (row.removedAt && row.accountId !== account.id)) return { ok: false, error: CLOSED };
  let r: JoinOk | JoinFail;
  if (row.accountId === account.id) {
    // Left on their own and invited back to their own row: joining brings them back (joinNew also refuses a removed person).
    r = await joinNew(code, account, account.name);
  } else {
    // Link their name row if it is still free; if someone else took that name meanwhile, join as themselves (a new row, with their own name).
    r = await joinExisting(code, account, memberId);
    if (!r.ok && r.reason === "claimed") r = await joinNew(code, account, account.name);
  }
  if (!r.ok) {
    return { ok: false, error: r.reason === "removed" ? `${r.adminName || "The person who looks after the group"} removed you from this group. Ask them to invite you again.` : GONE };
  }
  await db.$transaction([
    db.invite.updateMany({ where: { groupId: inv.groupId, email: account.email, acceptedAt: null }, data: { acceptedAt: new Date() } }),
    db.member.updateMany({ where: { id: r.memberId, seenAt: null }, data: { seenAt: new Date() } }),
  ]);
  await copyPushTo(account.id, r.memberId);
  return { ok: true, groupId: inv.groupId, memberId: r.memberId };
}

// Not now. The name stays in the group exactly as it is (its expenses and payments, and every balance);
// the invitation card goes away. They can still join later from the group's invite link or a new invitation.
export async function declineInvitation(account: Account, key: string): Promise<Answer> {
  if (key.startsWith("m:")) {
    const m = await db.member.findFirst({ where: { id: key.slice(2), accountId: account.id, addedBy: { not: "" }, seenAt: null, removedAt: null, group: { deletedAt: null } } });
    if (!m) return { ok: false, error: GONE };
    // Taken off the row, which stays as a plain name (used or not): expenses, payments and balances don't move.
    await db.$transaction([
      db.member.updateMany({ where: { id: m.id, accountId: account.id, seenAt: null }, data: { accountId: null, claimedAt: null, addedBy: "" } }),
      db.pushSubscription.deleteMany({ where: { memberId: m.id } }),
    ]);
    return { ok: true, groupId: m.groupId, memberId: m.id };
  }
  const inv = key ? await db.invite.findFirst({ where: { token: key, email: account.email } }) : null;
  if (!inv) return { ok: false, error: GONE };
  await db.invite.update({ where: { id: inv.id }, data: { declinedAt: new Date() } });
  return { ok: true, groupId: inv.groupId, memberId: inviteMemberId(inv) };
}

