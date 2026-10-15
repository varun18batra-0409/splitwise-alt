import webpush from "web-push";
import { db } from "./db";

// Phone notifications (Web Push). When someone changes something in a group,
// everyone else in it who turned notifications on gets a short message.
// The signing keys are created once and kept in the database, so no extra
// setup is needed when hosting.

const SUBJECT = process.env.PUSH_CONTACT ?? "mailto:hello@loopin.app";

export async function vapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const saved = await db.appSetting.findUnique({ where: { key: "vapid" } });
  if (saved) return JSON.parse(saved.value);
  const fresh = webpush.generateVAPIDKeys();
  try {
    await db.appSetting.create({ data: { key: "vapid", value: JSON.stringify(fresh) } });
    return fresh;
  } catch {
    // Someone else created them at the same moment: use theirs.
    const again = await db.appSetting.findUniqueOrThrow({ where: { key: "vapid" } });
    return JSON.parse(again.value);
  }
}

// The text of a notification. Pure, so it can be tested.
export function pushPayload(e: { groupId: string; groupName: string; actorName: string; text: string; eventId: string }) {
  const body = `${e.actorName} ${e.text}`;
  return {
    title: e.groupName,
    body: body.length > 140 ? `${body.slice(0, 139)}…` : body,
    url: `/groups/${e.groupId}?tab=activity`,
    tag: e.eventId,
  };
}

// Send one change to everyone else in the group. Never throws.
export async function sendEventPush(eventId: string): Promise<number> {
  try {
    const ev = await db.groupEvent.findUnique({ where: { id: eventId }, include: { group: { select: { id: true, name: true } } } });
    if (!ev) return 0;
    const subs = await db.pushSubscription.findMany({
      where: { member: { groupId: ev.groupId }, memberId: { not: ev.actorId } },
    });
    if (subs.length === 0) return 0;
    const actor = await db.member.findUnique({ where: { id: ev.actorId }, select: { name: true } });
    const payload = JSON.stringify(
      pushPayload({ groupId: ev.group.id, groupName: ev.group.name, actorName: actor?.name ?? "Someone", text: ev.text, eventId }),
    );
    const keys = await vapidKeys();
    let sent = 0;
    const seen = new Set<string>(); // one phone can be several people in one group: notify once
    for (const s of subs) {
      if (seen.has(s.endpoint)) continue;
      seen.add(s.endpoint);
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          vapidDetails: { subject: SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 60 * 60 * 24,
        });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
      }
    }
    return sent;
  } catch {
    return 0;
  }
}
