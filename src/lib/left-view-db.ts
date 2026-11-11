import { db } from "./db";
import { leaverCut, leaverWhere } from "./left-view";

// Database side of left-view.ts: what a person who left may still read.

// Expenses and payments that changes after `cut` touched this person in.
export async function touchedAfter(groupId: string, me: string, cut: Date): Promise<{ expenseIds: string[]; paymentIds: string[] }> {
  const evs = await db.groupEvent.findMany({
    where: { groupId, createdAt: { gt: cut }, touches: { contains: me } },
    select: { expenseId: true, paymentId: true, touches: true },
  });
  const mine = evs.filter((e) => e.touches.split(",").includes(me));
  return {
    expenseIds: [...new Set(mine.map((e) => e.expenseId).filter((x): x is string => Boolean(x)))],
    paymentIds: [...new Set(mine.map((e) => e.paymentId).filter((x): x is string => Boolean(x)))],
  };
}

// Prisma filters for a group's expenses and payments as this member may read them
// (null = no limit: they're still in the group).
export async function readableWhere(groupId: string, member: { id: string; leftAt: Date | null; removedAt?: Date | null }) {
  const cut = leaverCut(member);
  if (!cut) return null;
  return leaverWhere(member.id, cut.leftAt, await touchedAfter(groupId, member.id, cut.leftAt));
}

// The group's events a leaver may read: everything up to the day they left, and anything after that touched them.
export async function leaverEvents(groupId: string, cut: Date, take: number) {
  const [before, after] = await Promise.all([
    take > 0 ? db.groupEvent.findMany({ where: { groupId, createdAt: { lte: cut } }, orderBy: { createdAt: "desc" }, take }) : Promise.resolve([]),
    // Everything after is needed to decide what touched them (kept short: only changes since they left).
    db.groupEvent.findMany({ where: { groupId, createdAt: { gt: cut } }, orderBy: { createdAt: "desc" }, take: 2000 }),
  ]);
  return { before, after };
}


// Is this member someone who left or was removed? (null = still in the group.) Sub-pages that show a group's
// expenses, payments, bills or history use this: a leaver is sent back to the group, which shows what they may see.
export async function leaverOf(memberId: string | null | undefined) {
  if (!memberId) return null;
  const m = await db.member.findUnique({ where: { id: memberId }, select: { leftAt: true, removedAt: true } });
  return m ? leaverCut(m) : null;
}

// How this member stands with one expense: "member" (still in the group: reads everything), "visible" (they left,
// and the leaver view includes it) or "hidden" (they left, and the group added it without them).
export async function expenseAccess(groupId: string, memberId: string, expenseId: string): Promise<"member" | "visible" | "hidden"> {
  const m = await db.member.findUnique({ where: { id: memberId }, select: { id: true, leftAt: true, removedAt: true } });
  const scope = m ? await readableWhere(groupId, m) : null;
  if (!scope) return "member";
  return (await db.expense.count({ where: { id: expenseId, groupId, AND: [scope.expenses] } })) > 0 ? "visible" : "hidden";
}
