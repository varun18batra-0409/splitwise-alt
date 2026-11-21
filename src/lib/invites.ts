import { db } from "./db";
import { JOINED } from "./membership";
import { logEvent } from "./events";
import { cleanEmail } from "./auth";
import { sendMail } from "./mail";
import { mailSafe } from "./mail-safe";
import { allow } from "./rate-limit";
import { deliverNotes } from "./account-notes";
import { blockedEitherWay, isBlockedEitherWay } from "./blocks";
import { getAccount } from "./identity";
import { groupAdminId } from "./group-admin";
import { randomBytes } from "node:crypto";
import { validSub } from "./push-subs";
import { claimJob, finishJob } from "./push";
import { DIRECT, NOT_DIRECT } from "./direct";
import { madeBeforeFreed } from "./guest-words";

// Invite and "added you" emails one person can send in a day. The whole app's
// daily email allowance is small, so one person (or a spammer) can't use it up.
export const INVITE_EMAILS_PER_DAY = 20;
export const inviteMailOk = (actor: { id: string; accountId?: string | null }) => allow(`invite-mail:${actor.accountId || actor.id}`, INVITE_EMAILS_PER_DAY, 86_400);

// Adding people to a group. Someone added by email (or found by name on Loopin) is in the group at
// once as a name, so they can be split with, and is invited: they see the group on their own
// phone only after they verify their email and tap Join.

// `removed`: the admin took this person out of the group. Only the admin may bring them back, so for
// everyone else the screen shows "Removed" and no Add (`mayAdd` false).
export type Found = { accountId: string; name: string; inGroup: boolean; known: boolean; invited: boolean; removed: boolean; left: boolean; mayAdd: boolean };

// What the invite screen shows for an invitation that has no name row of its own: the typed email only to the
// person who invited; everyone else just sees who invited.
// `viewerFreedAt`: an invitation sent at or before the viewer's name was last freed was sent by the earlier holder, so its address is not shown to them.
export function inviteRowLabel(invite: { email: string; invitedById: string; fromAccount?: boolean; createdAt?: Date | null }, viewerId: string, inviterName: string, viewerFreedAt?: Date | null): string {
  const mine = invite.invitedById === viewerId && !madeBeforeFreed(viewerFreedAt, invite.createdAt);
  if (invite.fromAccount) return mine ? "Invited on Loopin" : `Invited by ${inviterName}`; // picked from an account: no email is ever shown
  return mine ? invite.email : `Invited by ${inviterName}`;
}

// This person's row in a group (not a pair, not deleted) that the actor's account is also really in: the people the search is allowed to show.
// The one question behind both "what name did the search show" and "may this person be added by account at all".
async function sharedGroupRow(targetAccountId: string, actorAccountId: string | null | undefined): Promise<{ name: string } | null> {
  if (!actorAccountId || !targetAccountId) return null;
  return db.member.findFirst({
    where: { accountId: targetAccountId, ...JOINED, group: { ...NOT_DIRECT, deletedAt: null, members: { some: { accountId: actorAccountId, ...JOINED } } } },
    select: { name: true },
    orderBy: { createdAt: "asc" },
  });
}

// Do these two accounts share a group (neither a pair, not deleted, both really joined)? Anyone else can't be found by search, so can't be added by account.
export async function sharesGroupWith(targetAccountId: string, actorAccountId: string | null | undefined): Promise<boolean> {
  return Boolean(await sharedGroupRow(targetAccountId, actorAccountId));
}

// The name the search showed for this person: their own name, else their name in a group the two of you share.
// Never anything made from their email (adding someone from search must not leak the start of it).
export async function shownNameFor(account: { id: string; name: string }, actorAccountId: string | null | undefined): Promise<string> {
  const own = account.name.trim();
  if (own) return own;
  const row = await sharedGroupRow(account.id, actorAccountId);
  if (row?.name.trim()) return row.name.trim();
  return "Someone";
}

// What the People screen says about a name that has an invitation waiting. `invites` are the open invitations for that name, newest first.
// Someone picked from their Loopin account (`fromAccount`) never has their email shown to anyone: the person who picked them never typed it,
// and showing it would hand over the private address of anyone they share a group with. A typed address is shown, as before, to whoever may
// cancel the invitation (the admin and the person who sent it). Pure, so it can be tested without the screen.
export const INVITED_ON_LOOPIN = "Invited on Loopin. Cancel the invitation if it’s the wrong person.";
// An invitation sent by an earlier holder of a name that was freed since: only the person who looks after the group can change it. `name` is the invited name.
export const earlierHolderInviteText = (name: string) => `${name} is already invited. Only the person who looks after the group can change that.`;

