import { db } from "./db";
import { JOINED } from "./membership";
import { logEvent } from "./events";
import { cleanEmail } from "./auth";
import { sendMail } from "./mail";
import { allow } from "./rate-limit";
import { deliverNotes } from "./account-notes";
import { groupAdminId } from "./group-admin";
import { setMember } from "./people";
import { randomBytes } from "node:crypto";

// Invite and "added you" emails one person can send in a day. The whole app's
// daily email allowance is small, so one person (or a spammer) can't use it up.
export const INVITE_EMAILS_PER_DAY = 20;
const inviteMailOk = (actor: { id: string; accountId?: string | null }) => allow(`invite-mail:${actor.accountId || actor.id}`, INVITE_EMAILS_PER_DAY, 86_400);

// Adding people to a group. Someone added by email (or found by name on Loopin) is in the group at
// once as a name, so they can be split with, and is invited: they see the group on their own
// phone only after they verify their email and tap Join.

// `removed`: the admin took this person out of the group. Only the admin may bring them back, so for
// everyone else the screen shows "Removed" and no Add (`mayAdd` false).
export type Found = { accountId: string; name: string; inGroup: boolean; known: boolean; invited: boolean; removed: boolean; mayAdd: boolean };

// What the invite screen shows for an invitation that has no name row of its own: the typed email only to the
// person who invited; everyone else just sees who invited.
export function inviteRowLabel(invite: { email: string; invitedById: string }, viewerId: string, inviterName: string): string {
  return invite.invitedById === viewerId ? invite.email : `Invited by ${inviterName}`;
}

// The name the search showed for this person: their own name, else their name in a group the two of you share.
// Never anything made from their email (adding someone from search must not leak the start of it).
async function shownNameFor(account: { id: string; name: string }, actorAccountId: string | null | undefined): Promise<string> {
  const own = account.name.trim();
  if (own) return own;
  if (actorAccountId) {
    const row = await db.member.findFirst({
      where: { accountId: account.id, ...JOINED, group: { deletedAt: null, members: { some: { accountId: actorAccountId, ...JOINED } } } },
      select: { name: true },
      orderBy: { createdAt: "asc" },
    });
    if (row?.name.trim()) return row.name.trim();
  }
  return "Someone";
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
      where: { groupId: { in: Object.keys(memberships) }, accountId: { not: null }, ...JOINED, group: { members: { some: { id: { in: Object.values(memberships) }, ...JOINED } } } },
      // Their name in a group we share, used when they haven't set a name of their own (never the start of their email).
      select: { accountId: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
    db.member.findUnique({ where: { id: memberships[groupId] ?? "" }, select: { accountId: true } }),
    groupAdminId(groupId),
  ]);
  const inGroup = new Set(groupRows.filter((m) => !m.leftAt && !m.removedAt).map((m) => m.accountId!));
  const removedIn = new Set(groupRows.filter((m) => m.removedAt).map((m) => m.accountId!));
  const iAmAdmin = Boolean(adminId) && adminId === memberships[groupId];
  const groupName = new Map<string, string>();
  for (const r of knownRows) if (r.accountId && !groupName.has(r.accountId)) groupName.set(r.accountId, r.name);
  const known = await db.account.findMany({ where: { id: { in: [...groupName.keys()] } } });
  const shownName = (a: { id: string; name: string }) => a.name.trim() || groupName.get(a.id) || "Someone";
  const shown = known.filter((a) => shownName(a).toLowerCase().includes(q));
  // Already invited to this group and not joined yet: shown as "Invited".
  const waiting = shown.length ? await db.invite.findMany({ where: { groupId, acceptedAt: null, declinedAt: null, email: { in: shown.map((a) => a.email) } }, select: { email: true } }) : [];
  const invitedEmails = new Set(waiting.map((i) => i.email));
  const out: Found[] = shown.map((a) => ({ accountId: a.id, name: shownName(a), inGroup: inGroup.has(a.id), known: true, invited: invitedEmails.has(a.email), removed: removedIn.has(a.id), mayAdd: !removedIn.has(a.id) || iAmAdmin }));
  // A full email of someone you share nothing with is not looked up here: the screen offers the same
  // "Add" for any email (on Loopin → added; not yet → invited), so nobody can check who has an account.
  // Don't offer the person searching (they're already in the group).
  return out.filter((f) => f.accountId !== me?.accountId).slice(0, 8);
}

