import type { Prisma, PrismaClient } from "@prisma/client";
import { parsePrepaid } from "./moving";

// A move-out daily charge (the leaver's share of a daily bill's month, written down when they moved out)
// belongs to that month's bill. Once the month's bill is being added or has been added, the bill has already
// taken the charge off its total, so the charge can no longer be edited, deleted or brought back on its own:
// that would count the money twice or lose it. Edit the bill instead.

export type ChargeLock = { bill: string; status: "adding" | "added" };

export async function chargeLock(client: PrismaClient | Prisma.TransactionClient, groupId: string, expenseId: string): Promise<ChargeLock | null> {
  const bills = await client.bill.findMany({ where: { groupId, prepaid: { contains: expenseId } }, select: { id: true, name: true, prepaid: true } });
  for (const b of bills) {
    for (const [period, list] of Object.entries(parsePrepaid(b.prepaid))) {
      if (!list.some((x) => x.e === expenseId)) continue;
      const run = await client.billRun.findUnique({ where: { billId_period: { billId: b.id, period } }, select: { status: true } });
      if (run?.status === "added" || run?.status === "adding") return { bill: b.name, status: run.status };
    }
  }
  return null;
}

// The leavers a move-out daily charge was made for: the member ids (`m`) on this expense's entries in any bill's prepaid
// list, whatever the month's status. Empty if it isn't a move-out charge.
export async function moveOutLeavers(client: PrismaClient | Prisma.TransactionClient, groupId: string, expenseId: string): Promise<string[]> {
  const bills = await client.bill.findMany({ where: { groupId, prepaid: { contains: expenseId } }, select: { prepaid: true } });
  return bills.flatMap((b) => Object.values(parsePrepaid(b.prepaid)).flatMap((list) => list.filter((x) => x.e === expenseId).map((x) => x.m)));
}

export const chargeLockedText = (bill: string) => `This was counted in this month’s ${bill}. Edit ${bill} instead.`;
