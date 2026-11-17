import type { Prisma } from "@prisma/client";
import { payerIds } from "./payers";
import { rebaseExpense } from "./rebase";

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
type EventRow = { id: string; createdAt: Date; touches?: string | null; expenseId: string | null; paymentId: string | null; kind?: string; undo?: string | null; text?: string | null; details?: string | null };

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
  // The rows later changes touched them in, as the database reads them (touchedAfter in left-view-db.ts: no cap), so a long list of
  // later changes can never leave one out. Added to what the events given here show.
  touched?: { expenseIds: string[]; paymentIds: string[] },
): { expenses: E[]; payments: P[]; events: V[] } {
  const upTo = cut.getTime();
  // Changes after they left that moved their share.
  const touchedExpense = new Set<string>(touched?.expenseIds);
  const touchedPayment = new Set<string>(touched?.paymentIds);
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

type SpanRow = { createdAt: Date; claimedAt?: Date | null; seenAt?: Date | null; seenEventsAt?: Date | null; leftAt: Date | null; removedAt?: Date | null };
export type MembershipPeriod = { from: Date; to: Date | null };
// `from` / `to` cover the whole stay (first day in, last day out); `periods` lists each stay when someone left and came back.
export type MembershipSpan = { from: Date; to: Date | null; periods?: MembershipPeriod[] };
// A line from the group's history about one person going out or coming back (kind "member_left" / "member_rejoined"; removals and
// move-outs are "member_left" too, and a rejoin, an accepted invitation, an Undo or an automatic bring-back are "member_rejoined").
// kind "own_line": a line this person wrote themselves (they were the one who did it), whatever it was about. Only used to tell when a
// person who came back without a "came back" line was really back (see membershipPeriods); memberHistory adds the first one.
export type MemberChange = { kind: string; createdAt: Date };

// Structured marks in a history line's `details` (a line that starts with "@mark:"). They are for the code, not for people:
// parseDetails (events.ts) leaves them out of what is shown. One says "only the bill photo changed", another names the person a
// "came back" line is about when that line has no saved undo (the Undo of a move-out).
export const MARK = "@mark:";
export const PHOTO_ONLY_MARK = `${MARK}photo-only`;
export const memberMark = (memberId: string) => `${MARK}member=${memberId}`;
// Only the exact forms count: a line a person typed that merely starts with "@mark:" (a member named "@mark:Bob" in a share line)
// is an ordinary line and stays visible.
const MEMBER_MARK = /^@mark:member=([A-Za-z0-9_-]+)$/;
export const isMark = (line: string) => line === PHOTO_ONLY_MARK || MEMBER_MARK.test(line);

// Which person a "member_left" / "member_rejoined" line is about: it is in the saved undo text ({ type: "member_set", memberId }),
// or, for lines with no undo, in a member mark in the details.
export function memberOfChange(undo: string | null | undefined, details?: string | null): string | null {
  try {
    const p = JSON.parse(undo ?? "");
    if (p && p.type === "member_set" && typeof p.memberId === "string") return p.memberId;
  } catch {
    // no undo text: try the details
  }
  try {
    const lines: unknown = JSON.parse(details ?? "[]");
    const m = Array.isArray(lines) ? lines.find((l): l is string => typeof l === "string" && MEMBER_MARK.test(l)) : undefined;
    return m ? (MEMBER_MARK.exec(m)?.[1] ?? null) : null;
  } catch {
    return null;
  }
}

// Each stretch this person was really in the group. The row alone isn't enough: a person who leaves and is brought back (invitation,
// rejoin, bring-back when a payment is deleted, undo of a move-out) keeps the same row with leftAt cleared, so only the history
// says they were away in between. Starts when they joined (claimed the name, else first opened the group, else were added).
// With no history, one stretch from joining to leftAt / removedAt (as before). The last line of the row (leftAt / removedAt) wins
// for how it ends now. Pure.
export function membershipPeriods(m: SpanRow, history: MemberChange[] = [], now: Date = new Date()): MembershipPeriod[] {
  const start = m.claimedAt ?? m.seenAt ?? m.createdAt;
  const end = m.leftAt ?? m.removedAt ?? null;
  const changes = history
    .filter((c) => c.kind === "member_left" || c.kind === "member_rejoined")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const out: MembershipPeriod[] = [];
  let open: Date | null = start;
  for (const c of changes) {
    if (c.kind === "member_left") {
      if (open) {
        out.push({ from: open, to: c.createdAt.getTime() < open.getTime() ? open : c.createdAt });
        open = null;
      }
    } else if (!open) {
      open = c.createdAt;
    }
  }
  if (open) out.push({ from: open, to: null });
  const last = out[out.length - 1];
  // How the row stands now has the last word.
  if (end && last && last.to === null) last.to = end.getTime() < last.from.getTime() ? last.from : end;
  if (!end && last && last.to !== null) {
    // In the group now, but the last line says they left and no line says they came back (a rejoin from before those lines were
    // written). The old stay is NOT reopened: the gap stays a gap. The new stay starts now, the one point we can stand behind.
    // (Not seenEventsAt: the notifications stamp is also written for groups someone has left, so it can fall in the time they were
    // away and would connect them to people they were never there with. Every current way back writes a line.)
    // The new stay starts at the first line THIS person wrote after their last "left" line (they can only have done something in the
    // group once they were back in it), and only if there is none, now. Never earlier than the leave, so no overlap is invented; and
    // not later than it has to be, so a real return is not cut short.
    const own = history
      .filter((c) => c.kind === "own_line" && c.createdAt.getTime() >= last.to!.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    out.push({ from: own && own.createdAt.getTime() < now.getTime() ? own.createdAt : now, to: null });
  }
  return out;
}

// When this person was really in the group: from the day they joined to the day they left or were removed (null = still in).
// Pass the group's history lines for this person (see memberOfChange) to count a leave-and-come-back as two stays.
export function membershipSpan(m: SpanRow, history?: MemberChange[], now?: Date): MembershipSpan {
  const periods = membershipPeriods(m, history, now);
  return { from: periods[0].from, to: periods[periods.length - 1].to, periods };
}

// Were two people in the group at the same time? True only if one stay of A and one stay of B intersect. (The moment one left counts
// as overlapping with the moment the other joined, and a minute's grace either way keeps two things saved in the same breath, like a
// group made and one person leaving at once, from reading as "never there together".)
const OVERLAP_GRACE_MS = 60_000;
export function overlapped(a: MembershipSpan, b: MembershipSpan): boolean {
  const pa = a.periods ?? [{ from: a.from, to: a.to }];
  const pb = b.periods ?? [{ from: b.from, to: b.to }];
  return pa.some((x) => {
    const xTo = x.to ? x.to.getTime() + OVERLAP_GRACE_MS : Infinity;
    return pb.some((y) => {
      const yTo = y.to ? y.to.getTime() + OVERLAP_GRACE_MS : Infinity;
      return x.from.getTime() <= yTo && y.from.getTime() <= xTo;
    });
  });
}

// Two people's rows in groups: the first of A's rows that overlaps a row of B in the same group (null = never in a group at the same time).
// `spanOf` turns a row into its stays (give it the history; the default reads the row alone).
export function sharedGroupRow<A extends SpanRow & { groupId: string }, B extends SpanRow & { groupId: string }>(
  aRows: A[],
  bRows: B[],
  spanOf: (row: SpanRow & { groupId: string }) => MembershipSpan = (r) => membershipSpan(r),
): A | null {
  for (const a of aRows) {
    const sa = spanOf(a);
    if (bRows.some((b) => b.groupId === a.groupId && overlapped(sa, spanOf(b)))) return a;
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

// The words of the history line for a change to the bill photo only (written by save-expense.ts). Such a change moves no money and
// changes no word of the expense, so it must neither hide the row from a leaver nor roll it back. New lines carry PHOTO_ONLY_MARK in
// their details; the wording is kept as the check for lines written before that.
export const BILL_PHOTO_EDIT_PREFIX = "changed the bill photo on ";
function isPhotoOnlyEdit(ev: EventRow): boolean {
  if (ev.kind !== "expense_edited" || parseRevert(ev.undo)) return false;
  if (ev.details && ev.details.includes(PHOTO_ONLY_MARK)) {
    try {
      const lines: unknown = JSON.parse(ev.details);
      if (Array.isArray(lines) && lines.includes(PHOTO_ONLY_MARK)) return true;
    } catch {
      // not a list: fall back to the words
    }
  }
  return Boolean(ev.text?.startsWith(BILL_PHOTO_EDIT_PREFIX));
}

// Which payments a change line is about: its own paymentId, or (a "Mark all paid" / "Settle everything" and the Undo or Redo of it, which
// have no single payment) the ids in its saved undo text.
function paymentIdsOf(ev: EventRow): string[] {
  const ids = ev.paymentId ? [ev.paymentId] : [];
  if (!ev.undo) return ids;
  try {
    const p = JSON.parse(ev.undo);
    if (p && (p.type === "payments_set" || p.type === "settle_all") && Array.isArray(p.paymentIds)) for (const x of p.paymentIds) if (typeof x === "string") ids.push(x);
  } catch {
    // no ids to read
  }
  return ids;
}

// A line that takes payments off or puts them back: "deleted" or "restored" (null for anything else). "Settle everything" and its Undo
// and Redo are lines of their own kind ("group_settled_closed" / "group_reopened") carrying the payment ids.
function paymentToggle(ev: EventRow): "deleted" | "restored" | null {
  if (ev.kind === "payment_deleted" || ev.kind === "group_reopened") return "deleted";
  if (ev.kind === "payment_restored" || ev.kind === "group_settled_closed") return "restored";
  return null;
}

const byTime = (a: EventRow, b: EventRow) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// A group currency change, read from its history lines ("Rate used: 1 INR = 0.012 USD"), or an Undo of one ("Every amount is back
// exactly as it was"). Null if the lines don't say (a change with no money in the group).
type CurrencyStep = { kind: "rate"; from: string; to: string; rate: string } | { kind: "back"; from: string; to: string };
function currencyStep(ev: EventRow): CurrencyStep | null {
  try {
    const lines: unknown = JSON.parse(ev.details ?? "[]");
    if (!Array.isArray(lines)) return null;
    for (const l of lines) {
      const m = typeof l === "string" ? /^Rate used: 1 ([A-Z]{3}) = ([0-9.]+) ([A-Z]{3})$/.exec(l) : null;
      if (m) return { kind: "rate", from: m[1], to: m[3], rate: m[2] };
    }
    if (lines.includes("Every amount is back exactly as it was")) {
      const c = lines.map((l) => (typeof l === "string" ? /^Currency: ([A-Z]{3}) → ([A-Z]{3})$/.exec(l) : null)).find(Boolean);
      if (c) return { kind: "back", from: c[1], to: c[2] };
    }
  } catch {
    // unreadable: no step
  }
  return null;
}

// An expense's saved "before" state, carried through the group currency changes made AFTER that edit (the state is in the currency the
// group had then; the row is shown in the currency it has now), at the rate each change used. A change followed by its Undo is no
// change: the Undo puts every amount back exactly, so the state before the change is the state again. Null when it can't be done
// exactly (an unreadable step, a state without its original amount) so the caller never mixes currencies.
function inCurrentCurrency(before: ExpenseBefore, steps: EventRow[]): ExpenseBefore | null {
  let state = before;
  const stack: ExpenseBefore[] = [];
  for (const ev of steps) {
    const step = currencyStep(ev);
    if (!step) return null;
    if (step.kind === "back") {
      const was = stack.pop();
      if (!was || state.baseCurrency !== step.from) return null;
      state = was;
      continue;
    }
    const sh = state.shares ?? [];
    if (state.baseCurrency !== step.from) return null;
    if (typeof state.originalAmount !== "number" || typeof state.originalCurrency !== "string" || typeof state.exchangeRate !== "string" || typeof state.markupBp !== "number" || typeof state.markupAmount !== "number") return null;
    const r = rebaseExpense(
      { originalAmount: state.originalAmount, originalCurrency: state.originalCurrency, exchangeRate: state.exchangeRate, markupBp: state.markupBp, markupAmount: state.markupAmount, payers: typeof state.payers === "string" ? state.payers : "", shares: sh.map((x) => ({ id: x.memberId, memberId: x.memberId, amount: x.amount })) },
      step.from,
      step.to,
      step.rate,
    );
    if (!r) return null;
    stack.push(state);
    state = { ...state, baseCurrency: r.baseCurrency, exchangeRate: r.exchangeRate, rateSource: r.rateSource, convertedAmount: r.convertedAmount, markupAmount: r.markupAmount, amount: r.amount, payers: r.payers, shares: r.shares.map((x) => ({ memberId: x.id, amount: x.amount })) };
  }
  return state;
}

// `later`: the group's changes after the cut-off about rows (see laterRowEvents in left-view-db.ts: every one of them, the same for
// every screen), plus the group's currency changes. Any order. `complete: false` says the list was cut short (it never is in practice):
// nothing is known about how a row stood, so a row that doesn't have them in it is not shown, rather than shown with later content.
// Rows are the leaver's rows from scopeForLeaver, deleted ones too. A row that has them in it now, or that a later change touched
// them in, is left as it is (it is their own money, with or without a complete list).
// The lines are sorted and indexed by expense and by payment ONCE, so the work grows with the lines and rows, not their product.
export function asOfCut<E extends AsOfExpense, P extends AsOfPayment>(
  data: { expenses: E[]; payments: P[] },
  later: EventRow[],
  me: string,
  cut: Date,
  opts: { complete?: boolean } = {},
): { expenses: E[]; payments: P[] } {
  const upTo = cut.getTime();
  const complete = opts.complete !== false;
  const after = later.filter((ev) => ev.createdAt.getTime() > upTo).sort(byTime);
  const currencySteps: EventRow[] = [];
  const byExpense = new Map<string, EventRow[]>();
  const byPayment = new Map<string, EventRow[]>();
  const touchedExpense = new Set<string>();
  const touchedPayment = new Set<string>();
  const push = (m: Map<string, EventRow[]>, id: string, ev: EventRow) => {
    const list = m.get(id);
    if (list) list.push(ev);
    else m.set(id, [ev]);
  };
  for (const ev of after) {
    if (ev.kind === "currency_changed") currencySteps.push(ev);
    const mine = ev.touches ? touchesOf(ev).includes(me) : false;
    if (ev.expenseId) {
      push(byExpense, ev.expenseId, ev);
      if (mine) touchedExpense.add(ev.expenseId);
    }
    if (paymentToggle(ev) || ev.paymentId) {
      for (const id of paymentIdsOf(ev)) {
        push(byPayment, id, ev);
        if (mine) touchedPayment.add(id);
      }
    }
  }
  const expenses: E[] = [];
  for (const e of data.expenses) {
    if (e.createdAt.getTime() > upTo || expenseInvolves(e, me) || touchedExpense.has(e.id)) {
      expenses.push(e);
      continue;
    }
    if (!complete) continue; // the list of changes is cut short: how this row stood is not known, so it is not shown
    const mine = byExpense.get(e.id) ?? [];
    const edits = mine.filter((ev) => ev.kind === "expense_edited");
    const first = edits.find((ev) => parseRevert(ev.undo));
    const editedLater = Boolean(e.editedAt && e.editedAt.getTime() > upTo);
    let row: E = e;
    if (first) {
      // The earliest change that saved a "before": that is the row on the cut-off day, in the currency the group had then.
      const before = parseRevert(first.undo)!.before;
      const old = inCurrentCurrency(before, currencySteps.filter((ev) => byTime(ev, first) > 0));
      if (!old) continue; // a currency change we can't carry it through: not shown (never mixed currencies)
      const o: Record<string, unknown> = {};
      for (const k of STATE_KEYS) if (k in e && k in old) o[k] = old[k];
      if ("spentAt" in e && "spentAt" in old) o.spentAt = typeof old.spentAt === "string" ? new Date(old.spentAt) : (old.spentAt ?? null);
      // Older saved states have no notes / payers / kind: payers and kind then were what they were before those existed; notes are
      // unknown, so they stay hidden ("changed after you left"), never today's.
      if ("payers" in e && !("payers" in old)) o.payers = "";
      if ("kind" in e && !("kind" in old)) o.kind = "expense";
      const noNotes = "notes" in e && !("notes" in old);
      if (noNotes) o.notes = "";
      row = {
        ...e,
        ...o,
        editedAt: null,
        ...(noNotes && (e as { notes?: string | null }).notes ? { notesHidden: true } : {}),
        shares: (old.shares ?? []).map((s) => ({ id: `${e.id}-${s.memberId}`, expenseId: e.id, memberId: s.memberId, amount: s.amount })),
      } as unknown as E;
    } else if (editedLater) {
      // Edited since, with no saved "before". Only a change to the bill photo is known to change nothing else.
      const last = edits.length ? edits[edits.length - 1].createdAt.getTime() : 0;
      const onlyPhoto = edits.length > 0 && edits.every(isPhotoOnlyEdit) && e.editedAt!.getTime() <= last + 60_000;
      if (!onlyPhoto) continue; // changed after they left and its earlier state isn't known: not shown
      row = { ...e, editedAt: null };
    }
    // Deleted or not, on the day they left: the first delete / bring-back after that day says which way it was.
    const toggle = mine.find((ev) => ev.kind === "expense_deleted" || ev.kind === "expense_restored");
    const wasDeleted = toggle ? toggle.kind === "expense_restored" : Boolean(e.deletedAt && e.deletedAt.getTime() <= upTo);
    row = wasDeleted
      ? ({ ...row, deletedAt: e.deletedAt && e.deletedAt.getTime() <= upTo ? e.deletedAt : cut, ...("deletedById" in e && !(e.deletedAt && e.deletedAt.getTime() <= upTo) ? { deletedById: null } : {}) } as E)
      : ({ ...row, deletedAt: null, ...("deletedById" in e ? { deletedById: null } : {}) } as E);
    expenses.push(row);
  }
  const payments: P[] = [];
  for (const p of data.payments) {
    if (p.createdAt.getTime() > upTo || paymentInvolves(p, me) || touchedPayment.has(p.id)) {
      payments.push(p);
      continue;
    }
    if (!complete) continue;
    const toggle = (byPayment.get(p.id) ?? []).find((ev) => paymentToggle(ev));
    const wasDeleted = toggle ? paymentToggle(toggle) === "restored" : Boolean(p.deletedAt && p.deletedAt.getTime() <= upTo);
    const was = p.deletedAt && p.deletedAt.getTime() <= upTo;
    payments.push(wasDeleted ? ({ ...p, deletedAt: was ? p.deletedAt : cut, ...("deletedById" in p && !was ? { deletedById: null } : {}) } as P) : ({ ...p, deletedAt: null, ...("deletedById" in p ? { deletedById: null } : {}) } as P));
  }
  return { expenses, payments };
}
