import { db } from "./db";
import { asOfCut, leaverCut, leaverWhere, memberOfChange, type MemberChange } from "./left-view";
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

// THE list of changes after the cut-off that decides how a row looked on the day someone left (MA-3). Every screen that shows a leaver's
// rows (the group page, Home, Search, the lighter Home loader, the export, "my data") reads it through here, so they all agree: every
// change about an expense or a payment (including "Mark all paid" lines, which have no single payment) and every currency change, after
// that day, oldest first, with only the columns the decision needs. `complete` is false only past ROW_EVENT_CAP lines (the same
// number everywhere); asOfCut then hides rows changed since rather than guess.
export const ROW_EVENT_CAP = 20_000;
export async function laterRowEvents(groupId: string, cut: Date) {
  const [rows, currency] = await Promise.all([
    db.groupEvent.findMany({
      where: { groupId, createdAt: { gt: cut }, kind: { not: "currency_changed" }, OR: [{ expenseId: { not: null } }, { paymentId: { not: null } }, { kind: { in: ["payment_deleted", "payment_restored"] } }] },
      select: { id: true, createdAt: true, kind: true, touches: true, expenseId: true, paymentId: true, undo: true, text: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: ROW_EVENT_CAP + 1,
    }),
    // (Its undo text holds every amount in the group, and isn't needed: the rate is in its history lines.)
    db.groupEvent.findMany({
      where: { groupId, createdAt: { gt: cut }, kind: "currency_changed" },
      select: { id: true, createdAt: true, kind: true, touches: true, expenseId: true, paymentId: true, details: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const complete = rows.length <= ROW_EVENT_CAP;
  return { events: [...rows.slice(0, ROW_EVENT_CAP), ...currency.map((c) => ({ ...c, undo: null as string | null, text: null as string | null }))], complete };
}

// When people in these groups went out or came back (the group's "left" / "came back" lines), by person: what membershipSpan needs to
// tell a person who left and was brought back from one who was there all along.
export async function memberHistory(groupIds: string[]): Promise<Map<string, MemberChange[]>> {
  const out = new Map<string, MemberChange[]>();
  if (!groupIds.length) return out;
  const rows = await db.groupEvent.findMany({
    where: { groupId: { in: groupIds }, kind: { in: ["member_left", "member_rejoined"] } },
    select: { kind: true, createdAt: true, undo: true },
    orderBy: { createdAt: "asc" },
    take: 50_000,
  });
  for (const r of rows) {
    const id = memberOfChange(r.undo);
    if (id) (out.get(id) ?? out.set(id, []).get(id)!).push({ kind: r.kind, createdAt: r.createdAt });
  }
  return out;
}

// The payment ids a "Mark all paid" / "Settle everything" line (and its Undo or Redo) is about, from its saved undo text.
function paymentIdsInUndo(undo: string | null): string[] {
  try {
    const p = JSON.parse(undo ?? "");
    return p && (p.type === "payments_set" || p.type === "settle_all") && Array.isArray(p.paymentIds) ? p.paymentIds.filter((x: unknown): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// The rows a leaver may read that CHANGED after the day they left (edited, deleted or brought back), each as it was on that day
// (null = not shown: its earlier state isn't known). Rows that never changed are not listed. Payments the same (deleted / brought back).
export async function asOfChanged(groupId: string, member: { id: string; leftAt: Date | null; removedAt?: Date | null }) {
  const cut = leaverCut(member);
  const scope = await readableWhere(groupId, member);
  if (!cut || !scope) return { expenses: [] as { id: string; now: ExpenseNow; shown: ExpenseNow | null }[], payments: [] as { id: string; now: PaymentNow; shown: PaymentNow }[] };
  const { events: later, complete } = await laterRowEvents(groupId, cut.leftAt);
  const eids = [...new Set(later.map((e) => e.expenseId).filter((x): x is string => Boolean(x)))];
  const pids = [...new Set(later.flatMap((e) => (e.paymentId ? [e.paymentId] : [])).concat(later.flatMap((e) => paymentIdsInUndo(e.undo))))];
  const [rows, pays] = await Promise.all([
    db.expense.findMany({
      where: { groupId, AND: [scope.expenses, { createdAt: { lte: cut.leftAt } }, { OR: [{ id: { in: eids } }, { editedAt: { gt: cut.leftAt } }, { deletedAt: { gt: cut.leftAt } }] }] },
      include: { shares: true },
    }),
    db.payment.findMany({ where: { groupId, AND: [scope.payments, { createdAt: { lte: cut.leftAt } }, { OR: [{ id: { in: pids } }, { deletedAt: { gt: cut.leftAt } }] }] } }),
  ]);
  const shown = asOfCut({ expenses: rows, payments: pays }, later, member.id, cut.leftAt, { complete });
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
