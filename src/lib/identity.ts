import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "./db";
import { SESSION_COOKIE, SESSION_MAX_AGE, decodeSession, encodeSession, type Session } from "./session";

// Who you are on this phone: which person you are in each group, and (if you
// signed in with email) your account — whose groups then follow you to any
// phone. Stored in one signed cookie (see session.ts).

const readSession = cache(async (): Promise<Session> => {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  return (await decodeSession(raw)) ?? { m: {} };
});

async function writeSession(s: Session) {
  (await cookies()).set(SESSION_COOKIE, await encodeSession(s), {
    httpOnly: true,
    sameSite: "lax",
    // Always secure when live. Only the automated browser tests on this machine (plain http) switch it off, so Safari keeps the cookie.
    secure: process.env.NODE_ENV === "production" && process.env.E2E_PLAIN_HTTP !== "1",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

// { groupId: memberId } for this phone, including every group of a signed-in account.
export const getMemberships = cache(async (): Promise<Record<string, string>> => {
  const s = await readSession();
  const out = { ...s.m };
  if (s.a) {
    const mine = await db.member.findMany({ where: { accountId: s.a }, select: { id: true, groupId: true } });
    for (const m of mine) if (!out[m.groupId]) out[m.groupId] = m.id;
  }
  return out;
});

export async function getMyMemberId(groupId: string): Promise<string | undefined> {
  return (await getMemberships())[groupId];
}

export const getAccount = cache(async () => {
  const s = await readSession();
  return s.a ? db.account.findUnique({ where: { id: s.a } }) : null;
});

// Only works inside a server action (form submit) or route handler.
export async function setMyMemberId(groupId: string, memberId: string) {
  const s = await readSession();
  const next: Session = { ...s, m: { ...s.m, [groupId]: memberId } };
  if (s.a) await db.member.updateMany({ where: { id: memberId, accountId: null }, data: { accountId: s.a } });
  await writeSession(next);
}

// After a successful email sign-in: everyone this phone already is joins the
// account, and the account's groups come to this phone.
export async function signInAs(accountId: string) {
  const s = await readSession();
  const ids = Object.values(s.m);
  if (ids.length) await db.member.updateMany({ where: { id: { in: ids }, accountId: null }, data: { accountId } });
  await writeSession({ m: s.m, a: accountId });
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
