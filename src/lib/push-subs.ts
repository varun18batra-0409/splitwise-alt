import { db } from "./db";

export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };

// Phone notifications only go to the big browser push services. A stored address is checked again before every send,
// so a row that was saved before this rule (or copied from another account) can never point the server at anything else.
const PUSH_HOSTS = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);

export function pushHostOk(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  if (u.port !== "" && u.port !== "443") return false;
  return PUSH_HOSTS.has(u.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname);
}

// The host only (never the full address, which holds the phone's private token) for logs.
export function pushHostForLog(endpoint: string): string {
  try {
    return new URL(endpoint).hostname.slice(0, 80) || "unknown";
  } catch {
    return "unparseable";
  }
}

function keyBytes(v: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(v) && !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  return Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, ""), "base64");
}

export function validSub(sub: unknown): PushSub | null {
  const s = sub as PushSub | null;
  const endpoint = String(s?.endpoint ?? "");
  const p256dh = String(s?.keys?.p256dh ?? "");
  const auth = String(s?.keys?.auth ?? "");
  if (endpoint.length > 2000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) return null;
  if (!pushHostOk(endpoint)) return null;
  const pk = keyBytes(p256dh);
  const au = keyBytes(auth);
  if (!pk || pk.length !== 65 || pk[0] !== 0x04 || !au || au.length !== 16) return null;
  return { endpoint, keys: { p256dh, auth } };
}

// This phone's notifications for every group it's in, in a few queries at most
// (it used to be one write per group, every time the app opened).
export async function savePushFor(memberships: Record<string, string>, sub: PushSub): Promise<{ ok: boolean; groups: number; added: number }> {
  const members = await db.member.findMany({ where: { id: { in: Object.values(memberships) } }, select: { id: true, groupId: true } });
  const mine = members.filter((m) => memberships[m.groupId] === m.id).map((m) => m.id);
  if (!mine.length) return { ok: true, groups: 0, added: 0 };
  const { endpoint, keys } = sub;
  const have = await db.pushSubscription.findMany({ where: { endpoint, memberId: { in: mine } }, select: { memberId: true, p256dh: true, auth: true } });
  const missing = mine.filter((id) => !have.some((h) => h.memberId === id));
  const stale = have.some((h) => h.p256dh !== keys.p256dh || h.auth !== keys.auth);
  if (missing.length || stale) {
    await db.$transaction(async (tx) => {
      if (missing.length) await tx.pushSubscription.createMany({ data: missing.map((memberId) => ({ memberId, endpoint, p256dh: keys.p256dh, auth: keys.auth })) });
      if (stale) await tx.pushSubscription.updateMany({ where: { endpoint, memberId: { in: mine } }, data: { p256dh: keys.p256dh, auth: keys.auth } });
    });
  }
  return { ok: true, groups: mine.length, added: missing.length };
}
