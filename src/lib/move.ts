import { randomBytes } from "node:crypto";
import { db } from "./db";
import { decodeSession } from "./session";

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

export async function redeemMovePass(token: string | null | undefined, now = new Date()): Promise<{ session: string; tourSeen: boolean } | null> {
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
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
