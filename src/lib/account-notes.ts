import { db } from "./db";
import { sendPushToAccounts } from "./push";
import { noteItem } from "./account-notify";

// Notifications for a person (not a group): saved for Alerts, and sent to
// their phones when they want collection notifications. Never throws.
// `fromAccountId`: set when the note comes from another person's direct action (postcard, passport, nudge):
// people who blocked that person (or were blocked by them) get nothing, not even in Alerts.
export type Note = { accountIds: string[]; kind: string; title: string; body: string; url: string; tag: string; fromAccountId?: string };

export async function deliverNotes(notes: Note[]) {
  for (const n of notes) {
    try {
      let ids = [...new Set(n.accountIds.filter(Boolean))];
      if (n.fromAccountId) {
        const { blockedEitherWay } = await import("./blocks");
        const blocked = await blockedEitherWay(n.fromAccountId);
        ids = ids.filter((id) => !blocked.has(id));
      }
      if (!ids.length) continue;
      const real = await db.account.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (!real.length) continue;
      await db.accountNote.createMany({ data: real.map((a) => ({ accountId: a.id, kind: n.kind, title: n.title.slice(0, 80), body: n.body.slice(0, 300), url: n.url })) });
      await sendPushToAccounts(real.map((a) => a.id), n, noteItem(n.kind));
    } catch {
      // a notification must never break the action that caused it
    }
  }
}

export async function loadNotes(accountId: string, limit = 50) {
  return db.accountNote.findMany({ where: { accountId }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function countUnseenNotes(accountId: string): Promise<number> {
  return db.accountNote.count({ where: { accountId, seenAt: null } });
}

export async function markNotesSeen(accountId: string) {
  await db.accountNote.updateMany({ where: { accountId, seenAt: null }, data: { seenAt: new Date() } });
}
