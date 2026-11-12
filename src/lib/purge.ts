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
export async function eraseGroups(ids: string[]) {
  const inG = { groupId: { in: ids } };
  const memberIds = (await db.member.findMany({ where: inG, select: { id: true } })).map((m) => m.id);
  // Photo files in file storage go too (group picture and bill photos).
  const files = [
    ...(await db.groupPhoto.findMany({ where: inG, select: { blobKey: true } })),
    ...(await db.receipt.findMany({ where: inG, select: { blobKey: true } })),
  ].map((f) => f.blobKey);
  const { photoTrashOps, flushPhotoDeletes } = await import("./photo-store");
  // The files' keys go on the to-delete list in the same step as the rows: a failed
  // delete is then tried again later, never forgotten.
  await db.$transaction([
    ...(await photoTrashOps(files)),
    db.reaction.deleteMany({ where: { memberId: { in: memberIds } } }),
    db.expenseShare.deleteMany({ where: { expense: inG } }),
    db.expenseItem.deleteMany({ where: { expense: inG } }),
    db.expense.deleteMany({ where: inG }),
    db.payment.deleteMany({ where: inG }),
    db.paymentClaim.deleteMany({ where: inG }),
    db.groupEvent.deleteMany({ where: inG }),
    db.pushSubscription.deleteMany({ where: { member: inG } }),
    db.invite.deleteMany({ where: inG }),
    db.billRun.deleteMany({ where: { bill: inG } }),
    db.bill.deleteMany({ where: inG }),
    db.listItem.deleteMany({ where: inG }),
    db.budget.deleteMany({ where: inG }),
    db.goalEntry.deleteMany({ where: { goal: inG } }),
    db.goal.deleteMany({ where: inG }),
    db.depositShare.deleteMany({ where: { deposit: inG } }),
    db.deposit.deleteMany({ where: inG }),
    db.groupPhoto.deleteMany({ where: inG }),
    db.receipt.deleteMany({ where: inG }),
    db.potMove.deleteMany({ where: { game: inG } }),
    db.potGame.deleteMany({ where: inG }),
    db.member.deleteMany({ where: inG }),
    db.group.deleteMany({ where: { id: { in: ids } } }),
  ]);
  await flushPhotoDeletes();
}
