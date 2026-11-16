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
type EventRow = { id: string; createdAt: Date; touches?: string | null; expenseId: string | null; paymentId: string | null; kind?: string; undo?: string | null };

const touchesOf = (e: { touches?: string | null }): string[] => (e.touches ? e.touches.split(",").filter(Boolean) : []);

// "Left the group" or "came back" lines about this very person (their own move-out, or a rejoin): theirs to see even after the cut-off,
// because the Undo of their own move-out hangs on that line. (Read from the saved undo text here so this file stays free of server code.)
export function isAboutMeLeaving(ev: { kind?: string; undo?: string | null }, me: string): boolean {
  if (ev.kind !== "member_left" && ev.kind !== "member_rejoined") return false;
  try {
    const p = JSON.parse(ev.undo ?? "");
    return Boolean(p) && p.type === "member_set" && p.memberId === me;
  } catch {
    return false;
  }
}

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
      if (isAboutMeLeaving(ev, me)) return true;
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

// Notes are not part of "what moved their money". If someone changes an expense after the viewer left (editedAt is after
// the cut-off), its notes are hidden from the viewer: the note is blanked and notesHidden says why, so the screen can say
// "Notes hidden: changed after you left." Only marked when there were notes to hide. Expenses edited before they left,
// or never edited, keep their notes. (Members still in the group never go through this.)
export function hideLaterNotes<E extends { notes?: string | null; editedAt?: Date | null }>(rows: E[], cut: Date): (E & { notesHidden?: boolean })[] {
  const upTo = cut.getTime();
  return rows.map((e) => (e.editedAt && e.editedAt.getTime() > upTo && e.notes ? { ...e, notes: "", notesHidden: true } : e));
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

// A change line as the viewer should read it: their own share says "Your share ₹205.88 → ₹244.48", not their name.
// Other people's lines keep their names.
export function viewerDetails(lines: string[], myName: string): string[] {
  const prefix = `${myName}’s share:`;
  return lines.map((l) => (myName && l.startsWith(prefix) ? `Your share ${l.slice(prefix.length).trim()}` : l));
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


// ---------------------------------------------------------------------------------------------------------------
// Who was in the group together (SB-1, SA-1): two people only count as "sharing a group" if their time in it overlapped.
// Pure, so it can be tested without a database.

type SpanRow = { createdAt: Date; claimedAt?: Date | null; seenAt?: Date | null; leftAt: Date | null; removedAt?: Date | null };
export type MembershipSpan = { from: Date; to: Date | null };

// When this person was really in the group: from the day they joined (claimed the name, else first opened it, else were added)
// to the day they left or were removed (null = still in).
export function membershipSpan(m: SpanRow): MembershipSpan {
  return { from: m.claimedAt ?? m.seenAt ?? m.createdAt, to: m.leftAt ?? m.removedAt ?? null };
}

// Were two people in the group at the same time? (The moment one left counts as overlapping with the moment the other joined, and a
// minute's grace either way keeps two things saved in the same breath, like a group made and one person leaving at once, from
// reading as "never there together".)
const OVERLAP_GRACE_MS = 60_000;
export function overlapped(a: MembershipSpan, b: MembershipSpan): boolean {
  const aTo = a.to ? a.to.getTime() + OVERLAP_GRACE_MS : Infinity;
  const bTo = b.to ? b.to.getTime() + OVERLAP_GRACE_MS : Infinity;
  return a.from.getTime() <= bTo && b.from.getTime() <= aTo;
}

// Two people's rows in groups: the first of A's rows that overlaps a row of B in the same group (null = never in a group at the same time).
export function sharedGroupRow<A extends SpanRow & { groupId: string }, B extends SpanRow & { groupId: string }>(aRows: A[], bRows: B[]): A | null {
  for (const a of aRows) {
    const sa = membershipSpan(a);
    if (bRows.some((b) => b.groupId === a.groupId && overlapped(sa, membershipSpan(b)))) return a;
  }
  return null;
}

// The people to count and name for this viewer: for someone who left, the group as it was on the day they left (still including
// themselves, and not anyone who joined later); for everyone else, the people still in. Used for head counts ("by 3 people", "each").
export function peopleShown<M extends { id: string; createdAt: Date; leftAt: Date | null; removedAt: Date | null }>(members: M[], me: string, cut: Date | null | undefined): M[] {
  return cut ? membersAsOf(members, me, cut).filter((m) => m.id === me || !m.leftAt) : members.filter((m) => !m.leftAt);
}

// ---------------------------------------------------------------------------------------------------------------
// MA-3: rows as they were on the day the person left.
//
// scopeForLeaver decides WHICH rows a leaver sees; this decides WHAT THEY SAY. An expense that was added before they left and
// changed or deleted afterwards (without them in it) is shown as it was on their last day: the name, amount and shares from
// before the change, and "deleted" only if it was deleted by then. Only what is shown changes: balances always come from the
// full ledger and are never passed through here.
//
// How we know the old state: every edit saves how to reverse it (`undo` = { type: "expense_revert", before }). The earliest change
// after the cut-off holds the state as it stood on that day. An expense edited after the cut-off by a change that saved no
// "before" (older lines) can't be rebuilt, so it is not shown rather than shown wrongly.

type StateShare = { memberId: string; amount: number };
type ExpenseBefore = Record<string, unknown> & { shares?: StateShare[] };
type AsOfExpense = ExpenseRow & { editedAt?: Date | null; deletedAt?: Date | null; deletedById?: string | null; shares: { memberId: string; amount?: number }[] };
type AsOfPayment = PaymentRow & { deletedAt?: Date | null; deletedById?: string | null };

const parseRevert = (undo: string | null | undefined): { before: ExpenseBefore } | null => {
  if (!undo) return null;
  try {
    const p = JSON.parse(undo);
    return p && p.type === "expense_revert" && p.before && typeof p.before === "object" ? { before: p.before as ExpenseBefore } : null;
  } catch {
    return null;
  }
};

// The columns of an expense that the saved "before" state carries.
const STATE_KEYS = [
  "description", "category", "amount", "splitType", "forMode", "paidById", "payers", "kind", "originalAmount", "originalCurrency",
  "baseCurrency", "exchangeRate", "rateDate", "rateSource", "convertedAmount", "paymentMethod", "markupBp", "markupAmount", "notes",
] as const;

// The earliest change of the given kinds for this row after the cut-off.
function firstAfter(evs: EventRow[], key: "expenseId" | "paymentId", id: string, kinds: string[]): EventRow | undefined {
  let best: EventRow | undefined;
  for (const ev of evs) {
    if (ev[key] !== id || !ev.kind || !kinds.includes(ev.kind)) continue;
    if (!best || ev.createdAt.getTime() < best.createdAt.getTime() || (ev.createdAt.getTime() === best.createdAt.getTime() && ev.id < best.id)) best = ev;
  }
  return best;
}

// The earliest change after the cut-off that saved how the expense stood before it (its "before" is the state on the cut-off day).
function firstRevert(evs: EventRow[], id: string): { before: ExpenseBefore } | null {
  const edits = evs.filter((ev) => ev.expenseId === id && ev.kind === "expense_edited" && parseRevert(ev.undo));
  edits.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  return edits.length ? parseRevert(edits[0].undo) : null;
}

// `later`: the group's changes after the cut-off (any order). Rows are the leaver's rows from scopeForLeaver, deleted ones too.
// A row that has them in it now, or that a later change touched them in, is left as it is (it is their own money).
export function asOfCut<E extends AsOfExpense, P extends AsOfPayment>(
  data: { expenses: E[]; payments: P[] },
  later: EventRow[],
  me: string,
  cut: Date,
): { expenses: E[]; payments: P[] } {
  const upTo = cut.getTime();
  const after = later.filter((ev) => ev.createdAt.getTime() > upTo);
  const touchedExpense = new Set<string>();
  const touchedPayment = new Set<string>();
  for (const ev of after) {
    if (!touchesOf(ev).includes(me)) continue;
    if (ev.expenseId) touchedExpense.add(ev.expenseId);
    if (ev.paymentId) touchedPayment.add(ev.paymentId);
  }
  const expenses: E[] = [];
  for (const e of data.expenses) {
    if (e.createdAt.getTime() > upTo || expenseInvolves(e, me) || touchedExpense.has(e.id)) {
      expenses.push(e);
      continue;
    }
    let row: E = e;
    const old = firstRevert(after, e.id);
    if (old) {
      const o: Record<string, unknown> = {};
      for (const k of STATE_KEYS) if (k in e && k in old.before) o[k] = old.before[k];
      if ("spentAt" in e && "spentAt" in old.before) o.spentAt = typeof old.before.spentAt === "string" ? new Date(old.before.spentAt) : (old.before.spentAt ?? null);
      row = {
        ...e,
        ...o,
        editedAt: null,
        shares: (old.before.shares ?? []).map((s) => ({ id: `${e.id}-${s.memberId}`, expenseId: e.id, memberId: s.memberId, amount: s.amount })),
      } as unknown as E;
    } else if (e.editedAt && e.editedAt.getTime() > upTo) {
      continue; // changed after they left and its earlier state isn't known: not shown
    }
    // Deleted or not, on the day they left: the first delete / bring-back after that day says which way it was.
    const toggle = firstAfter(after, "expenseId", e.id, ["expense_deleted", "expense_restored"]);
    const wasDeleted = toggle ? toggle.kind === "expense_restored" : Boolean(e.deletedAt && e.deletedAt.getTime() <= upTo);
    row = wasDeleted
      ? ({ ...row, deletedAt: e.deletedAt && e.deletedAt.getTime() <= upTo ? e.deletedAt : cut, ...("deletedById" in e && !(e.deletedAt && e.deletedAt.getTime() <= upTo) ? { deletedById: null } : {}) } as E)
      : ({ ...row, deletedAt: null, ...("deletedById" in e ? { deletedById: null } : {}) } as E);
    expenses.push(row);
  }
  const payments: P[] = data.payments.map((p) => {
    if (p.createdAt.getTime() > upTo || paymentInvolves(p, me) || touchedPayment.has(p.id)) return p;
    const toggle = firstAfter(after, "paymentId", p.id, ["payment_deleted", "payment_restored"]);
    const wasDeleted = toggle ? toggle.kind === "payment_restored" : Boolean(p.deletedAt && p.deletedAt.getTime() <= upTo);
    const was = p.deletedAt && p.deletedAt.getTime() <= upTo;
    return wasDeleted ? ({ ...p, deletedAt: was ? p.deletedAt : cut, ...("deletedById" in p && !was ? { deletedById: null } : {}) } as P) : ({ ...p, deletedAt: null, ...("deletedById" in p ? { deletedById: null } : {}) } as P);
  });
  return { expenses, payments };
}
