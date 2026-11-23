import type { Prisma } from "@prisma/client";
import { parsePrepaid } from "./moving";
import { dayRangeLabel } from "./bills";

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
  const run = await tx.billRun.findFirst({ where: { expenseId: e.id }, select: { status: true, bill: { select: { name: true } } } });
  if (run && run.status === "adding") return run.bill.name; // being added again at this moment
  if (!replaced) return null;
  const now = replaced.result ? await tx.billRun.findFirst({ where: { expenseId: replaced.result }, select: { bill: { select: { name: true } } } }) : null;
  return now?.bill.name ?? "bill";
}

// In the restore transaction, after the expense is back: the month is "added" again.
export async function monthIsAddedAgain(tx: Prisma.TransactionClient, expenseId: string): Promise<void> {
  await tx.billRun.updateMany({ where: { expenseId, status: "waiting", reason: "deleted" }, data: { status: "added", reason: "" } });
}

// A deleted pause or stop charge ("part" charge) can't come back when another live part charge for the same bill and month already
// covers those days (they would be charged twice). Returns the words to refuse with, or null. (A closed month is refused by chargeLock first.)
export async function partRestoreRefusal(tx: Prisma.TransactionClient, e: { id: string; groupId: string }): Promise<string | null> {
  const bills = await tx.bill.findMany({ where: { groupId: e.groupId, prepaid: { contains: e.id } }, select: { name: true, prepaid: true } });
  for (const b of bills) {
    for (const [period, list] of Object.entries(parsePrepaid(b.prepaid))) {
      const mine = list.find((x) => x.e === e.id && x.k === "part");
      if (!mine) continue;
      const others = list.filter((x) => x.k === "part" && x.e !== e.id);
      if (!others.length) continue;
      const live = await tx.expense.count({ where: { id: { in: others.map((x) => x.e) }, deletedAt: null } });
      if (live > 0) {
        const to = Number((mine.d ?? "").slice(8, 10)) || 1;
        return `${b.name} for ${dayRangeLabel(period, 1, to)} is already covered by a later charge, so this one can’t come back.`;
      }
    }
  }
  return null;
}
