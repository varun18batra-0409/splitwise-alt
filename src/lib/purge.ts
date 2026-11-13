import { db } from "./db";
import { RESTORE_DAYS } from "./group-data";
import type { Db } from "./events";

// Deleted groups: whoever deleted them or looks after them can restore them for 30 days (RESTORE_DAYS).
// After that, the daily job erases them for good, as the privacy page says:
// the group, its people, expenses, payments, history, bills, list, budgets,
// goals, deposit, photos, receipts and moments (with their photo files). Groups that were only closed are never touched.

export async function eraseExpiredGroups(now = new Date(), limit = 100): Promise<number> {
  const before = new Date(now.getTime() - RESTORE_DAYS * 86_400_000);
  const due = await db.group.findMany({ where: { deletedAt: { not: null, lt: before } }, select: { id: true }, take: limit });
  if (!due.length) return 0;
  // Re-checked inside the erase itself: a group restored a moment ago (after the list above was read) is left alone.
  return eraseGroups(due.map((g) => g.id), { onlyDeletedBefore: before });
}

// Bringing a deleted group back, only while it is still inside the 30 days. One conditional write, so it either wins against the
// erase (the group is alive again and the erase skips it) or loses to it (nothing to restore). True when the group came back.
export async function restoreIfInWindow(tx: Db, groupId: string, now = new Date()): Promise<boolean> {
  const windowStart = new Date(now.getTime() - RESTORE_DAYS * 86_400_000);
  const r = await tx.group.updateMany({ where: { id: groupId, deletedAt: { not: null, gte: windowStart } }, data: { deletedAt: null, deletedById: "" } });
  return r.count === 1;
}

// Everything that belongs to these groups, children first (doesn't rely on the
// database to cascade). Only ever called for groups already chosen above.
// Everything is read and deleted inside ONE transaction that starts with a write (so it holds the write lock): a photo
// whose file was copied to storage a moment ago (the photo migration), or a row added meanwhile, is seen and handled,
// not missed. `afterRead` is for tests only: it runs before the transaction begins.
// `onlyDeletedBefore` (the daily erase): the first write is conditional, limited to groups that are STILL deleted before that
// moment, and only those groups are erased. A group restored in between is not touched. Returns how many groups were erased.
export async function eraseGroups(allIds: string[], opts: { afterRead?: () => Promise<void>; onlyDeletedBefore?: Date } = {}): Promise<number> {
  let ids = allIds;
  const inG = () => ({ groupId: { in: ids } });
  let erased = 0;
  const { queuePhotoDeletes, flushPhotoDeletes } = await import("./photo-store");
  await opts.afterRead?.();
  await db.$transaction(
    async (tx) => {
      // First statement is a write: from here nobody else can commit until this finishes.
      if (opts.onlyDeletedBefore) {
        await tx.group.updateMany({ where: { id: { in: allIds }, deletedAt: { not: null, lt: opts.onlyDeletedBefore } }, data: { deletedById: "" } });
        // Who is still deleted past the cutoff, read now that the write lock is held. A restore that got in first is not in this list.
        ids = (await tx.group.findMany({ where: { id: { in: allIds }, deletedAt: { not: null, lt: opts.onlyDeletedBefore } }, select: { id: true } })).map((g) => g.id);
        if (!ids.length) return;
      }
      erased = ids.length;
      await tx.reaction.deleteMany({ where: { member: inG() } });
      // Photo files in file storage go too (group picture and bill photos). Their keys go on the to-delete list in the
      // same step as the rows: a failed delete is then tried again later, never forgotten.
      const moments = await tx.moment.findMany({ where: inG(), select: { id: true, blobKey: true, thumbKey: true } });
      const files = [
        ...(await tx.groupPhoto.findMany({ where: inG(), select: { blobKey: true } })),
        ...(await tx.receipt.findMany({ where: inG(), select: { blobKey: true } })),
      ].map((f) => f.blobKey);
      await queuePhotoDeletes(tx, [...files, ...moments.flatMap((m) => [m.blobKey, m.thumbKey])]);
      await tx.momentReaction.deleteMany({ where: { momentId: { in: moments.map((m) => m.id) } } });
      await tx.moment.deleteMany({ where: inG() });
      await tx.expenseShare.deleteMany({ where: { expense: inG() } });
      await tx.expenseItem.deleteMany({ where: { expense: inG() } });
      await tx.expense.deleteMany({ where: inG() });
      await tx.payment.deleteMany({ where: inG() });
      await tx.paymentClaim.deleteMany({ where: inG() });
      await tx.groupEvent.deleteMany({ where: inG() });
      await tx.pushSubscription.deleteMany({ where: { member: inG() } });
      await tx.invite.deleteMany({ where: inG() });
      await tx.payLink.deleteMany({ where: inG() });
      await tx.billRun.deleteMany({ where: { bill: inG() } });
      await tx.bill.deleteMany({ where: inG() });
      await tx.listItem.deleteMany({ where: inG() });
      await tx.budget.deleteMany({ where: inG() });
      await tx.goalEntry.deleteMany({ where: { goal: inG() } });
      await tx.goal.deleteMany({ where: inG() });
      await tx.depositShare.deleteMany({ where: { deposit: inG() } });
      await tx.deposit.deleteMany({ where: inG() });
      await tx.groupPhoto.deleteMany({ where: inG() });
      await tx.receipt.deleteMany({ where: inG() });
      await tx.potMove.deleteMany({ where: { game: inG() } });
      await tx.potGame.deleteMany({ where: inG() });
      await tx.member.deleteMany({ where: inG() });
      await tx.group.deleteMany({ where: { id: { in: ids } } });
    },
    { timeout: 30000 },
  );
  await flushPhotoDeletes();
  return erased;
}
