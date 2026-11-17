import { db } from "./db";

// The bill photos an activity list may link to. Someone who left sees only the bills from their time in the group
// (the same cut-off /api/receipt/[id] applies), so a link is never shown that would only lead to "Not found".
export async function receiptsFor(groupId: string, leftAt?: Date | null) {
  return db.receipt.findMany({
    where: { groupId, expenseId: { not: "" }, ...(leftAt ? { createdAt: { lte: leftAt } } : {}) },
    select: { id: true, expenseId: true },
  });
}
