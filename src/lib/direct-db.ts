import { randomBytes } from "node:crypto";
import { db } from "./db";
import { allow } from "./rate-limit";
import { cleanEmail } from "./auth";
import { sendMail } from "./mail";
import { deliverNotes } from "./account-notes";
import { hasBlocked, isBlockedEitherWay } from "./blocks";
import { JOINED } from "./membership";
import { isSupportedCurrency } from "./money";
import { cleanNames } from "./names";
import { copyPushTo, freeName, inviteMailOk, INVITE_EMAILS_PER_DAY, newInviteToken, shownNameFor } from "./invites";
import { changeGroupCurrency } from "./group-changes";
import { accountPairKey, DIRECT, localPairKey, NOT_DIRECT, pairName, redirectIfDirect } from "./direct";

// The database side of expenses with one person (see direct.ts). A pair is a hidden two-member Group of type "direct".
// Nothing here writes money: expenses and payments go through the ordinary group code.

export type PairResult = { ok: true; groupId: string; myId: string; otherId: string; created: boolean } | { ok: false; error: string };

export const PAIR_REFUSED = "You can only add expenses with people you share a group with, or by typing a name.";
export const PAIR_NEW_BLOCKED = "You can’t add new expenses with this person.";
export const PAIR_BLOCKED = "You can’t add expenses with this person.";
const PAIR_BUSY = "Too many new people added just now. Try again a little later.";

const newCode = () => randomBytes(6).toString("base64url");
const newMemberId = () => `c${randomBytes(12).toString("hex")}`;

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "P2002" || /UNIQUE constraint failed/i.test(String(e?.message ?? ""));
}

// Do these two accounts share an open ordinary group, both really in it? (Pairs never count.)
export async function shareOpenGroup(a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const row = await db.member.findFirst({
    where: {
      accountId: b,
      ...JOINED,
      leftAt: null,
      removedAt: null,
      group: { ...NOT_DIRECT, deletedAt: null, closed: false, members: { some: { accountId: a, ...JOINED, leftAt: null, removedAt: null } } },
    },
    select: { id: true },
  });
  return Boolean(row);
}

