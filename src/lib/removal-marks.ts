import { db } from "./db";
import type { Db } from "./events";
import { emailFingerprint } from "./fingerprint";

// Someone the admin removed from a group, who then deletes their account and signs up again with the same email, would look like a
// stranger to the group. So when an account is deleted, each group that removed it keeps a note: "removed:<groupId>:<fingerprint of
// the email>" in the settings table, holding when and by whom. Only a keyed fingerprint is kept, never the email. The note is erased
// with the group (purge.ts), and when the admin invites the person back and they accept.

const keyOf = (groupId: string, email: string) => `removed:${groupId}:${emailFingerprint("removed", email)}`;

export type RemovalMark = { at: Date; by: string };

// Called inside deleteAccount, before the account's people are unlinked.
export async function markRemovals(tx: Db, accountId: string, email: string): Promise<void> {
  const rows = await tx.member.findMany({ where: { accountId, removedAt: { not: null } }, select: { groupId: true, removedAt: true, removedById: true } });
  for (const r of rows) {
    const value = JSON.stringify({ at: r.removedAt!.toISOString(), by: r.removedById });
    await tx.appSetting.upsert({ where: { key: keyOf(r.groupId, email) }, create: { key: keyOf(r.groupId, email), value }, update: { value } });
  }
}

export async function removedByEmail(groupId: string, email: string): Promise<RemovalMark | null> {
  const row = await db.appSetting.findUnique({ where: { key: keyOf(groupId, email) } });
  if (!row) return null;
  try {
    const v = JSON.parse(row.value) as { at?: string; by?: string };
    const at = new Date(v.at ?? "");
    return Number.isNaN(at.getTime()) ? { at: new Date(0), by: v.by ?? "" } : { at, by: v.by ?? "" };
  } catch {
    return null;
  }
}

export async function clearRemovalMark(groupId: string, email: string): Promise<void> {
  await db.appSetting.deleteMany({ where: { key: keyOf(groupId, email) } });
}
