import { db } from "./db";
import { RESTORE_DAYS } from "./group-data";

// Deleted groups: anyone in them can restore them for 30 days (RESTORE_DAYS).
// After that, the daily job erases them for good, as the privacy page says:
// the group, its people, expenses, payments, history, bills, list, budgets,
// goals and deposit. Groups that were only closed are never touched.

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
  await db.$transaction([
    db.expenseShare.deleteMany({ where: { expense: inG } }),
    db.expense.deleteMany({ where: inG }),
    db.payment.deleteMany({ where: inG }),
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
    db.member.deleteMany({ where: inG }),
    db.group.deleteMany({ where: { id: { in: ids } } }),
  ]);
}
