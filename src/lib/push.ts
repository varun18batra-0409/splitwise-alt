import { parseNotify, wantsPush } from "./notify-prefs";
import webpush from "web-push";
import { db } from "./db";

// Phone notifications (Web Push). When someone changes something in a group,
// everyone else in it who turned notifications on gets a short message.
// The signing keys are created once and kept in the database, so no extra
// setup is needed when hosting.

const SUBJECT = process.env.PUSH_CONTACT ?? "mailto:hello@loopinapps.com";

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
// A small sign for what kind of change it was, so it's clear at a glance.
const SIGN: Record<string, string> = {
  expense_added: "🧾", expense_edited: "✏️", expense_deleted: "🗑️", expense_restored: "↩️",
  payment_recorded: "💸", payment_deleted: "🗑️", payment_restored: "↩️",
  members_added: "👋", member_invited: "✉️", members_removed: "👤", member_left: "👤", member_rejoined: "👋", member_renamed: "✏️",
  group_settled_closed: "✅", group_closed: "📦", group_reopened: "📂", group_imported: "📥", group_deleted: "🗑️", group_restored: "↩️",
  split_changed: "⚖️",
  bill_added: "🧾",
  bill_changed: "🧾",
};
export function pushPayload(e: { groupId: string; groupName: string; actorName: string; text: string; eventId: string; kind?: string }) {
  const body = `${e.actorName} ${e.text}`;
  const sign = e.kind ? SIGN[e.kind] ?? "⚙️" : "";
  return {
    title: sign ? `${sign} ${e.groupName}` : e.groupName,
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
    // Everyone else still in the group whose settings want this kind of change —
    // never the phone that made the change (even if it's someone else here too).
    const [all, own] = await Promise.all([
      db.pushSubscription.findMany({
        where: { member: { groupId: ev.groupId, leftAt: null }, memberId: { not: ev.actorId } },
        include: { member: { select: { notify: true } } },
      }),
      db.pushSubscription.findMany({ where: { memberId: ev.actorId }, select: { endpoint: true } }),
    ]);
    const actorPhones = new Set(own.map((o) => o.endpoint));
    const subs = all.filter((s) => !actorPhones.has(s.endpoint) && wantsPush(parseNotify(s.member.notify), ev.kind));
    if (subs.length === 0) return 0;
    const actor = await db.member.findUnique({ where: { id: ev.actorId }, select: { name: true } });
    const payload = JSON.stringify(
      pushPayload({ groupId: ev.group.id, groupName: ev.group.name, actorName: actor?.name ?? "Someone", text: ev.text, eventId, kind: ev.kind }),
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

// Send a message to particular people (reminders, budget alerts…), on every
// phone they turned notifications on for in that group. Never throws.
export async function sendPushTo(memberIds: string[], p: { title: string; body: string; url: string; tag: string }): Promise<number> {
  try {
    if (memberIds.length === 0) return 0;
    const subs = await db.pushSubscription.findMany({ where: { memberId: { in: memberIds } }, include: { member: { select: { notify: true } } } });
    const wanted = subs.filter((s) => !parseNotify(s.member.notify).off);
    if (wanted.length === 0) return 0;
    const keys = await vapidKeys();
    const payload = JSON.stringify({ title: p.title, body: p.body.length > 140 ? `${p.body.slice(0, 139)}…` : p.body, url: p.url, tag: p.tag });
    let sent = 0;
    const seen = new Set<string>();
    for (const s of wanted) {
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

// Once only: true the first time a key is claimed (e.g. "reminders:2026-10-19").
export async function claimOnce(key: string): Promise<boolean> {
  try {
    await db.notifyLog.create({ data: { key } });
    return true;
  } catch {
    return false;
  }
}