// Give a new member the phone notifications this person already turned on elsewhere.
export async function copyPushTo(accountId: string, memberId: string) {
  const others = await db.member.findMany({ where: { accountId, id: { not: memberId } }, select: { id: true } });
  const subs = await db.pushSubscription.findMany({ where: { memberId: { in: others.map((m) => m.id) } } });
  for (const s of subs) {
    await db.pushSubscription.upsert({
      where: { memberId_endpoint: { memberId, endpoint: s.endpoint } },
      create: { memberId, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
      update: {},
    });
  }
}

type Result = { ok: true; memberId: string; eventId: string; name: string; email: string } | { ok: false; error: string };

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
  o: { origin: string; account: { id: string } | null; mail: boolean; later?: Later; row?: { id: string; name: string } },
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
  const { memberId, eventId } = await db.$transaction(async (tx) => {
    let memberId = kept?.id ?? "";
    let eventId = "";
    if (!kept) {
      const m = await tx.member.create({ data: { name, groupId: group.id, splitWeight: group.joinWeight } });
      memberId = m.id;
      eventId = await logEvent(tx, { groupId: group.id, actorId: actor.id, kind: "members_added", text: `added ${name} to the group`, undo: { type: "members_remove", memberIds: [m.id] } });
    }
    const token = kept && prior?.token && inviteMemberId(prior) === kept.id ? prior.token : newInviteToken();
    await tx.invite.upsert({
      where: { groupId_email: { groupId: group.id, email } },
      create: { groupId: group.id, email, invitedById: actor.id, token, memberId },
      // While an invitation is open it stays with whoever sent it first; a new one (after it was closed) belongs to the new sender.
      update: { invitedById: prior && priorOpen ? prior.invitedById : actor.id, acceptedAt: null, declinedAt: null, createdAt: new Date(), token, memberId },
    });
    return { memberId, eventId };
  });

  const link = `${o.origin}/join/${group.inviteCode}?${new URLSearchParams({ e: email, as: memberId })}`;
  const job = async () => {
    if (o.mail) {
      await sendMail(
        email,
        `${actor.name} added you to ${group.name} on Loopin`,
        `${actor.name} added you to “${group.name}” on Loopin.\n\nJoin here: ${link}`,
        `<div style="font-family:system-ui,sans-serif;max-width:440px"><p style="font-size:16px"><strong>${esc(actor.name)}</strong> added you to <strong>${esc(group.name)}</strong> on Loopin.</p><p><a href="${link}" style="display:inline-block;background:#0d0d0f;color:#f4f2ec;padding:12px 18px;text-decoration:none;font-weight:600">Join ${esc(group.name)}</a></p></div>`,
        { optOut: true, item: "groups.added" },
      );
    }
    if (o.account) {
      await deliverNotes([{ accountIds: [o.account.id], kind: "group_invite", title: `${actor.name} added you to ${group.name}`, body: "Tap to join, or choose Not now.", url: `/groups/${group.id}`, tag: `invite-${group.id}` }]);
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

export const alreadyInvitedAs = (name: string) => `That email is already invited as ${name}. Cancel that first.`;
const isAdmin = async (groupId: string, memberId: string) => (await groupAdminId(groupId)) === memberId;
// Bringing someone back (leftAt, removedAt and removedById are all cleared together). Only a person the admin removed needs the admin (checked by the callers);
// any member can bring back someone who left on their own.
const bringBack = (groupId: string, actorId: string, memberId: string) => setMember(groupId, actorId, memberId, { leftAt: null });

// Add someone who's already on Loopin (found by name among people you share a group with).
// They're in the group at once as a name and invited, like an email add.
// `later`: send the email and note after the reply (so adding is instant).
export async function addRegistered(groupId: string, actorId: string, accountId: string, origin: string, opts: { later?: Later } = {}): Promise<Result> {
  const { group, actor } = await loadInviteGroup(groupId, actorId);
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!actor || actor.leftAt) return { ok: false, error: "Only people in this group can add others." };
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, error: "That person isn't on Loopin." };
  const existing = group.members.find((m) => m.accountId === accountId);
  // Taken out by the person who looks after the group: only they can bring them back, by any route.
  if (existing?.removedAt) {
    if (!(await isAdmin(groupId, actorId))) return { ok: false, error: `Only the person who looks after the group can bring ${existing.name} back.` };
    const back = await bringBack(groupId, actorId, existing.id);
    if (!back.ok) return back;
    await copyPushTo(accountId, existing.id);
    return { ok: true, memberId: existing.id, eventId: back.eventId ?? "", name: existing.name, email: account.email };
  }
  if (existing && !existing.leftAt) return { ok: false, error: `${existing.name} is already in this group.` };

  if (existing) {
    // Someone who left on their own and is added back: back in, as before. Any member can do this (only removed people need the admin).
    const { eventId } = await db.$transaction(async (tx) => {
      await tx.member.update({ where: { id: existing.id }, data: { leftAt: null } });
      const eventId = await logEvent(tx, { groupId, actorId, kind: "members_added", text: `added ${existing.name} to the group` });
      return { eventId };
    });
    await copyPushTo(accountId, existing.id);
    return { ok: true, memberId: existing.id, eventId, name: existing.name, email: account.email };
  }
  const mail = await inviteMailOk(actor);
  const actorAccountId = (await db.member.findUnique({ where: { id: actorId }, select: { accountId: true } }))?.accountId;
  const r = await inviteOne(group, actor, account.email, await shownNameFor(account, actorAccountId), { origin, account, mail, later: opts.later });
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
      // The same quiet reply for everyone. Only the person who looks after the group can bring back someone they removed.
      if (already.removedAt) {
        if (await isAdmin(groupId, actorId)) {
          const back = await bringBack(groupId, actorId, already.id);
          if (back.ok) await copyPushTo(account.id, already.id);
        }
      } else if (already.leftAt) {
        // Left on their own: invited to their own row. Join brings them back (they are not back until they tap it).
        const again = await inviteOne(group, actor, email, already.name, { origin, account, mail, later: opts.later, row: already });
        if ("error" in again) {
          bad.push(`${email} (${again.error})`);
          continue;
        }
      }
      people.push({ name: wanted, email });
      continue;
    }
    const r = await inviteOne(group, actor, email, wanted, { origin, account, mail, later: opts.later });
    if ("error" in r) {
      bad.push(`${email} (${r.error})`);
      continue;
    }
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
    select: { id: true, email: true, invitedById: true },
  });
}

