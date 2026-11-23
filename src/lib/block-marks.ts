import { db } from "./db";
import type { Db } from "./events";
import { emailFingerprint } from "./fingerprint";

// A block survives the blocked person deleting their account and signing up again with the same email. The settings table holds
// "blockfp:<fingerprint of the blocked email>:<blocker's account id>" (a keyed fingerprint, never the email), holding the day it was made or last refreshed. When an account is
// created with an email that matches, the blocks are put back. The note has no expiry (founder decision D-2): it goes only when the blocker
// unblocks or deletes their own account.

const PREFIX = "blockfp:";
const fp = (email: string) => emailFingerprint("block", email);
const keyOf = (email: string, blockerId: string) => `${PREFIX}${fp(email)}:${blockerId}`;

// `tx`: inside the transaction that makes (or ends) the block, so the block and its note are written together or not at all.
export async function markBlock(blockerId: string, blockedEmail: string, tx: Db = db): Promise<void> {
  const key = keyOf(blockedEmail, blockerId);
  await tx.appSetting.upsert({ where: { key }, create: { key, value: new Date().toISOString() }, update: {} });
}

export async function unmarkBlock(blockerId: string, blockedEmail: string, tx: Db = db): Promise<void> {
  await tx.appSetting.deleteMany({ where: { key: keyOf(blockedEmail, blockerId) } });
}

// Inside deleteAccount, before the blocks against this account are deleted: every blocker keeps a fingerprint of this email
// (blocks made before this existed get theirs now).
export async function markBlocksOfDeleted(tx: Db, accountId: string, email: string): Promise<void> {
  const rows = await tx.block.findMany({ where: { blockedId: accountId }, select: { blockerId: true } });
  for (const r of rows) {
    const key = keyOf(email, r.blockerId);
    const now = new Date().toISOString();
    await tx.appSetting.upsert({ where: { key }, create: { key, value: now }, update: { value: now } });
  }
}

// Inside deleteAccount: the blocker's own account is going, so the notes they hold go too.
export async function dropBlockMarksOf(tx: Db, blockerId: string): Promise<void> {
  await tx.appSetting.deleteMany({ where: { key: { startsWith: PREFIX, endsWith: `:${blockerId}` } } });
}

// A new account is being created with this email: put back the blocks people had against that address (only from blockers who still
// exist). Runs inside the same transaction that creates the account (auth.ts accountForEmail), so either both happen or neither does.
export async function reapplyBlocks(tx: Db, accountId: string, email: string): Promise<number> {
  const prefix = `${PREFIX}${fp(email)}:`;
  const rows = await tx.appSetting.findMany({ where: { key: { startsWith: prefix } }, select: { key: true }, orderBy: { key: "asc" }, take: 500 });
  const blockerIds = rows.map((r) => r.key.slice(prefix.length)).filter((id) => id && id !== accountId);
  if (!blockerIds.length) return 0;
  const real = await tx.account.findMany({ where: { id: { in: blockerIds } }, select: { id: true } });
  for (const b of real) {
    await tx.block.upsert({ where: { blockerId_blockedId: { blockerId: b.id, blockedId: accountId } }, create: { blockerId: b.id, blockedId: accountId }, update: {} });
  }
  // Notes whose blocker no longer exists are tidied away.
  const gone = blockerIds.filter((id) => !real.some((r) => r.id === id));
  if (gone.length) await tx.appSetting.deleteMany({ where: { key: { in: gone.map((id) => `${prefix}${id}`) } } });
  return real.length;
}
