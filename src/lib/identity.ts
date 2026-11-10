import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "./db";
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

// { groupId: memberId } for this phone, including every group of a signed-in account.
// A signed-in account's groups come from the database, not the cookie, so the
// cookie stays small however many groups someone is in.
export const getMemberships = cache(async (): Promise<Record<string, string>> => {
  const s = await readSession();
  const out = { ...s.m };
  if (s.a) {
    const acc = await readAccount();
    if (acc) {
      const mine = await db.member.findMany({ where: { accountId: acc.id }, select: { id: true, groupId: true } });
      for (const m of mine) if (!out[m.groupId]) out[m.groupId] = m.id;
    } else {
      // Signed out elsewhere: anything on this phone that belongs to that account goes too.
      const ids = Object.values(s.m);
      if (ids.length) {
        const theirs = await db.member.findMany({ where: { id: { in: ids }, accountId: s.a }, select: { groupId: true } });
        for (const m of theirs) delete out[m.groupId];
      }
    }
  }
  return out;
});

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
    const linked = await db.member.updateMany({ where: { id: memberId, OR: [{ accountId: null }, { accountId: acc.id }] }, data: { accountId: acc.id } });
    if (linked.count === 1) {
      const m = { ...s.m };
      delete m[groupId];
      await writeSession({ ...s, m });
      return;
    }
  }
  await writeSession({ ...s, m: { ...s.m, [groupId]: memberId } });
}

// After a successful email sign-in: everyone this phone already is joins the
// account, and the account's groups come to this phone.
export async function signInAs(accountId: string) {
  const s = await readSession();
  const ids = Object.values(s.m);
  if (ids.length) await db.member.updateMany({ where: { id: { in: ids }, accountId: null }, data: { accountId } });
  const acc = await db.account.findUnique({ where: { id: accountId }, select: { sessionVersion: true } });
  // Groups now linked to the account live in the database; the cookie keeps only the rest.
  const linked = ids.length ? new Set((await db.member.findMany({ where: { id: { in: ids }, accountId }, select: { id: true } })).map((m) => m.id)) : new Set<string>();
  const m = Object.fromEntries(Object.entries(s.m).filter(([, id]) => !linked.has(id)));
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

// After deleting the account: this phone keeps every group it can see now,
// just without the email link.
export async function keepGroupsDropAccount() {
  const all = await getMemberships();
  await writeSession({ m: all });
}

// "Sign out of this phone": forgets everything on this phone (your groups
// stay safe in your account).
export async function forgetThisPhone() {
  (await cookies()).delete(SESSION_COOKIE);
}
