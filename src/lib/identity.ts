import { cache } from "react";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { JOINED, confirmUsedPending } from "./membership";
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

// Used inside a transaction (e.g. when an account is deleted and its members are unlinked): every old guest copy of
// these members' cookies stops working.
export async function bumpGrantEpochs(tx: Pick<Prisma.TransactionClient, "member">, memberIds: string[]) {
  if (memberIds.length) await tx.member.updateMany({ where: { id: { in: memberIds } }, data: { grantEpoch: { increment: 1 } } });
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
export async function setMyMemberId(groupId: string, memberId: string) {
  const s = await readSession();
  const acc = await readAccount();
  if (acc) {
    // Signed in: the group is linked to the account (kept in the database), so the cookie doesn't grow.
    // Linking ends every older guest copy of this name (their epoch no longer matches).
    const linked = await db.member.updateMany({ where: { id: memberId, OR: [{ accountId: null }, { accountId: acc.id }] }, data: { accountId: acc.id, grantEpoch: { increment: 1 } } });
    if (linked.count === 1) {
      const m = { ...s.m };
      delete m[groupId];
      await writeSession({ ...s, m });
      return;
    }
  }
  const row = await db.member.findUnique({ where: { id: memberId }, select: { grantEpoch: true } });
  await writeSession({ ...s, m: { ...s.m, [groupId]: grantValue(memberId, row?.grantEpoch ?? 0) } });
}

// After a successful email sign-in: everyone this phone already is joins the
// account, and the account's groups come to this phone.
export async function signInAs(accountId: string) {
  const s = await readSession();
  const entries = Object.values(s.m).map(parseGrant);
  // Only names this phone still holds validly (same epoch, not linked to anyone) join the account; an old copy can't.
  // Linking raises the epoch, so any other phone still holding the guest name loses it.
  for (const e of entries) await db.member.updateMany({ where: { id: e.id, accountId: null, grantEpoch: e.epoch }, data: { accountId, grantEpoch: { increment: 1 } } });
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

// "Sign out of this phone": forgets everything on this phone (your groups
// stay safe in your account).
export async function forgetThisPhone() {
  (await cookies()).delete(SESSION_COOKIE);
}