async function readPair(pairKey: string, meAccountId: string, created: boolean): Promise<PairResult | null> {
  const g = await db.group.findUnique({ where: { pairKey }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!g || g.deletedAt || g.type !== DIRECT) return null;
  const mine = g.members.find((m) => m.accountId === meAccountId);
  const other = g.members.find((m) => m.id !== mine?.id);
  if (!mine || !other) return null;
  return { ok: true, groupId: g.id, myId: mine.id, otherId: other.id, created };
}

type NewPair = { key: string; meAccountId: string; myName: string; other: { name: string; accountId: string | null }; currency: string };

// Makes the hidden group and both rows in ONE create. The unique pairKey means two taps (or two phones, or both people at once)
// can never make two pairs: the loser re-reads and gets the winner. No history line is written: nobody is told until money is added.
async function createPair(p: NewPair): Promise<PairResult> {
  const now = new Date();
  const myRow = newMemberId();
  const myName = p.myName.trim().replace(/\s+/g, " ").slice(0, 36) || "Me";
  const theirName = freeName([myName], p.other.name);
  try {
    const g = await db.group.create({
      data: {
        name: pairName(myName, theirName),
        type: DIRECT,
        cover: "plain",
        currency: isSupportedCurrency(p.currency) ? p.currency : "INR",
        inviteCode: newCode(), // never shown, never accepted (join.ts refuses pairs)
        pairKey: p.key,
        members: {
          create: [
            // My row first: balances order members by createdAt then id, and the first member takes the odd paisa.
            { id: myRow, name: myName, accountId: p.meAccountId, claimedAt: now, seenAt: now, createdAt: now },
            {
              name: theirName,
              createdAt: new Date(now.getTime() + 1),
              addedBy: myRow,
              seenAt: now,
              ...(p.other.accountId ? { accountId: p.other.accountId, claimedAt: now } : {}),
            },
          ],
        },
      },
      include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    await copyPushTo(p.meAccountId, myRow).catch(() => undefined);
    const other = g.members.find((m) => m.id !== myRow)!;
    if (p.other.accountId) await copyPushTo(p.other.accountId, other.id).catch(() => undefined);
    return { ok: true, groupId: g.id, myId: myRow, otherId: other.id, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return (await readPair(p.key, p.meAccountId, false)) ?? { ok: false, error: "Couldn’t start this. Try again." };
  }
}

// A pair with someone who has an account. Allowed only for people you already know (an open group in common) or an existing pair;
// never when either of you blocked the other. Finding the pair is free; making one is rate limited.
export async function ensureAccountPair(
  me: { id: string },
  otherAccountId: string,
  opts: { currency: string; myName: string; requestKey?: string },
): Promise<PairResult> {
  if (!otherAccountId || otherAccountId === me.id) return { ok: false, error: PAIR_REFUSED };
  const other = await db.account.findUnique({ where: { id: otherAccountId }, select: { id: true, name: true } });
  if (!other) return { ok: false, error: PAIR_REFUSED };
  const key = accountPairKey(me.id, other.id);
  const found = await readPair(key, me.id, false);
  // Someone who blocked you gets exactly the answer of someone you share nothing with, so a refusal never says why.
  const blocked = await isBlockedEitherWay(me.id, other.id);
  if (blocked) return { ok: false, error: PAIR_REFUSED };
  if (found) return found;
  if (!(await shareOpenGroup(me.id, other.id))) return { ok: false, error: PAIR_REFUSED };
  if (!(await allow(`direct-pair:${me.id}`, 30, 3600))) return { ok: false, error: PAIR_BUSY };
  return createPair({ key, meAccountId: me.id, myName: opts.myName, other: { name: await shownNameFor(other, me.id), accountId: other.id }, currency: opts.currency });
}

// A pair with a name only you can see. The key is your account and the name, so typing it again finds the same history.
export async function ensureLocalPair(me: { id: string }, rawName: string, opts: { currency: string; myName: string }): Promise<PairResult> {
  const name = cleanNames([rawName])[0];
  if (!name) return { ok: false, error: "Type a name." };
  const key = localPairKey(me.id, name);
  const found = await readPair(key, me.id, false);
  if (found) return found;
  if (!(await allow(`direct-pair:${me.id}`, 30, 3600))) return { ok: false, error: PAIR_BUSY };
  return createPair({ key, meAccountId: me.id, myName: opts.myName, other: { name, accountId: null }, currency: opts.currency });
}

// Checked just before an expense is saved in a pair. Returns the refusal text, or null to carry on.
// - New expenses are refused when either person has blocked the other (an edit of one already there is not).
// - A pair with no expenses or payments at all takes the currency of its first expense (changeGroupCurrency with expectEmpty: it
//   refuses, writing nothing, if anything is there by the time it runs). Once there is money the currency is fixed.
export async function prepareDirectSave(groupId: string, myId: string, currency: string, editing: boolean): Promise<string | null> {
  const g = await db.group.findUnique({ where: { id: groupId }, include: { members: true, _count: { select: { expenses: true, payments: true } } } });
  if (!g || g.deletedAt || g.type !== DIRECT) return null;
  const me = g.members.find((m) => m.id === myId);
  const other = g.members.find((m) => m.id !== myId);
  if (!me || !other) return null;
  if (!editing && me.accountId && other.accountId && (await isBlockedEitherWay(me.accountId, other.accountId))) return PAIR_NEW_BLOCKED;
  if (!editing && g._count.expenses + g._count.payments === 0 && currency !== g.currency && isSupportedCurrency(currency)) {
    // quiet: an empty pair has no money to convert, so this writes no history line (nobody is told, and nothing is left behind if the save then fails).
    const r = await changeGroupCurrency(groupId, myId, currency, "1", { expectEmpty: true, quiet: true });
    if (!r.ok && !r.needsRate) return r.error;
  }
  return null;
}

// For pages a pair must not show: one small read, then the person's page instead (see redirectIfDirect).
export async function bounceIfDirect(groupId: string, query: Record<string, string | string[] | undefined> = {}): Promise<void> {
  const g = await db.group.findUnique({ where: { id: groupId }, select: { id: true, type: true } });
  if (g) redirectIfDirect(g, query);
}

// For image routes: a pair has none (404).
export async function isDirectGroup(groupId: string): Promise<boolean> {
  return (await db.group.findUnique({ where: { id: groupId }, select: { type: true } }))?.type === DIRECT;
}

// The groups "In a group" offers (and a lone group jumps straight into): open ordinary groups you are in. Pairs never appear here.
export async function pickableGroups(memberships: Record<string, string>) {
  return db.group.findMany({
    where: { id: { in: Object.keys(memberships) }, closed: false, deletedAt: null, ...NOT_DIRECT },
    orderBy: { createdAt: "desc" },
  });
}

// ---- Lists ----

export type DirectEntry = {
  groupId: string;
  currency: string;
  myId: string;
  other: { id: string; name: string; accountId: string | null };
  shared: boolean; // the other person has an account
  net: number; // my balance in the pair (positive: they owe me), in paise
  lastActivity: Date;
  expenseCount: number;
  paymentCount: number;
};

type EntryRow = {
  group: { id: string; currency: string; type: string; members: { id: string; name: string; accountId: string | null }[] };
  myId: string;
  myBalance: number;
  lastActivity: Date;
  expenseCount: number;
  paymentCount: number;
};

// One entry per pair, newest activity first. `net` comes from the same database sums as every other balance.
export function directEntries(rows: EntryRow[]): DirectEntry[] {
  const out: DirectEntry[] = [];
  for (const r of rows) {
    if (r.group.type !== DIRECT) continue;
    const other = r.group.members.find((m) => m.id !== r.myId);
    if (!other) continue;
    out.push({
      groupId: r.group.id,
      currency: r.group.currency,
      myId: r.myId,
      other: { id: other.id, name: other.name, accountId: other.accountId },
      shared: Boolean(other.accountId),
      net: r.myBalance,
      lastActivity: r.lastActivity,
      expenseCount: r.expenseCount,
      paymentCount: r.paymentCount,
    });
  }
  return out.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
}

// Settle's "Open · All · Settled" filter and its name search (names only; a settled person is found too when the filter allows it).
export function filterDirect<T extends { net: number; other: { name: string } }>(entries: T[], f: { show: "open" | "all" | "settled"; q: string }): T[] {
  const q = f.q.trim().toLowerCase();
  return entries.filter((e) => (f.show === "all" || (f.show === "open" ? e.net !== 0 : e.net === 0)) && (!q || e.other.name.toLowerCase().includes(q)));
}

// Empty pairs (the person was picked, then nothing was added) stay out of Settle and Home until they have any history.
export const hasHistory = (e: DirectEntry): boolean => e.expenseCount > 0 || e.paymentCount > 0;

// ---- Inviting someone you added by name ----

export type InviteReply = { ok: true; email: string } | { ok: false; error: string };

// Only the account holder of a name-only pair, and only while the other row is still a name. The reply is the same whether or not
// the email is on Loopin, is your own, or belongs to someone you already share a pair with (in those cases nothing is written or sent).
export async function inviteDirectPerson(
  groupId: string,
  actorId: string,
  rawEmail: string,
  origin: string,
  later?: (job: () => Promise<unknown>) => void,
): Promise<InviteReply> {
  const email = cleanEmail(rawEmail);
  if (!email) return { ok: false, error: "Enter an email address, like name@gmail.com." };
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
  if (!group || group.deletedAt || group.type !== DIRECT) return { ok: false, error: "This isn’t there any more." };
  const actor = group.members.find((m) => m.id === actorId);
  const row = group.members.find((m) => m.id !== actorId);
  if (!actor?.accountId || !row) return { ok: false, error: "Only the person who added this name can invite them." };
  if (row.accountId || row.claimedAt || row.removedAt) return { ok: false, error: `${row.name} is already on Loopin.` };
  if (!(await inviteMailOk({ id: actor.id, accountId: actor.accountId }))) {
    return { ok: false, error: `You've sent ${INVITE_EMAILS_PER_DAY} invite emails today. Try again tomorrow.` };
  }
  const me = await db.account.findUnique({ where: { id: actor.accountId }, select: { id: true, email: true, name: true } });
  if (!me) return { ok: false, error: "Sign in to invite." };
  const theirs = await db.account.findUnique({ where: { email }, select: { id: true } });
  // Your own email: said plainly (that tells nobody anything).
  if (email === me.email.toLowerCase()) return { ok: false, error: "That’s your own email. Type theirs." };
  // Someone you already share a pair with: looks exactly like a normal send (the person's page shows "Invitation sent to …" and can
  // cancel it), but nothing is invited or sent. Only a small note of the address is kept for that page (see openInviteEmail).
  if (theirs && (await db.group.findUnique({ where: { pairKey: accountPairKey(me.id, theirs.id) }, select: { id: true } }))) {
    await db.$transaction([
      db.invite.updateMany({ where: { groupId, memberId: row.id, acceptedAt: null, declinedAt: null }, data: { declinedAt: new Date() } }),
      db.requestKey.upsert({ where: { key: decoyKey(groupId, row.id) }, create: { key: decoyKey(groupId, row.id), result: email }, update: { result: email, createdAt: new Date() } }),
    ]);
    return { ok: true, email };
  }

  const prior = await db.invite.findUnique({ where: { groupId_email: { groupId, email } } });
  const priorOpen = Boolean(prior && !prior.acceptedAt && !prior.declinedAt);
  const token = prior && priorOpen && prior.token && prior.memberId === row.id ? prior.token : newInviteToken();
  await db.$transaction([
    // Only the newest email can take this name: older open invitations for it are closed.
    db.invite.updateMany({ where: { groupId, memberId: row.id, email: { not: email }, acceptedAt: null, declinedAt: null }, data: { declinedAt: new Date() } }),
    db.invite.upsert({
      where: { groupId_email: { groupId, email } },
      create: { groupId, email, invitedById: actor.id, token, memberId: row.id },
      update: { invitedById: actor.id, acceptedAt: null, declinedAt: null, createdAt: new Date(), token, memberId: row.id },
    }),
    db.requestKey.deleteMany({ where: { key: decoyKey(groupId, row.id) } }),
  ]);

  const actorName = actor.name;
  const link = `${origin}/signin?${new URLSearchParams({ e: email, back: "/" })}`;
  const job = async () => {
    // If that email belongs to someone who blocked the inviter, nothing reaches them (the mail runs through its checks, unsent).
    const blocked = Boolean(theirs && (await hasBlocked(theirs.id, me.id).catch(() => true)));
    await sendMail(
      email,
      `${actorName} shared expenses with you on Loopin`,
      `${actorName} shared expenses with you on Loopin.\n\nSign in to see them: ${link}`,
      `<div style="font-family:system-ui,sans-serif;max-width:440px"><p style="font-size:16px"><strong>${esc(actorName)}</strong> shared expenses with you on Loopin.</p><p><a href="${link}" style="display:inline-block;background:#0d0d0f;color:#f4f2ec;padding:12px 18px;text-decoration:none;font-weight:600">See them</a></p></div>`,
      { optOut: true, item: "groups.added", suppress: blocked },
    ).catch(() => false);
    if (blocked || !theirs) return;
    await deliverNotes([{ accountIds: [theirs.id], kind: "group_invite", title: `${actorName} shared expenses with you`, body: "Tap to join, or choose Not now.", url: "/", tag: `invite-${groupId}` }]).catch(() => undefined);
  };
  if (later) later(job);
  else await job();
  return { ok: true, email };
}

// The address shown as "Invitation sent to …" on the person's page: the open invitation, or the note kept when the address was
// someone you already share with (so both look the same).
const decoyKey = (groupId: string, rowId: string) => `direct-decoy:${groupId}:${rowId}`;

export async function openInviteEmail(groupId: string, rowId: string): Promise<string | null> {
  const real = await db.invite.findFirst({ where: { groupId, memberId: rowId, acceptedAt: null, declinedAt: null }, select: { email: true } });
  if (real) return real.email;
  return (await db.requestKey.findUnique({ where: { key: decoyKey(groupId, rowId) }, select: { result: true } }))?.result || null;
}

// "Cancel invitation" on a pair, so a mistyped address can be fixed. Only a member of the pair who has an account; the other row must
// still be a name. Closes every open invitation for it and drops the note. Balances and history are not touched; nothing is logged.
export async function cancelDirectInvite(groupId: string, actorId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
  if (!group || group.deletedAt || group.type !== DIRECT) return { ok: false, error: "This isn’t there any more." };
  const actor = group.members.find((m) => m.id === actorId);
  const row = group.members.find((m) => m.id !== actorId);
  if (!actor?.accountId || !row) return { ok: false, error: "Only the person who added this name can cancel the invitation." };
  if (row.accountId || row.claimedAt || row.removedAt) return { ok: false, error: `${row.name} is already on Loopin.` };
  await db.$transaction([
    db.invite.updateMany({ where: { groupId, memberId: row.id, acceptedAt: null, declinedAt: null }, data: { declinedAt: new Date() } }),
    db.requestKey.deleteMany({ where: { key: decoyKey(groupId, row.id) } }),
  ]);
  return { ok: true };
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// ---- Accepting that invitation ----

class Closed extends Error {}

export type ClaimResult = { ok: true; groupId: string; memberId: string } | { ok: false; error: string };

// "Join" on an invitation to a pair. In ONE transaction: the invitation closes, the name row becomes this account, and the pair's key
// becomes the account key. If these two people already share a pair, the key is taken: everything rolls back, the invitation is closed
// on its own, and nothing is merged.
export async function claimDirectInvite(
  account: { id: string; name: string; email: string },
  inv: { id: string; groupId: string; memberId: string; invitedById: string },
): Promise<ClaimResult> {
  const GONE = "This invitation is no longer there.";
  const group = await db.group.findUnique({ where: { id: inv.groupId }, include: { members: true } });
  if (!group || group.deletedAt || group.type !== DIRECT) return { ok: false, error: GONE };
  const sender = group.members.find((m) => m.id === inv.invitedById);
  const row = group.members.find((m) => m.id === inv.memberId);
  if (!sender?.accountId || !row || row.id === sender.id || row.accountId || row.claimedAt || row.removedAt) return { ok: false, error: GONE };
  if (sender.accountId === account.id) return { ok: false, error: GONE };
  if (await isBlockedEitherWay(account.id, sender.accountId)) return { ok: false, error: GONE };
  const newKey = accountPairKey(sender.accountId, account.id);
  try {
    await db.$transaction(async (tx) => {
      const closed = await tx.invite.updateMany({ where: { id: inv.id, acceptedAt: null, declinedAt: null }, data: { acceptedAt: new Date() } });
      if (closed.count !== 1) throw new Closed();
      const linked = await tx.member.updateMany({
        where: { id: row.id, accountId: null, claimedAt: null, removedAt: null },
        data: { accountId: account.id, claimedAt: new Date(), seenAt: new Date(), grantEpoch: { increment: 1 } },
      });
      if (linked.count !== 1) throw new Closed();
      await tx.group.update({ where: { id: group.id }, data: { pairKey: newKey } }); // a unique violation here rolls back all of it
    });
  } catch (err) {
    if (err instanceof Closed) return { ok: false, error: "This invitation is no longer open." };
    if (isUniqueViolation(err)) {
      await db.invite.updateMany({ where: { id: inv.id, acceptedAt: null, declinedAt: null }, data: { declinedAt: new Date() } });
      return { ok: false, error: `You and ${sender.name} already share expenses on Loopin, so this can’t be joined. Ask ${sender.name} to add these to that history.` };
    }
    throw err;
  }
  if (!account.name) await db.account.update({ where: { id: account.id }, data: { name: row.name } }).catch(() => undefined);
  await copyPushTo(account.id, row.id).catch(() => undefined);
  return { ok: true, groupId: group.id, memberId: row.id };
}

// Everyone you may start a pair with, named, plus those you already have one with (for the picker and tests).
export async function pairedAccountIds(accountId: string): Promise<Set<string>> {
  const rows = await db.member.findMany({
    where: { accountId, group: { type: DIRECT, deletedAt: null } },
    select: { group: { select: { members: { select: { accountId: true } } } } },
  });
  const out = new Set<string>();
  for (const r of rows) for (const m of r.group.members) if (m.accountId && m.accountId !== accountId) out.add(m.accountId);
  return out;
}
