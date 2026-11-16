import { cache } from "react";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { JOINED, confirmUsedPending } from "./membership";
import { coverFor } from "./covers";
import { PUSH_RESYNC_COOKIE, PUSH_RESYNC_MAX_AGE } from "./push-resync";
import { SESSION_COOKIE, SESSION_MAX_AGE, decodeSession, encodeSession, today, type Session } from "./session";

// Who you are on this phone: which person you are in each group, and (if you
// signed in with email) your account — whose groups then follow you to any
// phone. Stored in one signed cookie (see session.ts).

const readSession = cache(async (): Promise<Session> => {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  return (await decodeSession(raw)) ?? { m: {} };
});

async function writeSession(s: Session) {
  (await cookies()).set(SESSION_COOKIE, await encodeSession({ ...s, t: today() }), {
    httpOnly: true,
    sameSite: "lax",
    // Always secure when live. Only the automated browser tests on this machine (plain http) switch it off, so Safari keeps the cookie.
    secure: process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

// The signed-in account, if the cookie's sign-in is still current (not ended by
// "Sign out on all other phones" or by deleting the account).
const readAccount = cache(async () => {
  const s = await readSession();
  if (!s.a) return null;
  const acc = await db.account.findUnique({ where: { id: s.a } });
  if (!acc || (acc.sessionVersion ?? 0) !== (s.v ?? 0)) return null;
  return acc;
});

// A guest grant in the cookie is "memberId~epoch". The epoch is the member's grantEpoch when the grant was written; it
// goes up when the person is linked to an account and when that account is deleted, so an old copy of the cookie (on
// another phone) stops working. A plain id with no "~" is an older cookie and counts as epoch 0.
export function grantValue(memberId: string, epoch: number): string {
  return `${memberId}~${epoch}`;
}
export function parseGrant(v: string): { id: string; epoch: number } {
  const i = v.lastIndexOf("~");
  if (i < 1) return { id: v, epoch: 0 };
  const n = Number(v.slice(i + 1));
  return Number.isInteger(n) && n >= 0 ? { id: v.slice(0, i), epoch: n } : { id: v, epoch: 0 };
}

// A phone that loses a name must also stop hearing about it: when a name's epoch goes up, its notification rows go too,
// except `keepEndpoint` (the phone doing this, when the caller knows its address; that phone re-subscribes on its own anyway).
// This phone's own rows go too (the server can't tell which address is this phone's), so a short-lived note in a cookie
// makes the app put this phone's notifications back at once (see PushSync). The phone that lost access has no such note
// and isn't in the session's names any more, so it stays cut off.
async function dropPush(memberIds: string[], keepEndpoint?: string) {
  const r = await db.pushSubscription.deleteMany({ where: { memberId: { in: memberIds }, ...(keepEndpoint ? { endpoint: { not: keepEndpoint } } : {}) } });
  if (r.count > 0) await setPushResyncCookie();
}

// The note for this phone's app (see PushSync). Only works inside a server action or route handler; anywhere else it does nothing.
export async function setPushResyncCookie() {
  try {
    (await cookies()).set(PUSH_RESYNC_COOKIE, "1", {
      httpOnly: false, // the app's own script reads and clears it
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1",
      path: "/",
      maxAge: PUSH_RESYNC_MAX_AGE,
    });
  } catch {
    // outside a request (a script or a test): nothing to set
  }
}

// Used inside a transaction (e.g. when an account is deleted and its members are unlinked): every old guest copy of
// these members' cookies stops working, and so do their phone notifications.
export async function bumpGrantEpochs(tx: Pick<Prisma.TransactionClient, "member" | "pushSubscription">, memberIds: string[], opts: { keepEndpoint?: string } = {}) {
  if (!memberIds.length) return;
  await tx.member.updateMany({ where: { id: { in: memberIds } }, data: { grantEpoch: { increment: 1 } } });
  await tx.pushSubscription.deleteMany({ where: { memberId: { in: memberIds }, ...(opts.keepEndpoint ? { endpoint: { not: opts.keepEndpoint } } : {}) } });
}

// { groupId: memberId } for this phone, including every group of a signed-in account.
// A signed-in account's groups come from the database, not the cookie, so the
// cookie stays small however many groups someone is in.
// A name in the cookie only counts while it is still a guest name for that group: not linked to an email (unless this
// cookie is signed in as that very account), and with the same epoch the cookie was written with.
const resolveMemberships = cache(async (): Promise<{ out: Record<string, string>; linkedAway: string[] }> => {
  const s = await readSession();
  const acc = s.a ? await readAccount() : null;
  const out: Record<string, string> = {};
  const linkedAway: string[] = [];
  const entries = Object.entries(s.m).map(([groupId, v]) => ({ groupId, ...parseGrant(v) }));
  if (entries.length) {
    const rows = await db.member.findMany({ where: { id: { in: entries.map((e) => e.id) } }, select: { id: true, groupId: true, accountId: true, grantEpoch: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const e of entries) {
      const m = byId.get(e.id);
      if (!m || m.groupId !== e.groupId) continue;
      if (m.accountId) {
        if (acc && m.accountId === acc.id) out[e.groupId] = m.id;
        else linkedAway.push(e.groupId);
      } else if (m.grantEpoch === e.epoch) out[e.groupId] = m.id;
    }
  }
  if (acc) {
    // Only groups they have really joined: someone added straight in who hasn't answered yet (Join / Not now) isn't in it.
    // (An older person who has added an expense or payment there themselves has plainly joined: they stay in, and it is remembered.)
    await confirmUsedPending(acc.id);
    const mine = await db.member.findMany({ where: { accountId: acc.id, ...JOINED }, select: { id: true, groupId: true } });
    for (const m of mine) if (!out[m.groupId]) out[m.groupId] = m.id;
  }
  return { out, linkedAway: linkedAway.filter((g) => !out[g]) };
});

export const getMemberships = cache(async (): Promise<Record<string, string>> => ({ ...(await resolveMemberships()).out }));

// Groups this phone's old guest name was for, but that name is now linked to an email (so: "sign in with that email").
export async function getLinkedAwayGroups(): Promise<string[]> {
  return (await resolveMemberships()).linkedAway;
}

export async function getMyMemberId(groupId: string): Promise<string | undefined> {
  return (await getMemberships())[groupId];
}

export const getAccount = readAccount;

// Only works inside a server action (form submit) or route handler.
export async function setMyMemberId(groupId: string, memberId: string, opts: { keepEndpoint?: string } = {}) {
  const s = await readSession();
  const acc = await readAccount();
  if (acc) {
    // Signed in: the group is linked to the account (kept in the database), so the cookie doesn't grow.
    // Linking ends every older guest copy of this name (their epoch no longer matches).
    // Only a name that really changes hands raises the epoch and drops notifications. A name already linked to this very
    // account (for example just joined from an invitation, which copied this account's phones onto it) is left exactly as it is.
    const linked = await db.member.updateMany({ where: { id: memberId, accountId: null }, data: { accountId: acc.id, grantEpoch: { increment: 1 } } });
    if (linked.count === 1) await dropPush([memberId], opts.keepEndpoint);
    if (linked.count === 1 || (await db.member.count({ where: { id: memberId, accountId: acc.id } })) === 1) {
      const m = { ...s.m };
      delete m[groupId];
      await writeSession({ ...s, m });
      return;
    }
  }
  const row = await db.member.findUnique({ where: { id: memberId }, select: { grantEpoch: true } });
  await writeSession({ ...s, m: { ...s.m, [groupId]: grantValue(memberId, row?.grantEpoch ?? 0) } });
}

// The guest groups this phone holds right now (names not linked to any account, still valid on this phone): what
// signing in would move into the account, so the sign-in screens can list them first. Newest first, at most `limit`.
export type GuestGroup = { memberId: string; groupId: string; name: string; people: number; cover: { kind: string; src?: string }; letter: string };
export async function guestGroupsOnPhone(limit = 12): Promise<GuestGroup[]> {
  const held = Object.values((await resolveMemberships()).out);
  if (!held.length) return [];
  const rows = await db.member.findMany({
    where: { id: { in: held }, accountId: null, group: { deletedAt: null } },
    select: { id: true, group: { select: { id: true, name: true, cover: true, type: true, coverAt: true, createdAt: true, _count: { select: { members: { where: { leftAt: null } } } } } } },
  });
  return rows
    .sort((a, b) => b.group.createdAt.getTime() - a.group.createdAt.getTime())
    .slice(0, limit)
    .map((r) => ({ memberId: r.id, groupId: r.group.id, name: r.group.name, people: r.group._count.members, cover: coverFor(r.group), letter: r.group.name }));
}

// What the person agreed to move, as sent by the sign-in screens: a list of guest member ids. Anything that isn't a plain
// id string is dropped. (signInAs only ever moves names this phone really holds, so a made-up id does nothing.)
export function parseConfirmed(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  return [...new Set(list.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => x.length > 0 && x.length <= 64))].slice(0, 50);
}

// Google leaves the app and comes back, so what the person agreed to is kept for a few minutes in a cookie that only a
// form the person pressed (a server action) can set. The way back from Google reads it once and removes it.
const MOVE_COOKIE = "lp_move";
export async function setMoveConfirmation(ids: string[]) {
  (await cookies()).set(MOVE_COOKIE, ids.join(","), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1",
    path: "/api/auth/google",
    maxAge: 600,
  });
}
export async function takeMoveConfirmation(): Promise<string[]> {
  const jar = await cookies();
  const raw = jar.get(MOVE_COOKIE)?.value;
  jar.delete({ name: MOVE_COOKIE, path: "/api/auth/google" });
  return parseConfirmed(raw);
}

// After a successful sign-in (any way): the names in `confirmed` that this phone really holds join the account, and the
// account's groups come to this phone. Names the person did NOT confirm stay exactly as they were: guest names on this
// phone, not linked to anyone (so no confirmation, or an empty one, moves nothing). `confirmed` has no default on purpose.
export async function signInAs(accountId: string, opts: { confirmed: readonly string[]; keepEndpoint?: string }) {
  const s = await readSession();
  const entries = Object.values(s.m).map(parseGrant);
  const agreed = new Set(opts.confirmed);
  // Only names this phone still holds validly (same epoch, not linked to anyone) AND the person confirmed join the account;
  // an old copy can't. Linking raises the epoch, so any other phone still holding the guest name loses it.
  const nowLinked: string[] = [];
  for (const e of entries) {
    if (!agreed.has(e.id)) continue;
    const r = await db.member.updateMany({ where: { id: e.id, accountId: null, grantEpoch: e.epoch }, data: { accountId, grantEpoch: { increment: 1 } } });
    if (r.count === 1) nowLinked.push(e.id);
  }
  // Another phone that held one of these names as a guest no longer gets its notifications.
  if (nowLinked.length) await dropPush(nowLinked, opts.keepEndpoint);
  const ids = entries.map((e) => e.id);
  const acc = await db.account.findUnique({ where: { id: accountId }, select: { sessionVersion: true } });
  // Groups now linked to the account live in the database; the cookie keeps only the rest.
  const linked = ids.length ? new Set((await db.member.findMany({ where: { id: { in: ids }, accountId }, select: { id: true } })).map((m) => m.id)) : new Set<string>();
  const m = Object.fromEntries(Object.entries(s.m).filter(([, v]) => !linked.has(parseGrant(v).id)));
  await writeSession({ m, a: accountId, v: acc?.sessionVersion ?? 0 });
}

// "Sign out on all other phones": every other phone's sign-in stops working;
// this phone stays signed in.
export async function signOutOtherPhones() {
  const acc = await readAccount();
  if (!acc) return false;
  const s = await readSession();
  const next = await db.account.update({ where: { id: acc.id }, data: { sessionVersion: { increment: 1 } }, select: { sessionVersion: true } });
  await writeSession({ ...s, v: next.sessionVersion });
  return true;
}

// After deleting the account: this phone keeps every group it could see before (pass them in: work them out BEFORE
// deleting the account, which unlinks the names), just without the email link. Call this AFTER the account is deleted
// so the fresh grant epochs are written into the cookie.
export async function keepGroupsDropAccount(groups: Record<string, string>) {
  const ids = Object.values(groups);
  const rows = ids.length ? await db.member.findMany({ where: { id: { in: ids }, accountId: null }, select: { id: true, grantEpoch: true } }) : [];
  const epoch = new Map(rows.map((r) => [r.id, r.grantEpoch]));
  const m: Record<string, string> = {};
  for (const [groupId, id] of Object.entries(groups)) if (epoch.has(id)) m[groupId] = grantValue(id, epoch.get(id) ?? 0);
  await writeSession({ m });
}

// Where a group page sends someone who isn't in the group on this phone: "/private", or "/private?linked=1" when this
// phone's old guest name for the group is now linked to an email (so the page can say "sign in with that email").
export async function privatePath(groupId: string): Promise<string> {
  return (await getLinkedAwayGroups()).includes(groupId) ? "/private?linked=1" : "/private";
}

// "Sign out of this phone": forgets everything on this phone (your groups
// stay safe in your account).
export async function forgetThisPhone() {
  (await cookies()).delete(SESSION_COOKIE);
}
