import type { Prisma, PrismaClient } from "@prisma/client";
import { parsePrepaid } from "./moving";

// A move-out daily charge (the leaver's share of a daily bill's month, written down when they moved out)
// belongs to that month's bill. Once the month's bill is being added or has been added, the bill has already
// taken the charge off its total (or, when the charge covered the whole month, there is no bill to add: the charge is it), so the charge can no longer be edited, deleted or brought back on its own:
// that would count the money twice or lose it. Edit the bill instead.

export type ChargeLock = { bill: string; status: "adding" | "added" | "covered" };

export async function chargeLock(client: PrismaClient | Prisma.TransactionClient, groupId: string, expenseId: string): Promise<ChargeLock | null> {
  const bills = await client.bill.findMany({ where: { groupId, prepaid: { contains: expenseId } }, select: { id: true, name: true, prepaid: true } });
  for (const b of bills) {
    for (const [period, list] of Object.entries(parsePrepaid(b.prepaid))) {
      if (!list.some((x) => x.e === expenseId)) continue;
      const run = await client.billRun.findUnique({ where: { billId_period: { billId: b.id, period } }, select: { status: true, reason: true } });
      if (run?.status === "added" || run?.status === "adding") return { bill: b.name, status: run.status };
      // A month the move-out charge covered completely was closed as "covered" (nothing left to add): the charge IS that
      // month's bill, so deleting or changing it would lose the month's money.
      if (run?.status === "skipped" && run.reason === "covered") return { bill: b.name, status: "covered" };
    }
  }
  return null;
}

export const chargeLockedText = (bill: string, status?: ChargeLock["status"]) =>
  status === "covered" ? `This month’s ${bill} was already covered, so this charge stays.` : `This was counted in this month’s ${bill}. Edit ${bill} instead.`;

// An older move-out charge (deleted, then replaced by a newer one when the person moved out again) can't be brought back while the newer one
// still stands for the same month: the person would pay for those days twice. Returns the bill's name when that is the case.
export async function chargeReplaced(client: PrismaClient | Prisma.TransactionClient, groupId: string, expenseId: string): Promise<string | null> {
  const bills = await client.bill.findMany({ where: { groupId, prepaid: { contains: expenseId } }, select: { name: true, prepaid: true } });
  for (const b of bills) {
    for (const list of Object.values(parsePrepaid(b.prepaid))) {
      const mine = list.find((x) => x.e === expenseId);
      if (!mine) continue;
      const others = list.filter((x) => x.m === mine.m && x.e !== expenseId).map((x) => x.e);
      if (others.length && (await client.expense.count({ where: { id: { in: others }, deletedAt: null } })) > 0) return b.name;
    }
  }
  return null;
}
