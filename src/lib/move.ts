import { randomBytes } from "node:crypto";
import { db } from "./db";
import { decodeSession } from "./session";
import { parseGrant } from "./identity";

// Moving someone's sign-in from the old address to the new one: a one-time
// pass, random, usable once, for two minutes. Only a valid (signed) session
// is ever carried.

const PASS_MS = 2 * 60_000;

export async function createMovePass(sessionRaw: string | undefined, tourSeen: boolean): Promise<string | null> {
  if (!sessionRaw || !(await decodeSession(sessionRaw))) return null;
  const token = randomBytes(24).toString("base64url");
  await db.requestKey.create({ data: { key: `move:${token}`, result: JSON.stringify({ s: sessionRaw, t: tourSeen ? 1 : 0 }) } });
  return token;
}

const TOKEN_OK = /^[A-Za-z0-9_-]{20,64}$/;
export const looksLikePass = (t: string | null | undefined): t is string => Boolean(t && TOKEN_OK.test(t));

// Look at a pass without using it up: the first name of the person it would sign in
// and the account's email when there is one (null when it is unknown, used, expired or not a real sign-in). The confirm page
// uses this, so opening or prefetching the link never spends the pass.
export async function peekMovePass(token: string | null | undefined, now = new Date()): Promise<{ firstName: string; email: string } | null> {
  if (!looksLikePass(token)) return null;
  const row = await db.requestKey.findUnique({ where: { key: `move:${token}` } });
  if (!row || now.getTime() - row.createdAt.getTime() > PASS_MS) return null;
  try {
    const v = JSON.parse(row.result) as { s?: string };
    const session = v.s ? await decodeSession(v.s) : null;
    if (!session) return null;
    let name = "";
    let email = "";
    if (session.a) {
      const acc = await db.account.findUnique({ where: { id: session.a }, select: { name: true, email: true } });
      name = acc?.name ?? "";
      email = acc?.email ?? "";
    }
    if (!name.trim()) {
      const ids = Object.values(session.m).map((v) => parseGrant(v).id); // a cookie value is "id~epoch"
      if (ids.length) name = (await db.member.findFirst({ where: { id: { in: ids } }, select: { name: true } }))?.name ?? "";
    }
    return { firstName: name.trim().split(/\s+/)[0] ?? "", email };
  } catch {
    return null;
  }
}

export async function redeemMovePass(token: string | null | undefined, now = new Date()): Promise<{ session: string; tourSeen: boolean } | null> {
  if (!looksLikePass(token)) return null;
  const key = `move:${token}`;
  const row = await db.requestKey.findUnique({ where: { key } });
  if (!row) return null;
  // Single use: whoever deletes it first gets it.
  const gone = await db.requestKey.deleteMany({ where: { key } });
  if (gone.count !== 1 || now.getTime() - row.createdAt.getTime() > PASS_MS) return null;
  try {
    const v = JSON.parse(row.result) as { s?: string; t?: number };
    if (!v.s || !(await decodeSession(v.s))) return null;
    return { session: v.s, tourSeen: v.t === 1 };
  } catch {
    return null;
  }
}
