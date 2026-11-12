import { db } from "./db";

// Blocking: one person stops hearing from another. It only ever affects what people send each other directly
// (postcards, passports, nudges, their pushes). Groups, expenses and balances are never touched.

// Everyone this person has blocked.
export async function blockedByMe(accountId: string): Promise<string[]> {
  const rows = await db.block.findMany({ where: { blockerId: accountId }, select: { blockedId: true }, take: 1000 });
  return rows.map((r) => r.blockedId);
}

// Everyone with a block between them and this person, whichever way round.
export async function blockedEitherWay(accountId: string): Promise<Set<string>> {
  const rows = await db.block.findMany({ where: { OR: [{ blockerId: accountId }, { blockedId: accountId }] }, select: { blockerId: true, blockedId: true }, take: 2000 });
  return new Set(rows.map((r) => (r.blockerId === accountId ? r.blockedId : r.blockerId)));
}

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  return Boolean(await db.block.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] }, select: { id: true } }));
}

// Has `blockerId` blocked `blockedId`? (One direction only.)
export async function hasBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  if (!blockerId || !blockedId || blockerId === blockedId) return false;
  return Boolean(await db.block.findFirst({ where: { blockerId, blockedId }, select: { id: true } }));
}

// Everyone who has blocked this person (they are not told about this person's activity).
export async function blockersOf(accountId: string): Promise<Set<string>> {
  const rows = await db.block.findMany({ where: { blockedId: accountId }, select: { blockerId: true }, take: 2000 });
  return new Set(rows.map((r) => r.blockerId));
}

// Idempotent: blocking twice is the same as once. You can't block yourself or someone who isn't on Loopin.
export async function blockAccount(blockerId: string, blockedId: string): Promise<boolean> {
  if (!blockerId || !blockedId || blockerId === blockedId) return false;
  if (!(await db.account.findUnique({ where: { id: blockedId }, select: { id: true } }))) return false;
  await db.block.upsert({ where: { blockerId_blockedId: { blockerId, blockedId } }, create: { blockerId, blockedId }, update: {} });
  return true;
}

export async function unblockAccount(blockerId: string, blockedId: string): Promise<void> {
  await db.block.deleteMany({ where: { blockerId, blockedId } });
}

// Have these two people been in a group together? (Used so a report or block can only point at someone you actually know.)
export async function sharesGroup(a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  return Boolean(
    await db.member.findFirst({ where: { accountId: b, group: { deletedAt: null, members: { some: { accountId: a } } } }, select: { id: true } }),
  );
}

// New postcards waiting for this person (sealed ones not counted), without anything from people they blocked or who blocked them.
export async function unreadPostcards(accountId: string): Promise<number> {
  const hidden = [...(await blockedEitherWay(accountId))];
  return db.postcard.count({ where: { toId: accountId, fromId: { notIn: hidden }, readAt: null, OR: [{ opensAt: null }, { opensAt: { lte: new Date() } }] } });
}
