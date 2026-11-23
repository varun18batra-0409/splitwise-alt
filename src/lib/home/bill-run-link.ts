import type { Prisma } from "@prisma/client";

// An automatic bill's expense and its month are tied together by the bill's month row (BillRun.expenseId).
// Deleting that expense puts the month back to "waiting" (reason "deleted", the expense id is kept) so the month can be added
// again: the daily job never adds it twice (a waiting month is not touched), and the bill shows "Add it" (or "Needs amount").
// Bringing the expense back before the month is added again puts the month back to "added". Once the month has been added
// again, the old expense can't come back (that would count the month twice).

// In the delete transaction.
export async function monthWaitsAgain(tx: Prisma.TransactionClient, expenseId: string): Promise<void> {
  await tx.billRun.updateMany({ where: { expenseId, status: "added", bill: { deletedAt: null } }, data: { status: "waiting", reason: "deleted" } });
}

// In the restore transaction, before anything is written: the name of the bill whose month was added again since, or null.
export async function billAddedAgain(tx: Prisma.TransactionClient, e: { id: string; groupId: string; description: string; spentAt: Date | null }): Promise<string | null> {
  if (await tx.billRun.findFirst({ where: { expenseId: e.id, status: "waiting", reason: "deleted" }, select: { id: true } })) return null;
  if (!e.spentAt) return null; // an expense with no date of its own was not made by a bill
  const period = e.spentAt.toISOString().slice(0, 7);
  const run = await tx.billRun.findFirst({
    where: { period, status: "added", expenseId: { not: e.id }, bill: { groupId: e.groupId, name: e.description, deletedAt: null } },
    select: { expenseId: true, bill: { select: { name: true } } },
  });
  if (!run) return null;
  const live = await tx.expense.findFirst({ where: { id: run.expenseId, deletedAt: null }, select: { id: true } });
  return live ? run.bill.name : null;
}

// In the restore transaction, after the expense is back: the month is "added" again.
export async function monthIsAddedAgain(tx: Prisma.TransactionClient, expenseId: string): Promise<void> {
  await tx.billRun.updateMany({ where: { expenseId, status: "waiting", reason: "deleted" }, data: { status: "added", reason: "" } });
}
