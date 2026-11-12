import { db } from "./db";
import { RESTORE_DAYS } from "./group-data";

// Deleted groups: whoever deleted them or looks after them can restore them for 30 days (RESTORE_DAYS).
// After that, the daily job erases them for good, as the privacy page says:
// the group, its people, expenses, payments, history, bills, list, budgets,
// goals, deposit, photos and receipts. Groups that were only closed are never touched.

export async function eraseExpiredGroups(now = new Date(), limit = 100): Promise<number> {
  const before = new Date(now.getTime() - RESTORE_DAYS * 86_400_000);
  const due = await db.group.findMany({ where: { deletedAt: { not: null, lt: before } }, select: { id: true }, take: limit });
  if (!due.length) return 0;
  await eraseGroups(due.map((g) => g.id));
  return due.length;
}

// Everything that belongs to these groups, children first (doesn't rely on the
// database to cascade). Only ever called for groups already chosen above.
// Everything is read and deleted inside ONE transaction that starts with a write (so it holds the write lock): a photo
// whose file was copied to storage a moment ago (the photo migration), or a row added meanwhile, is seen and handled,
// not missed. `afterRead` is for tests only: it runs before the transaction begins.
export async function eraseGroups(ids: string[], opts: { afterRead?: () => Promise<void> } = {}) {
  const inG = { groupId: { in: ids } };
  const { queuePhotoDeletes, flushPhotoDeletes } = await import("./photo-store");
  await opts.afterRead?.();
  await db.$transaction(
    async (tx) => {
      // First statement is a write: from here nobody else can commit until this finishes.
      await tx.reaction.deleteMany({ where: { member: inG } });
      // Photo files in file storage go too (group picture and bill photos). Their keys go on the to-delete list in the
      // same step as the rows: a failed delete is then tried again later, never forgotten.
      const files = [
        ...(await tx.groupPhoto.findMany({ where: inG, select: { blobKey: true } })),
        ...(await tx.receipt.findMany({ where: inG, select: { blobKey: true } })),
      ].map((f) => f.blobKey);
      await queuePhotoDeletes(tx, files);
      await tx.expenseShare.deleteMany({ where: { expense: inG } });
      await tx.expenseItem.deleteMany({ where: { expense: inG } });
      await tx.expense.deleteMany({ where: inG });
      await tx.payment.deleteMany({ where: inG });
      await tx.paymentClaim.deleteMany({ where: inG });
      await tx.groupEvent.deleteMany({ where: inG });
      await tx.pushSubscription.deleteMany({ where: { member: inG } });
      await tx.invite.deleteMany({ where: inG });
      await tx.payLink.deleteMany({ where: inG });
      await tx.billRun.deleteMany({ where: { bill: inG } });
      await tx.bill.deleteMany({ where: inG });
      await tx.listItem.deleteMany({ where: inG });
      await tx.budget.deleteMany({ where: inG });
      await tx.goalEntry.deleteMany({ where: { goal: inG } });
      await tx.goal.deleteMany({ where: inG });
      await tx.depositShare.deleteMany({ where: { deposit: inG } });
      await tx.deposit.deleteMany({ where: inG });
      await tx.groupPhoto.deleteMany({ where: inG });
      await tx.receipt.deleteMany({ where: inG });
      await tx.potMove.deleteMany({ where: { game: inG } });
      await tx.potGame.deleteMany({ where: inG });
      await tx.member.deleteMany({ where: inG });
      await tx.group.deleteMany({ where: { id: { in: ids } } });
    },
    { timeout: 30000 },
  );
  await flushPhotoDeletes();
}