// `orphanedName`: the invited name, when the invitation was sent by an earlier holder of a name that was freed since: whoever cannot cancel it reads the plain sentence (no sender is named).
export function waitingNote(o: { invites: { fromAccount: boolean; email: string }[]; by: string; mayCancel: boolean; mayInvite: boolean; orphanedName?: string }): string {
  const fromAccount = o.invites.some((i) => i.fromAccount);
  if (o.mayCancel && fromAccount) return INVITED_ON_LOOPIN;
  if (o.mayCancel) {
    return `Invited at ${o.invites[0]?.email ?? ""}. Wrong address, or they sign in with another one? Cancel the invitation${o.mayInvite ? ", or invite a different email below" : ""}.`;
  }
  if (o.orphanedName) return earlierHolderInviteText(o.orphanedName);
  return `Invited by ${o.by}. They can change it if the address is wrong.`;
}

// A name that isn't taken in the group yet ("Joey", then "Joey 2"…).
export function freeName(taken: string[], wanted: string): string {
  const base = wanted.trim().replace(/\s+/g, " ").slice(0, 36) || "Friend";
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  return `${base} ${Date.now() % 1000}`;
}

// Search for people on Loopin. For privacy it matches NAMES only (never an email, so typing "gmail"
// finds nobody) and returns no email address. Only people you already share a group with are listed;
// anyone else is added by typing their full email, which the screen offers as a plain "Add".
export async function searchPeople(memberships: Record<string, string>, groupId: string, rawQuery: string): Promise<Found[]> {
  const q = rawQuery.trim().toLowerCase().slice(0, 80);
  if (q.length < 2) return [];
  // Everything at once (each is a trip to the database).
  const [groupRows, knownRows, me, adminId] = await Promise.all([
    // Everyone with an account in this group, including people who left or were removed (a removed person is never offered an Add).
    db.member.findMany({ where: { groupId, accountId: { not: null } }, select: { accountId: true, leftAt: true, removedAt: true } }),
    // People you share a group with, both really joined (someone added straight in who hasn't opened it isn't offered yet).
    db.member.findMany({
      where: { groupId: { in: Object.keys(memberships) }, accountId: { not: null }, ...JOINED, group: { ...NOT_DIRECT, deletedAt: null, members: { some: { id: { in: Object.values(memberships) }, ...JOINED } } } },
      // Their name in a group we share, used when they haven't set a name of their own (never the start of their email).
      select: { accountId: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    db.member.findUnique({ where: { id: memberships[groupId] ?? "" }, select: { accountId: true } }),
    groupAdminId(groupId),
  ]);
  const inGroup = new Set(groupRows.filter((m) => !m.leftAt && !m.removedAt).map((m) => m.accountId!));
  const removedIn = new Set(groupRows.filter((m) => m.removedAt).map((m) => m.accountId!));
  const leftIn = new Set(groupRows.filter((m) => m.leftAt && !m.removedAt).map((m) => m.accountId!));
  const iAmAdmin = Boolean(adminId) && adminId === memberships[groupId];
  const groupName = new Map<string, string>();
  for (const r of knownRows) if (r.accountId && !groupName.has(r.accountId)) groupName.set(r.accountId, r.name);
  const known = await db.account.findMany({ where: { id: { in: [...groupName.keys()] } } });
  const shownName = (a: { id: string; name: string }) => a.name.trim() || groupName.get(a.id) || "Someone";
  // Blocking works both ways: nobody with a block between them and the searcher is found.
  // The searcher is the account in the session as well as the one on their row in this group, so a person is never shown to someone who blocked them.
  const sessionAccountId = (await getAccount().catch(() => null))?.id;
  const blockedWithMe = new Set<string>();
  for (const id of new Set([me?.accountId, sessionAccountId])) if (id) for (const b of await blockedEitherWay(id)) blockedWithMe.add(b);
  const shown = known.filter((a) => shownName(a).toLowerCase().includes(q) && !blockedWithMe.has(a.id));
  // Already invited to this group and not joined yet: shown as "Invited".
  const waiting = shown.length ? await db.invite.findMany({ where: { groupId, acceptedAt: null, declinedAt: null, email: { in: shown.map((a) => a.email) } }, select: { email: true } }) : [];
  const invitedEmails = new Set(waiting.map((i) => i.email));
  const out: Found[] = shown.map((a) => ({ accountId: a.id, name: shownName(a), inGroup: inGroup.has(a.id), known: true, invited: invitedEmails.has(a.email), removed: removedIn.has(a.id), left: leftIn.has(a.id), mayAdd: !removedIn.has(a.id) || iAmAdmin }));
  // A full email of someone you share nothing with is not looked up here: the screen offers the same
  // "Add" for any email (on Loopin → added; not yet → invited), so nobody can check who has an account.
  // Don't offer the person searching (they're already in the group).
  return out.filter((f) => f.accountId !== me?.accountId).slice(0, 8);
}

// People on Loopin you share an open group with (both really joined, neither left or removed), not blocked either way:
// the only people "With a person" offers besides your existing pairs. Their name is their own, else their name in a group you share
// (never anything made from an email). Pairs themselves never count as sharing a group.
export async function knownPeople(accountId: string): Promise<{ accountId: string; name: string }[]> {
  const mine = await db.member.findMany({
    where: { accountId, ...JOINED, leftAt: null, removedAt: null, group: { ...NOT_DIRECT, deletedAt: null, closed: false } },
    select: { groupId: true },
  });
  if (!mine.length) return [];
  const others = await db.member.findMany({
    where: { groupId: { in: mine.map((m) => m.groupId) }, accountId: { not: null }, ...JOINED, leftAt: null, removedAt: null },
    select: { accountId: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  const groupName = new Map<string, string>();
  for (const r of others) if (r.accountId && r.accountId !== accountId && !groupName.has(r.accountId)) groupName.set(r.accountId, r.name);
  if (!groupName.size) return [];
  const [accounts, blocked] = await Promise.all([db.account.findMany({ where: { id: { in: [...groupName.keys()] } }, select: { id: true, name: true } }), blockedEitherWay(accountId)]);
  return accounts
    .filter((a) => !blocked.has(a.id))
    .map((a) => ({ accountId: a.id, name: a.name.trim() || groupName.get(a.id)?.trim() || "Someone" }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

// Give a new member the phone notifications this person already turned on elsewhere.
export async function copyPushTo(accountId: string, memberId: string) {
  const others = await db.member.findMany({ where: { accountId, id: { not: memberId } }, select: { id: true } });
  const subs = await db.pushSubscription.findMany({ where: { memberId: { in: others.map((m) => m.id) } } });
  for (const s of subs) {
    if (!validSub({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } })) continue; // never copy an address we wouldn't have accepted
    await db.pushSubscription.upsert({
      where: { memberId_endpoint: { memberId, endpoint: s.endpoint } },
      create: { memberId, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
      update: {},
    });
  }
}

type Result = { ok: true; memberId: string; eventId: string; name: string; email: string; invitedBack?: boolean } | { ok: false; error: string };

// ---- Invitations ----
//
// Adding someone by email puts them in the group AT ONCE as a name only (so they can be split with
// straight away, exactly like a friend added by name), and invites them: an Invite row with its own
// token, an email, and (if the email belongs to an account) a note in their Alerts and a phone push.
// They only see the group once they tap Join (see invitations.ts).
//
// The adder gets the same reply whether or not the email is on Loopin, so nobody can use this to
// find out who has an account. The token is random; the name row it is for is the invitation's own memberId.

export const newInviteToken = () => randomBytes(18).toString("base64url");
// Older tokens (only ever made in tests) started with the name row's id: "<memberId>.<random>".
export const memberOfToken = (token: string) => (token.includes(".") ? token.split(".")[0] : "");
// The name row an invitation is for.
export const inviteMemberId = (inv: { memberId: string; token: string }) => inv.memberId || memberOfToken(inv.token);

// "ravi.kumar@gmail.com" → "Ravi Kumar" (the same for everyone, so it says nothing about whether they have an account).
// Parts that are only digits are dropped ("zoe-1794422699068@x" → "Zoe"); "ravi.kumar88" keeps its 88.
export function nameFromEmail(email: string): string {
  const words = email.split("@")[0].replace(/[._+\-]+/g, " ").trim().split(/\s+/).filter((w) => w && !/^\d+$/.test(w));
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ").slice(0, 36) || "Friend";
}

type InviteGroup = { id: string; name: string; inviteCode: string; joinWeight: number; members: { id: string; name: string; accountId: string | null; leftAt: Date | null; removedAt?: Date | null }[] };
type Actor = { id: string; name: string; accountId?: string | null };
type Later = (job: () => Promise<unknown>) => void;

// One person: the name row, the Invite, the email (and the note for someone on Loopin). Sent after the reply when `later` is given.
async function inviteOne(
  group: InviteGroup,
  actor: Actor,
  email: string,
  wantedName: string,
  // `fromAccount`: the person was picked from their Loopin account, not typed in by email (so their email is never shown on People).
  o: { origin: string; account: { id: string } | null; mail: boolean; later?: Later; row?: { id: string; name: string }; noAlert?: boolean; fromAccount?: boolean },
): Promise<{ memberId: string; eventId: string; name: string } | { error: string }> {
  const prior = await db.invite.findUnique({ where: { groupId_email: { groupId: group.id, email } } });
  const priorOpen = Boolean(prior && !prior.acceptedAt && !prior.declinedAt);
  // This email is already invited as another name here: moving it would quietly free that name. Cancel that one first.
  if (prior && priorOpen && o.row) {
    const holds = group.members.find((m) => m.id === inviteMemberId(prior) && m.id !== o.row!.id && !m.accountId && !m.leftAt && !m.removedAt);
    if (holds) return { error: alreadyInvitedAs(holds.name) };
  }
  // Asked again before they joined: the same name row, a fresh invitation.
  // `row`: someone who left on their own and is added again by email. The invitation is for their own row; Join brings them back.
  const kept = o.row ?? (prior && !prior.acceptedAt && prior.token ? group.members.find((m) => m.id === inviteMemberId(prior) && !m.accountId && !m.leftAt && !m.removedAt) : undefined);
  const name = kept ? kept.name : freeName(group.members.map((m) => m.name), wantedName);
  // While an invitation is open it stays with whoever sent it first, except that the person who looks after the group takes it over
  // (a removed person who signed up again only gets back in through an invitation the admin sent).
  const actorIsAdmin = await isAdmin(group.id, actor.id);
  const adminTakesOver = Boolean(prior && priorOpen && prior.invitedById !== actor.id && actorIsAdmin);
  const { memberId, eventId } = await db.$transaction(async (tx) => {
    let memberId = kept?.id ?? "";
    let eventId = "";
    if (!kept) {
      const m = await tx.member.create({ data: { name, groupId: group.id, splitWeight: group.joinWeight } });
      memberId = m.id;
      eventId = await logEvent(tx, { groupId: group.id, actorId: actor.id, kind: "members_added", text: `added ${name} to the group`, undo: { type: "members_remove", memberIds: [m.id] } });
    }
    const token = kept && prior?.token && inviteMemberId(prior) === kept.id ? prior.token : newInviteToken();
    // "Orphaned": the sender's name was freed at or after the invitation was sent, so it was sent by an EARLIER holder of that name. Read here, inside
    // the write, from the rows as they are now. Only the person who looks after the group may take it over (the usual admin takeover); anyone else
    // re-sending (the new holder included) leaves the owner AND the time alone, so it cannot become theirs. A re-send that moves it to a brand-new
    // name row is a new invitation by the re-sender.
    const cur = await tx.invite.findUnique({ where: { groupId_email: { groupId: group.id, email } } });
    const curOpen = Boolean(cur && !cur.acceptedAt && !cur.declinedAt);
    const curSender = curOpen ? await tx.member.findUnique({ where: { id: cur!.invitedById }, select: { freedAt: true } }) : null;
    const orphan = Boolean(curOpen && madeBeforeFreed(curSender?.freedAt, cur!.createdAt));
    const hold = Boolean(kept) && orphan && !actorIsAdmin;
    await tx.invite.upsert({
      where: { groupId_email: { groupId: group.id, email } },
      create: { groupId: group.id, email, invitedById: actor.id, token, memberId, fromAccount: Boolean(o.fromAccount) },
      // While an invitation is open it stays with whoever sent it first; a new one (after it was closed) belongs to the new sender.
      // Once it is marked "from an account" it stays so while open: a typed re-invite must not show the address to the first sender, who never typed it.
      update: { invitedById: hold ? cur!.invitedById : prior && priorOpen && !adminTakesOver && !orphan ? prior.invitedById : actor.id, acceptedAt: null, declinedAt: null, createdAt: hold ? cur!.createdAt : new Date(), token, memberId, fromAccount: Boolean(o.fromAccount) || Boolean(prior && priorOpen && prior.fromAccount) },
    });
    return { memberId, eventId };
  });

  const link = `${o.origin}/join/${group.inviteCode}?${new URLSearchParams({ e: email, as: memberId })}`;
  const job = async () => {
    // They are in the group (the money has to work), but if there is a block between this person and the inviter (either way), nothing reaches them:
    // no email, no alert, no push. (If the lookup fails, nothing does either.) The email still goes through every check and
    // counter, without being sent, so from the outside it looks exactly like a real invite.
    const blocked = Boolean(o.account && actor.accountId && (await isBlockedEitherWay(o.account.id, actor.accountId).catch(() => true)));
    if (o.mail) {
      // The subject is fixed and names are cleaned of links and addresses (see mailSafe): chosen text can't dress up an email from Loopin.
      const by = mailSafe(actor.name, "Someone");
      const gname = mailSafe(group.name, "a group");
      await sendMail(
        email,
        "You've been added to a group on Loopin",
        `${by} added you to “${gname}” on Loopin.\n\nJoin here: ${link}`,
        `<div style="font-family:system-ui,sans-serif;max-width:440px"><p style="font-size:16px"><strong>${esc(by)}</strong> added you to <strong>${esc(gname)}</strong> on Loopin.</p><p><a href="${link}" style="display:inline-block;background:#0d0d0f;color:#f4f2ec;padding:12px 18px;text-decoration:none;font-weight:600">Join ${esc(gname)}</a></p></div>`,
        { optOut: true, item: "groups.added", suppress: blocked },
      );
    }
    if (blocked) return;
    if (o.account && !o.noAlert) {
      await deliverNotes([{ accountIds: [o.account.id], kind: "group_invite", title: `${actor.name} added you to ${group.name}`, body: "Tap to join, or choose Not now.", url: `/groups/${group.id}`, tag: `invite-${group.id}`, fromAccountId: actor.accountId ?? undefined }]);
    }
  };
  if (o.later) o.later(job);
  else await job();
  return { memberId, eventId, name };
}

async function loadInviteGroup(groupId: string, actorId: string) {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true, name: true, accountId: true, leftAt: true, removedAt: true } } } });
  const actor = group?.members.find((m) => m.id === actorId);
  return { group, actor };
}

// Nobody is added to, or invited into, a pair of two people.
export const PAIR_NO_INVITE = "This is just between two people, so nobody else can be added.";
export const alreadyInvitedAs = (name: string) => `That email is already invited as ${name}. Cancel that first.`;
const isAdmin = async (groupId: string, memberId: string) => (await groupAdminId(groupId)) === memberId;
// Someone WITH AN ACCOUNT who left on their own, or whom the admin removed, is never put back by somebody else: they are sent an
// ordinary invitation for their own row, and the row stays left / removed (history, balance and ownership untouched) until THEY accept
// (invitations.ts clears leftAt / removedAt then). Only the admin may invite back a removed person. Reads the row again right before
// writing, so a person who has rejoined (or been removed) in the meantime is handled, not overwritten. No money changes.
type BackResult = { ok: true; eventId: string } | { ok: false; error: string; inGroup?: boolean };
async function inviteBackTo(
  group: InviteGroup,
  actor: Actor,
  account: { id: string; email: string },
  row: { id: string; name: string },
  o: { origin: string; mail: boolean; later?: Later; spamGuard?: boolean },
): Promise<BackResult> {
  const now = await db.member.findFirst({
    where: { id: row.id, groupId: group.id, accountId: account.id, OR: [{ leftAt: { not: null } }, { removedAt: { not: null } }] },
    select: { removedAt: true },
  });
  if (!now) return { ok: false, error: `${row.name} is already in this group.`, inGroup: true };
  if (now.removedAt) {
    if (!(await isAdmin(group.id, actor.id))) return { ok: false, error: `Only the person who looks after the group can bring ${row.name} back.` };
    // An older open invitation to this address (sent before they were removed) must not carry on: the new one belongs to the admin.
    await db.invite.updateMany({ where: { groupId: group.id, email: account.email, acceptedAt: null, declinedAt: null }, data: { declinedAt: new Date() } });
  }
  // Tapping "Invite back" again and again must not buzz their phone or fill their inbox: while an invitation for this row is already
  // open, no new alert, push or email goes out (the invitation itself is still there). (A "Not now" can't be told apart from a
  // cancelled or replaced invitation, so it is not used here; the daily rate limit covers the rest.)
  let noAlert = false;
  if (o.spamGuard) {
    const prior = await db.invite.findUnique({ where: { groupId_email: { groupId: group.id, email: account.email } } });
    noAlert = Boolean(prior && !prior.acceptedAt && !prior.declinedAt && inviteMemberId(prior) === row.id);
  }
  const r = await inviteOne(group, actor, account.email, row.name, { origin: o.origin, account, mail: o.mail && !noAlert, later: o.later, row, noAlert, fromAccount: true });
  if ("error" in r) return { ok: false, error: r.error };
  const eventId = await logEvent(db, { groupId: group.id, actorId: actor.id, kind: "member_invited", text: `invited ${row.name} back to the group` });
  return { ok: true, eventId };
}

// Add someone who's already on Loopin (found by name among people you share a group with).
// They're in the group at once as a name and invited, like an email add.
// `later`: send the email and note after the reply (so adding is instant).
export async function addRegistered(groupId: string, actorId: string, accountId: string, origin: string, opts: { later?: Later } = {}): Promise<Result> {
  const { group, actor } = await loadInviteGroup(groupId, actorId);
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (group.type === DIRECT) return { ok: false, error: PAIR_NO_INVITE };
  if (!actor || actor.leftAt) return { ok: false, error: "Only people in this group can add others." };
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, error: "That person isn't on Loopin." };
  const existing = group.members.find((m) => m.accountId === accountId);
  const blocked = Boolean(actor.accountId && (await isBlockedEitherWay(actor.accountId, accountId)));
  // Only people the actor could have found in search: someone who already has a row in THIS group (inviting a person who left back), or someone
  // who shares another group with the actor. Anyone else gets the same reply as an account that doesn't exist, and nothing is written.
  // A block either way gives a new person the same reply (never says why), and nothing is written.
  // (Before this, any account id from the form was accepted, and the People screen then showed that person's private email to the adder.)
  if (!existing && (blocked || !(await sharesGroupWith(accountId, actor.accountId)))) return { ok: false, error: "That person isn't on Loopin." };
  if (existing && !existing.leftAt && !existing.removedAt) return { ok: false, error: `${existing.name} is already in this group.` };
  if (existing) {
    // Left on their own, or removed by the person who looks after the group: an invitation to their own row (only the admin may
    // invite back a removed person). They are back only when they accept.
    if (existing.removedAt && !(await isAdmin(groupId, actorId))) return { ok: false, error: `Only the person who looks after the group can bring ${existing.name} back.` };
    const mail = await inviteMailOk(actor);
    // A block either way: exactly the reply an invite back gets, and nothing is written (no invitation, no alert, no email).
    if (blocked) return { ok: true, memberId: existing.id, eventId: "", name: existing.name, email: account.email, invitedBack: true };
    const back = await inviteBackTo(group, actor, account, existing, { origin, mail, later: opts.later, spamGuard: true });
    if (!back.ok) return back;
    return { ok: true, memberId: existing.id, eventId: "", name: existing.name, email: account.email, invitedBack: true };
  }
  const mail = await inviteMailOk(actor);
  const actorAccountId = (await db.member.findUnique({ where: { id: actorId }, select: { accountId: true } }))?.accountId;
  const r = await inviteOne(group, actor, account.email, await shownNameFor(account, actorAccountId), { origin, account, mail, later: opts.later, fromAccount: true });
  if ("error" in r) return { ok: false, error: r.error };
  return { ok: true, ...r, email: account.email };
}

// Invite people by email. Everyone typed (valid) gets the same reply: they're in the group as a name
// and an invitation went out. Only a badly typed address is an error. Someone who is already in the
// group, or yourself, gets the same reply and nothing is sent.
export async function inviteByEmail(groupId: string, actorId: string, rawEmails: string, origin: string, opts: { later?: Later } = {}) {
  const { group, actor } = await loadInviteGroup(groupId, actorId);
  const people: { name: string; email: string }[] = [];
  const bad: string[] = [];
  if (!group || group.deletedAt || !actor || actor.leftAt) return { people, bad };
  if (group.type === DIRECT) {
    bad.push(PAIR_NO_INVITE);
    return { people, bad };
  }
  const parts = [...new Set(rawEmails.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))].slice(0, 20);
  for (const p of parts) {
    const email = cleanEmail(p);
    if (!email) {
      bad.push(p);
      continue;
    }
    // Charged for every address, so the allowance says nothing about who is on Loopin.
    const mail = await inviteMailOk(actor);
    if (!mail) {
      bad.push(`${email} (you've sent ${INVITE_EMAILS_PER_DAY} invite emails today; share the invite link instead)`);
      continue;
    }
    const wanted = nameFromEmail(email);
    const account = await db.account.findUnique({ where: { email } });
    // Already in the group (or removed from it), or you: the same reply, nothing sent.
    const already = account ? group.members.find((m) => m.accountId === account.id) : undefined;
    if (account && already) {
      // A block either way: the same quiet reply, and nothing is written (no invitation back, no alert).
      if (actor?.accountId && (await isBlockedEitherWay(actor.accountId, account.id))) {
        people.push({ name: wanted, email });
        continue;
      }
      // The same quiet reply for everyone. Only the person who looks after the group can bring back someone they removed.
      if (already.removedAt || already.leftAt) {
        // Left on their own, or removed (admin only): invited to their own row. They are not back until they accept.
        if (already.removedAt && !(await isAdmin(groupId, actorId))) {
          people.push({ name: wanted, email });
          continue;
        }
        const again = await inviteBackTo(group, actor, account, already, { origin, mail, later: opts.later });
        if (!again.ok && !again.inGroup) {
          bad.push(`${email} (${again.error})`);
          continue;
        }
      }
      people.push({ name: wanted, email });
      continue;
    }
    // A name clash (or any failure) is an error for this address only; the others carry on.
    const r = await inviteOne(group, actor, email, wanted, { origin, account, mail, later: opts.later }).catch(() => ({ error: "Couldn’t add this one. Try again." }));
    if ("error" in r) {
      bad.push(`${email} (${r.error})`);
      continue;
    }
    // The new name is now taken in this group, so the next address with the same inferred name becomes "Same 2".
    group.members.push({ id: r.memberId, name: r.name, accountId: null, leftAt: null, removedAt: null });
    people.push({ name: r.name, email });
  }
  // No Undo bar for any email invite, so the reply looks the same whoever the email belongs to.
  return { people, bad };
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// Invitations still waiting for this name row (older tokens carried the row id before a dot).
export async function openInvitesFor(groupId: string, memberId: string) {
  return db.invite.findMany({
    where: { groupId, acceptedAt: null, declinedAt: null, OR: [{ memberId }, { token: { startsWith: `${memberId}.` } }] },
    select: { id: true, email: true, invitedById: true, createdAt: true },
  });
}

// An invitation is "mine" only if I sent it AFTER my name was last freed: one sent to or before that moment was sent by the earlier holder of the name.
export const sentByMe = (i: { invitedById: string; createdAt?: Date | null }, actorId: string, freedAt?: Date | null) => i.invitedById === actorId && !madeBeforeFreed(freedAt, i.createdAt);

export const CANCEL_NOT_ALLOWED = "Only the person who looks after the group, or the person who sent the invitation, can cancel it.";

// "Cancel invitation": for a name whose invitation went to the wrong address (or the person signs in with another one).
// Closes the open invitations for the name (all of them for the admin, only their own for the person who sent them); it goes back to being a plain name that "That's me" can take.
// Only the person who looks after the group or whoever sent the invitation may do it. Nothing about balances changes.
export async function cancelInvitation(groupId: string, actorId: string, memberId: string): Promise<{ ok: true; cancelled: number } | { ok: false; error: string }> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true, name: true, leftAt: true, removedAt: true, freedAt: true } } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  const actor = group.members.find((m) => m.id === actorId);
  if (!actor || actor.leftAt) return { ok: false, error: "Only people in this group can do this." };
  const member = group.members.find((m) => m.id === memberId);
  if (!member) return { ok: false, error: "That name isn't in this group." };
  const open = await openInvitesFor(groupId, memberId);
  if (!open.length) return { ok: false, error: "There is no open invitation for that name." };
  // The admin cancels every open invitation for the name; anyone else only the ones they sent.
  const admin = await isAdmin(groupId, actorId);
  const mine = admin ? open : open.filter((i) => sentByMe(i, actorId, actor.freedAt));
  if (!mine.length) return { ok: false, error: CANCEL_NOT_ALLOWED };
  const r = await db.invite.updateMany({ where: { id: { in: mine.map((i) => i.id) }, acceptedAt: null, declinedAt: null }, data: { declinedAt: new Date() } });
  await logEvent(db, { groupId, actorId, kind: "member_invited", text: `cancelled the invitation for ${member.name}` });
  return { ok: true, cancelled: r.count };
}

