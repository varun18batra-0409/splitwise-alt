import type { Prisma } from "@prisma/client";
import { payerIds } from "./payers";

// What someone who left (or was removed from) a group can still see.
//
// They see the group only up to the day they left, plus anything that came
// later and moved their own money: an expense that now has them in it, a payment
// to or from them, and the history lines about changes to their share.
// New spending the group adds without them is not shown.
//
// This is only about WHAT IS SHOWN. Nobody's balance changes because of who can
// see what: balances always come from the full ledger, and money writes and the
// daily job always use the full data. Pure functions, so they can be tested.

export type LeaverCut = { leftAt: Date; removed: boolean };

// The day someone stopped being in the group (null = they're still in it). Removed people have leftAt too.
export function leaverCut(m: { leftAt: Date | null; removedAt?: Date | null }): LeaverCut | null {
  const at = m.leftAt ?? m.removedAt ?? null;
  return at ? { leftAt: at, removed: Boolean(m.removedAt) } : null;
}

type ExpenseRow = { id: string; createdAt: Date; paidById: string; amount?: number; payers?: string | null; shares: { memberId: string }[] };
type PaymentRow = { id: string; createdAt: Date; fromId: string; toId: string };
type EventRow = { id: string; createdAt: Date; touches?: string | null; expenseId: string | null; paymentId: string | null };

const touchesOf = (e: { touches?: string | null }): string[] => (e.touches ? e.touches.split(",").filter(Boolean) : []);

export const expenseInvolves = (e: ExpenseRow, me: string): boolean => e.shares.some((s) => s.memberId === me) || payerIds({ paidById: e.paidById, payers: e.payers }).includes(me);
export const paymentInvolves = (p: PaymentRow, me: string): boolean => p.fromId === me || p.toId === me;

// Rows are every expense / payment / event of the group, deleted ones too.
export function scopeForLeaver<E extends ExpenseRow, P extends PaymentRow, V extends EventRow>(
  data: { expenses: E[]; payments: P[]; events: V[] },
  me: string,
  cut: Date,
): { expenses: E[]; payments: P[]; events: V[] } {
  const upTo = cut.getTime();
  // Changes after they left that moved their share.
  const touchedExpense = new Set<string>();
  const touchedPayment = new Set<string>();
  for (const ev of data.events) {
    if (!touchesOf(ev).includes(me)) continue;
    if (ev.expenseId) touchedExpense.add(ev.expenseId);
    if (ev.paymentId) touchedPayment.add(ev.paymentId);
  }
  const expenseById = new Map(data.expenses.map((e) => [e.id, e]));
  const paymentById = new Map(data.payments.map((p) => [p.id, p]));
  return {
    expenses: data.expenses.filter((e) => e.createdAt.getTime() <= upTo || expenseInvolves(e, me) || touchedExpense.has(e.id)),
    payments: data.payments.filter((p) => p.createdAt.getTime() <= upTo || paymentInvolves(p, me) || touchedPayment.has(p.id)),
    events: data.events.filter((ev) => {
      if (ev.createdAt.getTime() <= upTo) return true;
      const t = touchesOf(ev);
      if (t.includes(me)) return true;
      // Written before changes recorded who they touched: shown if the expense or payment is about them now.
      if (t.length === 0) {
        const e = ev.expenseId ? expenseById.get(ev.expenseId) : undefined;
        if (e && expenseInvolves(e, me)) return true;
        const p = ev.paymentId ? paymentById.get(ev.paymentId) : undefined;
        if (p && paymentInvolves(p, me)) return true;
      }
      return false;
    }),
  };
}

// Only their own balance (worked out from the FULL ledger by the caller) and only the Smart Settle
// payments they are part of.
export function scopeBalances<T extends { from: string; to: string }>(net: Record<string, number>, transfers: T[], me: string): { net: Record<string, number>; transfers: T[] } {
  return { net: { [me]: net[me] ?? 0 }, transfers: transfers.filter((t) => t.from === me || t.to === me) };
}

// The same rule as a database filter (for exports and "my data"), given the expenses and payments
// that later changes touched them in (see touchedAfter in left-view-db.ts).
export function leaverWhere(me: string, cut: Date, touched: { expenseIds: string[]; paymentIds: string[] }): { expenses: Prisma.ExpenseWhereInput; payments: Prisma.PaymentWhereInput } {
  return {
    expenses: { OR: [{ createdAt: { lte: cut } }, { paidById: me }, { payers: { contains: me } }, { shares: { some: { memberId: me } } }, { id: { in: touched.expenseIds } }] },
    payments: { OR: [{ createdAt: { lte: cut } }, { fromId: me }, { toId: me }, { id: { in: touched.paymentIds } }] },
  };
}

// The lines of a change that are about the leaver's own share ("Ravi’s share: ₹300 → ₹0"), as saved JSON.
// Other people's amounts in changes made after they left are not shown to them.
export function ownShareDetails(detailsJson: string, name: string): string {
  try {
    const v = JSON.parse(detailsJson);
    const lines = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.startsWith(`${name}’s share:`)) : [];
    return JSON.stringify(lines);
  } catch {
    return "[]";
  }
}

// The people as they were on the day the viewer left: only those who had been added by then (createdAt <= that day),
// and anyone who left or was removed only AFTER that day counts as still being in. The viewer is always listed.
// This is for the header and the People list; names on rows they can see are still looked up in the full list.
export function membersAsOf<M extends { id: string; createdAt: Date; leftAt: Date | null; removedAt: Date | null }>(members: M[], me: string, cut: Date): M[] {
  const day = cut.getTime();
  return members
    .filter((m) => m.id === me || m.createdAt.getTime() <= day)
    .map((m) => {
      const leftLater = m.id !== me && m.leftAt !== null && m.leftAt.getTime() > day;
      return leftLater ? { ...m, leftAt: null, removedAt: null } : m;
    });
}

// A card-night game is part of what a leaver sees only if it finished (or, unfinished, started) by the day they left.
export function gameVisible(cut: LeaverCut | null, game: { finishedAt: Date | null; createdAt: Date }): boolean {
  return !cut || (game.finishedAt ?? game.createdAt).getTime() <= cut.leftAt.getTime();
}

// A bill (a household bill added as an expense, or a bill run) created after they left isn't shown to them.
export function createdByCut(cut: LeaverCut | null, createdAt: Date): boolean {
  return !cut || createdAt.getTime() <= cut.leftAt.getTime();
}

// Home's trip countdown, "a year ago today", "just back", wrapped and the top cards are about how a group is NOW (its
// current people, trip dates and totals). For a group the viewer left or was removed from they would show things
// they no longer see, so those stories use only the groups the viewer is still in.
export function stillIn<T extends { leaver?: unknown }>(groups: T[]): T[] {
  return groups.filter((g) => !g.leaver);
}

// How long someone who left can still download the group's history.
export const COPY_DAYS = 30;
