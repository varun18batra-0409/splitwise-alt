import { db } from "./db";
import { asOfCut, leaverCut, leaverWhere } from "./left-view";
import { spentAmount } from "./payers";
import type { Prisma } from "@prisma/client";

type ExpenseNow = Prisma.ExpenseGetPayload<{ include: { shares: true } }>;
type PaymentNow = Prisma.PaymentGetPayload<object>;

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

// The group's changes after the cut-off that are about an expense or a payment (for showing rows as they were that day, MA-3).
// Only the columns that decision needs; the oldest are what matter, so they are read oldest first.
export async function laterRowEvents(groupId: string, cut: Date) {
  return db.groupEvent.findMany({
    where: { groupId, createdAt: { gt: cut }, OR: [{ expenseId: { not: null } }, { paymentId: { not: null } }] },
    select: { id: true, createdAt: true, kind: true, touches: true, expenseId: true, paymentId: true, undo: true },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });
}

// The rows a leaver may read that CHANGED after the day they left (edited, deleted or brought back), each as it was on that day
// (null = not shown: its earlier state isn't known). Rows that never changed are not listed. Payments the same (deleted / brought back).
export async function asOfChanged(groupId: string, member: { id: string; leftAt: Date | null; removedAt?: Date | null }) {
  const cut = leaverCut(member);
  const scope = await readableWhere(groupId, member);
  if (!cut || !scope) return { expenses: [] as { id: string; now: ExpenseNow; shown: ExpenseNow | null }[], payments: [] as { id: string; now: PaymentNow; shown: PaymentNow }[] };
  const later = await laterRowEvents(groupId, cut.leftAt);
  const eids = [...new Set(later.map((e) => e.expenseId).filter((x): x is string => Boolean(x)))];
  const pids = [...new Set(later.map((e) => e.paymentId).filter((x): x is string => Boolean(x)))];
  const [rows, pays] = await Promise.all([
    db.expense.findMany({
      where: { groupId, AND: [scope.expenses, { createdAt: { lte: cut.leftAt } }, { OR: [{ id: { in: eids } }, { editedAt: { gt: cut.leftAt } }, { deletedAt: { gt: cut.leftAt } }] }] },
      include: { shares: true },
    }),
    db.payment.findMany({ where: { groupId, AND: [scope.payments, { createdAt: { lte: cut.leftAt } }, { OR: [{ id: { in: pids } }, { deletedAt: { gt: cut.leftAt } }] }] } }),
  ]);
  const shown = asOfCut({ expenses: rows, payments: pays }, later, member.id, cut.leftAt);
  const eShown = new Map(shown.expenses.map((e) => [e.id, e]));
  const pShown = new Map(shown.payments.map((p) => [p.id, p]));
  return {
    expenses: rows.map((e) => ({ id: e.id, now: e, shown: eShown.get(e.id) ?? null })),
    payments: pays.map((p) => ({ id: p.id, now: p, shown: pShown.get(p.id)! })),
  };
}

// For the lightweight Home loader, which never loads the rows: how far "spent" and the expense count move when the rows a leaver
// may read are shown as they were on the day they left. The deltas are added to the database totals (which count today's state);
// balances are never touched.
export async function asOfFixes(groupId: string, member: { id: string; leftAt: Date | null; removedAt?: Date | null }): Promise<{ spentDelta: number; countDelta: number }> {
  const { expenses } = await asOfChanged(groupId, member);
  let spentDelta = 0;
  let countDelta = 0;
  for (const { now, shown } of expenses) {
    if (!now.deletedAt) {
      spentDelta -= spentAmount(now);
      countDelta -= 1;
    }
    if (shown && !shown.deletedAt) {
      spentDelta += spentAmount(shown);
      countDelta += 1;
    }
  }
  return { spentDelta, countDelta };
}
