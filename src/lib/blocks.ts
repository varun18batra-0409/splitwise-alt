import { db } from "./db";
import { markBlock, unmarkBlock } from "./block-marks";

// Blocking works both ways: neither person can find, add, invite, send to or hear from the other (postcards, passports, nudges,
// invitations, their notifications and Alerts). Payment alerts are the one exception (they still arrive, so a wrong payment can be
// caught). Groups, expenses and balances are never touched.

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

// May this person open this postcard? The sender always can. The person it went to can't once either of them has blocked
// the other, even for a card sent before the block.
export async function canViewPostcard(viewerId: string, card: { fromId: string; toId: string }): Promise<boolean> {
  if (card.fromId !== viewerId && card.toId !== viewerId) return false;
  if (card.fromId === viewerId) return true;
  return !(await isBlockedEitherWay(viewerId, card.fromId));
}

// Idempotent: blocking twice is the same as once. You can't block yourself or someone who isn't on Loopin.
export async function blockAccount(blockerId: string, blockedId: string): Promise<boolean> {
  if (!blockerId || !blockedId || blockerId === blockedId) return false;
  const target = await db.account.findUnique({ where: { id: blockedId }, select: { email: true } });
  if (!target) return false;
  // One transaction: the block, the note that lets it survive a re-signup, and the end of "Want to go" sharing go together or not at all.
  await db.$transaction(async (tx) => {
    await tx.block.upsert({ where: { blockerId_blockedId: { blockerId, blockedId } }, create: { blockerId, blockedId }, update: {} });
    // The block survives them deleting their account and signing up again with this email: only a scrambled fingerprint of the email is kept.
    await markBlock(blockerId, target.email, tx);
    // "Want to go" shares between the two end, both ways. Unblocking does not bring them back: share again if you want to.
    await tx.wishShare.deleteMany({ where: { OR: [{ ownerId: blockerId, friendId: blockedId }, { ownerId: blockedId, friendId: blockerId }] } });
  });
  return true;
}

export async function unblockAccount(blockerId: string, blockedId: string): Promise<void> {
  const target = await db.account.findUnique({ where: { id: blockedId }, select: { email: true } });
  // One transaction: the block and its note end together.
  await db.$transaction(async (tx) => {
    await tx.block.deleteMany({ where: { blockerId, blockedId } });
    if (target) await unmarkBlock(blockerId, target.email, tx);
  });
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
