import { db } from "./db";

export type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } };

export function validSub(sub: unknown): PushSub | null {
  const s = sub as PushSub | null;
  const endpoint = String(s?.endpoint ?? "");
  const p256dh = String(s?.keys?.p256dh ?? "");
  const auth = String(s?.keys?.auth ?? "");
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) return null;
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