// "Invite by email" for someone added by name only (before email sign-up):
// the link opens the group's join page on "Continue as <name>", so their
// expenses and balance stay theirs.
export async function inviteToClaim(groupId: string, actorId: string, memberId: string, rawEmail: string, origin: string, opts: { later?: Later } = {}): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const email = cleanEmail(rawEmail);
  if (!email) return { ok: false, error: "Enter an email address, like name@gmail.com." };
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
  const actor = group?.members.find((m) => m.id === actorId && !m.leftAt);
  const member = group?.members.find((m) => m.id === memberId && !m.leftAt && !m.removedAt);
  if (!group || group.deletedAt || !actor) return { ok: false, error: "Only people in this group can invite." };
  if (group.type === DIRECT) return { ok: false, error: PAIR_NO_INVITE };
  if (!member || member.accountId || member.claimedAt) return { ok: false, error: "That person is already on Loopin." };
  // A name that already has an open invitation can be changed by the admin or by the person who sent it (the same people who can
  // cancel it), not by any member: otherwise anyone could point it at their own address and take the name over.
  const open = await openInvitesFor(groupId, memberId);
  const admin = await isAdmin(groupId, actorId);
  if (open.length && !admin && !open.every((i) => sentByMe(i, actorId, actor.freedAt))) {
    // The first invitation the person cannot change: if it was sent by an earlier holder of a name that was freed since, no sender is named.
    const blocking = open.find((i) => !sentByMe(i, actorId, actor.freedAt))!;
    if (madeBeforeFreed(group.members.find((m) => m.id === blocking.invitedById)?.freedAt, blocking.createdAt)) return { ok: false, error: earlierHolderInviteText(member.name) };
    const by = group.members.find((m) => m.id === blocking.invitedById)?.name ?? "someone";
    return { ok: false, error: `${member.name} is already invited (by ${by}). Only ${by} or the person who looks after the group can change that.` };
  }
  // This email may already be invited as a different name: moving it would quietly free that name.
  const prior = await db.invite.findUnique({ where: { groupId_email: { groupId, email } } });
  const priorOpen = Boolean(prior && !prior.acceptedAt && !prior.declinedAt);
  if (prior && priorOpen && inviteMemberId(prior) !== memberId) {
    const holds = group.members.find((m) => m.id === inviteMemberId(prior) && !m.accountId && !m.claimedAt && !m.leftAt && !m.removedAt);
    if (holds) return { ok: false, error: alreadyInvitedAs(holds.name) };
  }
  // The daily email allowance is checked before anything changes, so going over it leaves the old invitation as it was.
  if (!(await inviteMailOk(actor))) return { ok: false, error: `You've sent ${INVITE_EMAILS_PER_DAY} invite emails today. Share the group's invite link instead.` };
  // The invitation is for this one name. Any older open invitation for the same name (a typo, the wrong address) is closed,
  // so only the newest email can take it. The same email asked again just refreshes its own invitation (and keeps its sender).
  const older = open.filter((i) => i.email !== email);
  const sender = prior && priorOpen && inviteMemberId(prior) === memberId ? prior.invitedById : actorId;
  const token = prior && priorOpen && prior.token && inviteMemberId(prior) === memberId ? prior.token : newInviteToken();
  await db.$transaction(async (tx) => {
    await tx.invite.updateMany({ where: { id: { in: older.map((i) => i.id) }, acceptedAt: null, declinedAt: null }, data: { declinedAt: new Date() } });
    // An orphaned invitation (its sender's name was freed at or after it was sent) is admin-only, read here inside the write: the person who
    // looks after the group takes it over; anyone else leaves the owner and the time alone.
    const cur = await tx.invite.findUnique({ where: { groupId_email: { groupId, email } } });
    const curOpen = Boolean(cur && !cur.acceptedAt && !cur.declinedAt && inviteMemberId(cur) === memberId);
    const curSender = curOpen ? await tx.member.findUnique({ where: { id: cur!.invitedById }, select: { freedAt: true } }) : null;
    const orphan = Boolean(curOpen && madeBeforeFreed(curSender?.freedAt, cur!.createdAt));
    const hold = orphan && !admin;
    await tx.invite.upsert({
      where: { groupId_email: { groupId, email } },
      // The invitation carries a token, so it shows up as a Join card for an existing account (invitations without one are skipped there).
      // The same open invitation for this name keeps its token; anything else gets a fresh one.
      create: { groupId, email, invitedById: actorId, memberId, token },
      update: { invitedById: hold ? cur!.invitedById : orphan ? actorId : sender, acceptedAt: null, declinedAt: null, createdAt: hold ? cur!.createdAt : new Date(), memberId, token },
    });
  });
  const link = `${origin}/join/${group.inviteCode}?${new URLSearchParams({ e: email, as: member.id })}`;
  // The email goes out AFTER the reply (like inviteOne), so the reply comes from the checks above alone and takes the same time
  // whether or not the person blocked the inviter. The invitation is in place either way; if the email can't go (opted out,
  // daily limits, mail not set up) the reply is still the same for everyone.
  const job = async () => {
    // If that email belongs to someone with a block between them and the inviter (either way), nothing is sent. The email goes through exactly the same checks and
    // counters as a real one but is never handed to the mail service (`suppress`).
    const theirAccount = await db.account.findUnique({ where: { email }, select: { id: true } });
    const blocked = Boolean(theirAccount && actor.accountId && (await isBlockedEitherWay(theirAccount.id, actor.accountId).catch(() => true)));
    const by = mailSafe(actor.name, "Someone");
    const gname = mailSafe(group.name, "a group");
    const asName = mailSafe(member.name, "Someone");
    await sendMail(
      email,
      "You've been added to a group on Loopin",
      `${by} added you as “${asName}” in “${gname}” on Loopin. Tap to join and see your share:\n\n${link}`,
      `<div style="font-family:system-ui,sans-serif;max-width:440px"><p style="font-size:16px"><strong>${esc(by)}</strong> added you as <strong>${esc(asName)}</strong> in <strong>${esc(gname)}</strong> on Loopin.</p><p><a href="${link}" style="display:inline-block;background:#0d0d0f;color:#f4f2ec;padding:12px 18px;text-decoration:none;font-weight:600">Join as ${esc(asName)}</a></p></div>`,
      { optOut: true, item: "groups.added", suppress: blocked },
    ).catch(() => false);
    // Someone with an account also gets the card in their updates (the same words as inviteOne), unless they blocked the inviter
    // or already have a row in this group. That includes someone who left or whom the admin removed: this invitation is for a
    // different (name-only) row, so it could never bring them back (only the admin's invitation for their own row does that,
    // see invitations.ts), and a note for it would be a dead end. One note per invitation: asking again for the same open
    // invitation keeps its token, so the claim below is taken once per token and repeats send nothing.
    if (theirAccount && !blocked && !group.members.some((m) => m.accountId === theirAccount.id)) {
      const noteKey = `invite-note:${token}`;
      if (await claimJob(noteKey)) {
        await deliverNotes([{ accountIds: [theirAccount.id], kind: "group_invite", title: `${actor.name} added you to ${group.name}`, body: "Tap to join, or choose Not now.", url: `/groups/${group.id}`, tag: `invite-${group.id}` }]);
        await finishJob(noteKey);
      }
    }
  };
  await logEvent(db, { groupId, actorId, kind: "member_invited", text: `invited ${member.name} to join` });
  if (opts.later) opts.later(job);
  else await job();
  return { ok: true, email };
}
