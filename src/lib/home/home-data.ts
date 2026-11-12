import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { daysBetween } from "../countdown";
import { viewMonth } from "./banner";
import type { loadMyGroupsLight } from "../group-data";

// The rows Home still needs, read for just those things instead of every group's whole history:
//   - Latest: the five newest changes across your open groups;
//   - Your month: this month's expenses (your share of each);
//   - today's spending on each trip that is on;
//   - the category totals for a trip that just ended (its Wrapped card).
// Groups you left keep the rule of what you may read (readableWhere): `readable` on each entry.

type Entry = Awaited<ReturnType<typeof loadMyGroupsLight>>[number];

const HOUR = 3_600_000;
const WIDEN = 14 * HOUR; // the furthest any time zone is from UTC (Kiritimati is UTC+14, Baker Island UTC−12)

// A month ("2026-11") as moments, widened by 14 hours each way. Anything that falls on that month in ANY time
// zone is inside; the caller then keeps only what dayKey says is in the month in the viewer's zone.
export function monthWindow(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1) - WIDEN), to: new Date(Date.UTC(y, m, 1) + WIDEN) };
}

// A day ("2026-11-12") as moments, widened the same way.
export function dayWindow(day: string): { from: Date; to: Date } {
  const [y, m, d] = day.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  return { from: new Date(start - WIDEN), to: new Date(start + 24 * HOUR + WIDEN) };
}

// Home's "trip just ended" test (Wrapped card): a trip you're still in, with at least three expenses,
// that ended 1 to 14 days ago.
export function wrappedEnded(g: Pick<Entry, "group" | "expenseCount" | "leaver">, today: string): number | null {
  if (g.leaver || g.group.closed || g.group.type !== "trip" || !g.group.tripStart || g.expenseCount < 3) return null;
  const ended = daysBetween(g.group.tripEnd || g.group.tripStart, today);
  return ended >= 1 && ended <= 14 ? ended : null;
}

// "Spent on this day" in one filter: the expense's own day if it has one, else the day it was added.
const onDate = (from: Date, to: Date): Prisma.ExpenseWhereInput => ({ OR: [{ spentAt: { gte: from, lt: to } }, { spentAt: null, createdAt: { gte: from, lt: to } }] });

// Groups whose rows may be read: everyone's in full, a leaver's only what they may see.
function readableExpenses(groups: Entry[]): Prisma.ExpenseWhereInput | null {
  const parts: Prisma.ExpenseWhereInput[] = [];
  const whole = groups.filter((g) => !g.readable).map((g) => g.group.id);
  if (whole.length) parts.push({ groupId: { in: whole } });
  for (const g of groups) if (g.readable) parts.push({ groupId: g.group.id, AND: [g.readable.expenses] });
  return parts.length ? { OR: parts } : null;
}
function readablePayments(groups: Entry[]): Prisma.PaymentWhereInput | null {
  const parts: Prisma.PaymentWhereInput[] = [];
  const whole = groups.filter((g) => !g.readable).map((g) => g.group.id);
  if (whole.length) parts.push({ groupId: { in: whole } });
  for (const g of groups) if (g.readable) parts.push({ groupId: g.group.id, AND: [g.readable.payments] });
  return parts.length ? { OR: parts } : null;
}

