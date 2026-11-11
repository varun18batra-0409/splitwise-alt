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
export type Found = { accountId: string; name: string; email: string; inGroup: boolean; known: boolean; invited: boolean; removed: boolean; mayAdd: boolean };

const nameOfAccount = (a: { name: string; email: string }) => a.name.trim() || a.email.split("@")[0];

// A name that isn't taken in the group yet ("Joey", then "Joey 2"…).
export function freeName(taken: string[], wanted: string): string {
  const base = wanted.trim().replace(/\s+/g, " ").slice(0, 36) || "Friend";
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 100; i++) if (!used.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
  return `${base} ${Date.now() % 1000}`;
}

// Search for people on Loopin. For privacy, names only match people you
// already share a group with; anyone else is found by their exact email.
export async function searchPeople(memberships: Record<string, string>, groupId: string, rawQuery: string): Promise<Found[]> {
  const q = rawQuery.trim().toLowerCase().slice(0, 80);
  if (q.length < 2) return [];
  const email = cleanEmail(q);
  // Everything at once (each is a trip to the database).
  const [groupRows, knownRows, exact, me, adminId] = await Promise.all([
    // Everyone with an account in this group, including people who left or were removed (a removed person is never offered an Add).
    db.member.findMany({ where: { groupId, accountId: { not: null } }, select: { accountId: true, leftAt: true, removedAt: true } }),
    // People you share a group with, both really joined (someone added straight in who hasn't opened it isn't offered yet).
    db.member.findMany({
      where: { groupId: { in: Object.keys(memberships) }, accountId: { not: null }, ...JOINED, group: { members: { some: { id: { in: Object.values(memberships) }, ...JOINED } } } },
      select: { accountId: true },
      distinct: ["accountId"],
    }),
    email ? db.account.findUnique({ where: { email } }) : Promise.resolve(null),
    db.member.findUnique({ where: { id: memberships[groupId] ?? "" }, select: { accountId: true } }),
    groupAdminId(groupId),
  ]);
  const inGroup = new Set(groupRows.filter((m) => !m.leftAt && !m.removedAt).map((m) => m.accountId!));
  const removedIn = new Set(groupRows.filter((m) => m.removedAt).map((m) => m.accountId!));
  const iAmAdmin = Boolean(adminId) && adminId === memberships[groupId];
  const known = await db.account.findMany({ where: { id: { in: knownRows.map((r) => r.accountId!) } } });
  const shown = known.filter((a) => a.email.includes(q) || nameOfAccount(a).toLowerCase().includes(q));
  // Already invited to this group and not joined yet: shown as "Invited".
  const waiting = shown.length ? await db.invite.findMany({ where: { groupId, acceptedAt: null, declinedAt: null, email: { in: shown.map((a) => a.email) } }, select: { email: true } }) : [];
  const invitedEmails = new Set(waiting.map((i) => i.email));
  const out: Found[] = shown.map((a) => ({ accountId: a.id, name: nameOfAccount(a), email: a.email, inGroup: inGroup.has(a.id), known: true, invited: invitedEmails.has(a.email), removed: removedIn.has(a.id), mayAdd: !removedIn.has(a.id) || iAmAdmin }));
  // A full email of someone you share nothing with is not looked up here: the screen offers the same
  // "Add" for any email (on Loopin → added; not yet → invited), so nobody can check who has an account.
  void exact;
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
export function nameFromEmail(email: string): string {
  const words = email.split("@")[0].replace(/[._+\-]+/g, " ").trim().split(/\s+/).filter(Boolean);
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
  o: { origin: string; account: { id: string } | null; mail: boolean; later?: Later },
): Promise<{ memberId: string; eventId: string; name: string }> {
  const prior = await db.invite.findUnique({ where: { groupId_email: { groupId: group.id, email } } });
  // Asked again before they joined: the same name row, a fresh invitation.
  const kept = prior && !prior.acceptedAt && prior.token ? group.members.find((m) => m.id === inviteMemberId(prior) && !m.accountId && !m.leftAt && !m.removedAt) : undefined;
  const name = kept ? kept.name : freeName(group.members.map((m) => m.name), wantedName);
  const { memberId, eventId } = await db.$transaction(async (tx) => {
    let memberId = kept?.id ?? "";
    let eventId = "";
    if (!kept) {
      const m = await tx.member.create({ data: { name, groupId: group.id, splitWeight: group.joinWeight } });
      memberId = m.id;
      eventId = await logEvent(tx, { groupId: group.id, actorId: actor.id, kind: "members_added", text: `added ${name} to the group`, undo: { type: "members_remove", memberIds: [m.id] } });
    }
    const token = kept && prior?.token ? prior.token : newInviteToken();
    await tx.invite.upsert({
      where: { groupId_email: { groupId: group.id, email } },
      create: { groupId: group.id, email, invitedById: actor.id, token, memberId },
      update: { invitedById: actor.id, acceptedAt: null, declinedAt: null, createdAt: new Date(), token, memberId },
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
        { optOut: true },
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

const isAdmin = async (groupId: string, memberId: string) => (await groupAdminId(groupId)) === memberId;
// The admin brings back someone they removed (leftAt, removedAt and removedById are all cleared together).
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
    // Someone who left on their own and is added back: back in, as before.
    const { eventId } = await db.$transaction(async (tx) => {
      await tx.member.update({ where: { id: existing.id }, data: { leftAt: null } });
      const eventId = await logEvent(tx, { groupId, actorId, kind: "members_added", text: `added ${existing.name} to the group` });
      return { eventId };
    });
    await copyPushTo(accountId, existing.id);
    return { ok: true, memberId: existing.id, eventId, name: existing.name, email: account.email };
  }
  const mail = await inviteMailOk(actor);
  const r = await inviteOne(group, actor, account.email, nameOfAccount(account), { origin, account, mail, later: opts.later });
  return { ok: true, ...r, email: account.email };
}

// Invite people by email. Everyone typed (valid) gets the same reply: they're in the group as a name
// and an invitation went out. Only a badly typed address is an error. Someone who is already in the
// group, or yourself, gets the same reply and nothing is sent.
export async function inviteByEmail(groupId: string, actorId: string, rawEmails: string, origin: string, opts: { later?: Later } = {}) {
  const { group, actor } = await loadInviteGroup(groupId, actorId);
  const people: { name: string; email: string }[] = [];
  const bad: string[] = [];
  const eventIds: string[] = [];
  if (!group || group.deletedAt || !actor || actor.leftAt) return { people, bad, eventIds };
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
      if (already.removedAt && (await isAdmin(groupId, actorId))) {
        const back = await bringBack(groupId, actorId, already.id);
        if (back.ok) {
          await copyPushTo(account.id, already.id);
          if (back.eventId) eventIds.push(back.eventId);
        }
      }
      people.push({ name: wanted, email });
      continue;
    }
    const r = await inviteOne(group, actor, email, wanted, { origin, account, mail, later: opts.later });
    people.push({ name: r.name, email });
    if (r.eventId) eventIds.push(r.eventId);
  }
  return { people, bad, eventIds };
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
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
  await db.invite.upsert({
    where: { groupId_email: { groupId, email } },
    create: { groupId, email, invitedById: actorId },
    update: { invitedById: actorId, acceptedAt: null, createdAt: new Date() },
  });
  const link = `${origin}/join/${group.inviteCode}?${new URLSearchParams({ e: email, as: member.id })}`;
  if (!(await inviteMailOk(actor))) return { ok: false, error: `You've sent ${INVITE_EMAILS_PER_DAY} invite emails today. Share the group's invite link instead.` };
  const sent = await sendMail(
    email,
    `${actor.name} added you to ${group.name} on Loopin`,
    `${actor.name} added you as “${member.name}” in “${group.name}” on Loopin. Tap to join and see your share:\n\n${link}`,
    `<div style="font-family:system-ui,sans-serif;max-width:440px"><p style="font-size:16px"><strong>${esc(actor.name)}</strong> added you as <strong>${esc(member.name)}</strong> in <strong>${esc(group.name)}</strong> on Loopin.</p><p><a href="${link}" style="display:inline-block;background:#0d0d0f;color:#f4f2ec;padding:12px 18px;text-decoration:none;font-weight:600">Join as ${esc(member.name)}</a></p></div>`,
    { optOut: true },
  );
  if (!sent) return { ok: false, error: "The email couldn’t be sent. Share the group’s invite link instead." };
  await logEvent(db, { groupId, actorId, kind: "member_invited", text: `invited ${member.name} (${email}) to join` });
  return { ok: true, email };
}
