import type { Prisma, PrismaClient } from "@prisma/client";
import { parsePrepaid } from "./moving";

// A move-out daily charge (the leaver's share of a daily bill's month, written down when they moved out)
// belongs to that month's bill. Once the month's bill is being added or has been added, the bill has already
// taken the charge off its total (or, when the charge covered the whole month, there is no bill to add: the charge is it), so the charge can no longer be edited, deleted or brought back on its own:
// that would count the money twice or lose it. Edit the bill instead.

// "part": a pause or stop charge (the month so far). It is locked from the moment it is made, like nothing else: it can never be deleted or
// changed (and so never brought back). If it is wrong, mark missed days before pausing, or add a money-back expense afterwards.
export type ChargeLock = { bill: string; status: "adding" | "added" | "covered" | "part" };

export async function chargeLock(client: PrismaClient | Prisma.TransactionClient, groupId: string, expenseId: string): Promise<ChargeLock | null> {
  const bills = await client.bill.findMany({ where: { groupId, prepaid: { contains: expenseId } }, select: { id: true, name: true, prepaid: true } });
  for (const b of bills) {
    for (const [period, list] of Object.entries(parsePrepaid(b.prepaid))) {
      if (!list.some((x) => x.e === expenseId)) continue;
      if (list.some((x) => x.e === expenseId && x.k === "part")) return { bill: b.name, status: "part" };
      const run = await client.billRun.findUnique({ where: { billId_period: { billId: b.id, period } }, select: { status: true, reason: true } });
      if (run?.status === "added" || run?.status === "adding") return { bill: b.name, status: run.status };
      // A month the move-out charge covered completely was closed as "covered" (nothing left to add): the charge IS that
      // month's bill, so deleting or changing it would lose the month's money.
      // A month closed because the bill was stopped or paused (or it came back to nothing) keeps its part and move-out charges: they ARE that month's bill.
      if (run?.status === "skipped" && (run.reason === "covered" || run.reason === "stopped" || run.reason === "paused")) return { bill: b.name, status: "covered" };
    }
  }
  return null;
}

export const chargeLockedText = (bill: string, status?: ChargeLock["status"]) =>
  status === "part" ? `This charge was added when ${bill} was paused or stopped, so it can't be deleted. If it's wrong, add a money-back expense.` : status === "covered" ? `This month’s ${bill} was already covered, so this charge stays.` : `This was counted in this month’s ${bill}. Edit ${bill} instead.`;