export async function loadHomeRows(all: Entry[], opts: { tz: string; now: Date; today: string }) {
  const open = all.filter((g) => !g.group.closed);
  const { month } = viewMonth(opts.now, opts.tz);
  const monthWin = monthWindow(month);
  const dayWin = dayWindow(opts.today);
  const allExpenses = readableExpenses(all);
  const openExpenses = readableExpenses(open);
  const openPayments = readablePayments(open);
  const myIds = all.map((g) => g.myId);
  // Trips that are on or coming: today's spending is read for these only.
  const tripIds = open.filter((g) => !g.leaver && g.group.type === "trip" && g.group.tripStart).map((g) => g.group.id);
  const wrappedIds = open.filter((g) => wrappedEnded(g, opts.today) !== null).map((g) => g.group.id);

  const [newest, spentOn, paid, monthRows, todayRows, cats] = await Promise.all([
    // Latest, expenses: the five newest of those with no chosen day (by when they were added) and the five newest
    // of those with one (by that day). The five newest overall are among these ten.
    openExpenses
      ? db.expense.findMany({ where: { AND: [openExpenses, { deletedAt: null, spentAt: null }] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5, include: { shares: true } })
      : Promise.resolve([]),
    openExpenses
      ? db.expense.findMany({ where: { AND: [openExpenses, { deletedAt: null, spentAt: { not: null } }] }, orderBy: [{ spentAt: "desc" }, { id: "desc" }], take: 5, include: { shares: true } })
      : Promise.resolve([]),
    // Latest, payments: the five newest.
    openPayments ? db.payment.findMany({ where: { AND: [openPayments, { deletedAt: null }] }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5 }) : Promise.resolve([]),
    // Your month: every group you're in, closed ones too. Only your own share of each is read.
    allExpenses
      ? db.expense.findMany({
          where: { AND: [allExpenses, { deletedAt: null, kind: { not: "pot" } }, onDate(monthWin.from, monthWin.to)] },
          select: { groupId: true, amount: true, kind: true, category: true, spentAt: true, createdAt: true, shares: { where: { memberId: { in: myIds } }, select: { memberId: true, amount: true } } },
        })
      : Promise.resolve([]),
    tripIds.length
      ? db.expense.findMany({
          where: { groupId: { in: tripIds }, deletedAt: null, kind: { notIn: ["pot", "refund"] }, ...onDate(dayWin.from, dayWin.to) },
          select: { id: true, groupId: true, description: true, amount: true, kind: true, paidById: true, payers: true, spentAt: true, createdAt: true },
        })
      : Promise.resolve([]),
    wrappedIds.length
      ? db.expense.groupBy({ by: ["groupId", "category"], where: { groupId: { in: wrappedIds }, deletedAt: null, kind: { notIn: ["pot", "refund"] } }, _sum: { amount: true } })
      : Promise.resolve([]),
  ]);

  // Latest: the five newest changes overall, handed back per group (buildActivity turns them into rows).
  const dateOf = (e: { spentAt: Date | null; createdAt: Date }) => (e.spentAt ?? e.createdAt).getTime();
  const picks = [
    ...[...newest, ...spentOn].map((e) => ({ at: dateOf(e), kind: "expense" as const, e })),
    ...paid.map((p) => ({ at: p.createdAt.getTime(), kind: "payment" as const, p })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
  const recent = new Map<string, { expenses: typeof newest; payments: typeof paid }>();
  const slot = (gid: string) => recent.get(gid) ?? recent.set(gid, { expenses: [], payments: [] }).get(gid)!;
  for (const k of picks) {
    if (k.kind === "expense") slot(k.e.groupId).expenses.push(k.e);
    else slot(k.p.groupId).payments.push(k.p);
  }

  // Your month, shaped for monthNumbers (which keeps only what dayKey puts in the month in the viewer's zone).
  const byGroup = new Map<string, typeof monthRows>();
  for (const r of monthRows) (byGroup.get(r.groupId) ?? byGroup.set(r.groupId, []).get(r.groupId)!).push(r);
  const monthGroups = all.map((g) => ({ currency: g.group.currency, myId: g.myId, expenses: byGroup.get(g.group.id) ?? [] }));

  const today = new Map<string, typeof todayRows>();
  for (const r of todayRows) (today.get(r.groupId) ?? today.set(r.groupId, []).get(r.groupId)!).push(r);

  const categories = new Map<string, Map<string, number>>();
  for (const r of cats) (categories.get(r.groupId) ?? categories.set(r.groupId, new Map()).get(r.groupId)!).set(r.category, r._sum.amount ?? 0);

  return { recent, monthGroups, today, categories };
}
