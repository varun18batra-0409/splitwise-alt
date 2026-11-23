import type { Prisma } from "@prisma/client";
import { STUCK_HOLD } from "@/lib/home/bills";

// An automatic bill's expense and its month are tied together by the bill's month row (BillRun.expenseId).
// Deleting that expense puts the month back to "waiting" (reason "deleted", the expense id is kept) so the month can be added
// again: the daily job never adds it twice (a waiting month is not touched), and the bill page shows "Deleted · Add it again".
// Bringing the expense back before the month is added again puts the month back to "added". Once the month has been added
// again, the old expense can't come back (that would count the month twice): the replaced expense's id is written down as a
// one-time key "bill-replaced:<id>" in the very step that adds the month again (no schema change; the daily clean-up keeps these).

export const REPLACED_PREFIX = "bill-replaced:";

// In the delete transaction.
export async function monthWaitsAgain(tx: Prisma.TransactionClient, expenseId: string): Promise<void> {
  await tx.billRun.updateMany({ where: { expenseId, status: "added", bill: { deletedAt: null } }, data: { status: "waiting", reason: "deleted" } });
}

// In the same transaction that adds a deleted month again: remember which expense it replaced.
export async function noteReplaced(tx: Prisma.TransactionClient, oldExpenseId: string, newExpenseId: string): Promise<void> {
  if (!oldExpenseId || oldExpenseId === newExpenseId) return;
  await tx.requestKey.upsert({ where: { key: `${REPLACED_PREFIX}${oldExpenseId}` }, create: { key: `${REPLACED_PREFIX}${oldExpenseId}`, result: newExpenseId }, update: {} });
}

// In the restore transaction, before anything is written: the name of the bill whose month this expense stood for and that was
// added again since (or is being added again right now), or null. No guessing by name or date.
export async function billAddedAgain(tx: Prisma.TransactionClient, e: { id: string }): Promise<string | null> {
  const replaced = await tx.requestKey.findUnique({ where: { key: `${REPLACED_PREFIX}${e.id}` }, select: { result: true } });
  const run = await tx.billRun.findFirst({ where: { expenseId: e.id }, select: { status: true, reason: true, bill: { select: { name: true } } } });
  if (run && run.status === "adding") return run.bill.name; // being added again at this moment
  // A month on hold because it may already have been added again (a crash, with the proof since cleaned away): bringing the old
  // expense back could count the month twice, so it stays deleted.
  if (run && run.status === "waiting" && run.reason === STUCK_HOLD) return run.bill.name;
  if (!replaced) return null;
  const now = replaced.result ? await tx.billRun.findFirst({ where: { expenseId: replaced.result }, select: { bill: { select: { name: true } } } }) : null;
  return now?.bill.name ?? "bill";
}

// In the restore transaction, after the expense is back: the month is "added" again.
export async function monthIsAddedAgain(tx: Prisma.TransactionClient, expenseId: string): Promise<void> {
  await tx.billRun.updateMany({ where: { expenseId, status: "waiting", reason: "deleted" }, data: { status: "added", reason: "" } });
}
