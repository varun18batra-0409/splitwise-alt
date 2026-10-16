import { db } from "./db";
import { logEvent } from "./events";
import { cleanEmail } from "./auth";
import { sendMail } from "./mail";

// Adding people to a group. Nobody can be added by just typing a name:
//  - people already on Loopin (signed up with email) can be added directly;
//  - anyone else gets an invitation (email, or a link sent from contacts) and
//    becomes a member only after they verify their email and accept.

export type Found = { accountId: string; name: string; email: string; inGroup: boolean; known: boolean };

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
  const inGroup = new Set(
    (await db.member.findMany({ where: { groupId, accountId: { not: null }, leftAt: null }, select: { accountId: true } })).map((m) => m.accountId!),
  );
  const myGroupIds = Object.keys(memberships);
  const knownRows = await db.member.findMany({
    where: { groupId: { in: myGroupIds }, accountId: { not: null } },
    select: { accountId: true },
    distinct: ["accountId"],
  });
  const knownIds = knownRows.map((r) => r.accountId!);
  const known = await db.account.findMany({ where: { id: { in: knownIds } } });
  const out: Found[] = known
    .filter((a) => a.email.includes(q) || nameOfAccount(a).toLowerCase().includes(q))
    .map((a) => ({ accountId: a.id, name: nameOfAccount(a), email: a.email, inGroup: inGroup.has(a.id), known: true }));
  const email = cleanEmail(q);
  if (email && !out.some((f) => f.email === email)) {
    const a = await db.account.findUnique({ where: { email } });
    if (a) out.push({ accountId: a.id, name: nameOfAccount(a), email: a.email, inGroup: inGroup.has(a.id), known: false });
  }
  // Don't offer the person searching (they're already in the group).
  const me = await db.member.findUnique({ where: { id: memberships[groupId] ?? "" }, select: { accountId: true } });
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

type Result = { ok: true; memberId: string; eventId: string; name: string } | { ok: false; error: string };

// Add someone who's already on Loopin. They're told by email (and by phone
// notification if they turned those on).
export async function addRegistered(groupId: string, actorId: string, accountId: string, origin: string): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  const actor = group.members.find((m) => m.id === actorId);
  if (!actor) return { ok: false, error: "Only people in this group can add others." };
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, error: "That person isn't on Loopin." };
  const existing = group.members.find((m) => m.accountId === accountId);
  if (existing && !existing.leftAt) return { ok: false, error: `${existing.name} is already in this group.` };

  const name = existing ? existing.name : freeName(group.members.map((m) => m.name), nameOfAccount(account));
  const { memberId, eventId } = await db.$transaction(async (tx) => {
    const m = existing
      ? await tx.member.update({ where: { id: existing.id }, data: { leftAt: null } })
      : await tx.member.create({ data: { name, groupId, accountId, claimedAt: new Date(), splitWeight: group.joinWeight } });
    const eventId = await logEvent(tx, {
      groupId,
      actorId,
      kind: "members_added",
      text: `added ${name} to the group`,
      undo: existing ? undefined : { type: "members_remove", memberIds: [m.id] },
    });
    await tx.invite.updateMany({ where: { groupId, email: account.email, acceptedAt: null }, data: { acceptedAt: new Date() } });
    return { memberId: m.id, eventId };
  });
  await copyPushTo(accountId, memberId);
  await sendMail(
    account.email,
    `${actor.name} added you to ${group.name} on Loopin`,
    `${actor.name} added you to “${group.name}” on Loopin.\n\nOpen it: ${origin}/groups/${groupId}`,
    `<div style="font-family:system-ui,sans-serif;max-width:440px"><p style="font-size:16px"><strong>${esc(actor.name)}</strong> added you to <strong>${esc(group.name)}</strong> on Loopin.</p><p><a href="${origin}/groups/${groupId}" style="display:inline-block;background:#0d0d0f;color:#f4f2ec;padding:12px 18px;text-decoration:none;font-weight:600">Open ${esc(group.name)}</a></p></div>`,
  );
  return { ok: true, memberId, eventId, name };
}

// Invite people by email. Someone already on Loopin is added straight away;
// everyone else gets a link and joins after verifying their email.
export async function inviteByEmail(groupId: string, actorId: string, rawEmails: string, origin: string) {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true, name: true } } } });
  const actor = group?.members.find((m) => m.id === actorId);
  if (!group || !actor) return { added: [] as string[], invited: [] as string[], bad: [] as string[] };
  const parts = [...new Set(rawEmails.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))].slice(0, 20);
  const added: string[] = [], invited: string[] = [], bad: string[] = [];
  for (const p of parts) {
    const email = cleanEmail(p);
    if (!email) {
      bad.push(p);
      continue;
    }
    const account = await db.account.findUnique({ where: { email } });
    if (account) {
      const r = await addRegistered(groupId, actorId, account.id, origin);
      if (r.ok) added.push(r.name);
      else bad.push(`${email} (${r.error})`);
      continue;
    }
    await db.invite.upsert({
      where: { groupId_email: { groupId, email } },
      create: { groupId, email, invitedById: actorId },
      update: { invitedById: actorId, acceptedAt: null, createdAt: new Date() },
    });
    const link = `${origin}/join/${group.inviteCode}?e=${encodeURIComponent(email)}`;
    await sendMail(
      email,
      `${actor.name} invited you to ${group.name} on Loopin`,
      `${actor.name} invited you to split expenses in “${group.name}” on Loopin.\n\nJoin here: ${link}\n\nLoopin is free, with no ads.`,
      `<div style="font-family:system-ui,sans-serif;max-width:440px"><p style="font-size:16px"><strong>${esc(actor.name)}</strong> invited you to split expenses in <strong>${esc(group.name)}</strong> on Loopin.</p><p><a href="${link}" style="display:inline-block;background:#0d0d0f;color:#f4f2ec;padding:12px 18px;text-decoration:none;font-weight:600">Join ${esc(group.name)}</a></p><p style="font-size:13px;color:#777">Loopin is free, with no ads.</p></div>`,
    );
    invited.push(email);
  }
  if (invited.length) {
    await logEvent(db, { groupId, actorId, kind: "member_invited", text: `invited ${invited.join(", ")} by email` });
  }
  return { added, invited, bad };
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