export const CANCEL_NOT_ALLOWED = "Only the person who looks after the group, or the person who sent the invitation, can cancel it.";

// "Cancel invitation": for a name whose invitation went to the wrong address (or the person signs in with another one).
// Closes the open invitations for the name (all of them for the admin, only their own for the person who sent them); it goes back to being a plain name that "That's me" can take.
// Only the person who looks after the group or whoever sent the invitation may do it. Nothing about balances changes.
export async function cancelInvitation(groupId: string, actorId: string, memberId: string): Promise<{ ok: true; cancelled: number } | { ok: false; error: string }> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true, name: true, leftAt: true, removedAt: true } } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  const actor = group.members.find((m) => m.id === actorId);
  if (!actor || actor.leftAt) return { ok: false, error: "Only people in this group can do this." };
  const member = group.members.find((m) => m.id === memberId);
  if (!member) return { ok: false, error: "That name isn't in this group." };
  const open = await openInvitesFor(groupId, memberId);
  if (!open.length) return { ok: false, error: "There is no open invitation for that name." };
  // The admin cancels every open invitation for the name; anyone else only the ones they sent.
  const admin = await isAdmin(groupId, actorId);
  const mine = admin ? open : open.filter((i) => i.invitedById === actorId);
  if (!mine.length) return { ok: false, error: CANCEL_NOT_ALLOWED };
  const r = await db.invite.updateMany({ where: { id: { in: mine.map((i) => i.id) }, acceptedAt: null, declinedAt: null }, data: { declinedAt: new Date() } });
  await logEvent(db, { groupId, actorId, kind: "member_invited", text: `cancelled the invitation for ${member.name}` });
  return { ok: true, cancelled: r.count };
}

// "Invite by email" for someone added by name only (before email sign-up):
// the link opens the group's join page on "Continue as <name>", so their
// expenses and balance stay theirs.
export async function inviteToClaim(groupId: string, actorId: string, memberId: string, rawEmail: string, origin: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const email = cleanEmail(rawEmail);
  if (!email) return { ok: false, error: "Enter an email address, like name@gmail.com." };
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
  const actor = group?.members.find((m) => m.id === actorId && !m.leftAt);
  const member = group?.members.find((m) => m.id === memberId && !m.leftAt && !m.removedAt);
  if (!group || group.deletedAt || !actor) return { ok: false, error: "Only people in this group can invite." };
  if (!member || member.accountId || member.claimedAt) return { ok: false, error: "That person is already on Loopin." };
  // A name that already has an open invitation can be changed by the admin or by the person who sent it (the same people who can
  // cancel it), not by any member: otherwise anyone could point it at their own address and take the name over.
  const open = await openInvitesFor(groupId, memberId);
  const admin = await isAdmin(groupId, actorId);
  if (open.length && !admin && !open.every((i) => i.invitedById === actorId)) {
    const by = group.members.find((m) => m.id === open[0].invitedById)?.name ?? "someone";
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
  await db.$transaction([
    db.invite.updateMany({ where: { id: { in: older.map((i) => i.id) }, acceptedAt: null, declinedAt: null }, data: { declinedAt: new Date() } }),
    db.invite.upsert({
      where: { groupId_email: { groupId, email } },
      create: { groupId, email, invitedById: actorId, memberId },
      update: { invitedById: sender, acceptedAt: null, declinedAt: null, createdAt: new Date(), memberId },
    }),
  ]);
  const link = `${origin}/join/${group.inviteCode}?${new URLSearchParams({ e: email, as: member.id })}`;
  const sent = await sendMail(
    email,
    `${actor.name} added you to ${group.name} on Loopin`,
    `${actor.name} added you as “${member.name}” in “${group.name}” on Loopin. Tap to join and see your share:\n\n${link}`,
    `<div style="font-family:system-ui,sans-serif;max-width:440px"><p style="font-size:16px"><strong>${esc(actor.name)}</strong> added you as <strong>${esc(member.name)}</strong> in <strong>${esc(group.name)}</strong> on Loopin.</p><p><a href="${link}" style="display:inline-block;background:#0d0d0f;color:#f4f2ec;padding:12px 18px;text-decoration:none;font-weight:600">Join as ${esc(member.name)}</a></p></div>`,
    { optOut: true, item: "groups.added" },
  );
  if (!sent) return { ok: false, error: "The email couldn’t be sent. Share the group’s invite link instead." };
  await logEvent(db, { groupId, actorId, kind: "member_invited", text: `invited ${member.name} to join` });
  return { ok: true, email };
}
