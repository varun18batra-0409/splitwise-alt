import { neutralGameText } from "./game-words";
import { PLAIN_WORDS, getCategory } from "./categories";
import { DEFAULT_TIME_ZONE, dayKey, formatter, isDayMarker, isTimeZone } from "./dates";
import { moneyLines, payerIds, scalePayers } from "./payers";
import { parseAmount } from "./money";
import { addDays } from "./local-time";

// One history list for a group: expenses, settle-up payments and group changes
// (renamed, currency changed, people added, closed…), newest first, each with
// what it meant for "me". Foreign-currency expenses also carry the amounts in
// their own currency (without card markup). Deleted items stay in the list, marked as deleted,
// and count for nothing.

type ExpenseRow = {
  id: string;
  description: string;
  category: string;
  amount: number;
  paidById: string;
  payers?: string | null;
  kind?: string | null;
  createdAt: Date;
  shares: { memberId: string; amount: number }[];
  createdById?: string;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  deletedById?: string | null;
  spentAt?: Date | null; // the day it was spent, if chosen
  originalAmount?: number;
  originalCurrency?: string;
  baseCurrency?: string;
  markupBp?: number; // card fee on a foreign-currency expense, hundredths of a % (300 = 3%)
  notes?: string;
  notesHidden?: boolean; // the viewer left before this was last changed: its notes are not shown
};
type PaymentRow = {
  id: string;
  fromId: string;
  toId: string;
  amount: number;
  createdAt: Date;
  createdById?: string;
  deletedAt?: Date | null;
  deletedById?: string | null;
  needsOk?: boolean;
  okAt?: Date | null;
};
type EventRow = { id: string; kind: string; actorId: string; text: string; details: string; createdAt: Date };

// Group-level changes shown as their own lines (expense/payment changes show on the item itself).
const GROUP_EVENT_KINDS = new Set(["group_renamed", "currency_changed", "markup_changed", "display_currency_changed", "members_added", "members_removed", "group_closed", "group_reopened", "split_changed", "trip_dates_set", "countdown_shared", "pot_started", "pot_finished", "pot_reopened", "pot_deleted", "pot_line_removed", "bill_added", "bill_changed", "group_imported", "payment_note_closed"]);

export type ActivityItem =
  | {
      kind: "expense";
      id: string;
      date: Date;
      title: string;
      notes?: string;
      notesHidden?: boolean;
      category: string;
      amount: number;
      paidById: string;
      payerIds: string[]; // everyone who paid (usually just paidById); for money back, who got it
      refund: boolean; // money back
      pot?: boolean; // a game's result (Game night): those ahead up, those behind down
      people: string[]; // who it was for
      effect: number; // + you're owed this much more, − you owe this much more, 0 not involved
      createdById: string;
      edited: boolean;
      deletedById: string | null; // set when deleted
      // For foreign-currency expenses: the same, in that currency, without card markup.
      original: { currency: string; amount: number; effect: number } | null;
      cardFeeBp: number; // card fee included in the amount (hundredths of a %), 0 when none
    }
  | {
      kind: "payment";
      id: string;
      date: Date;
      fromId: string;
      toId: string;
      amount: number;
      effect: number;
      createdById: string;
      deletedById: string | null;
      status?: "waiting" | "ok"; // payment tracking: waiting for the person paid to confirm, or confirmed
    }
  | { kind: "event"; id: string; date: Date; actorId: string; text: string; details: string; effect: 0 };

// What this expense did to my balance: + I'm owed more, − I owe more.
function effectFor(e: ExpenseRow, myId: string, total?: number): number {
  const { credits, debits } = moneyLines(e);
  const scale = (l: { memberId: string; amount: number }[]) => (total === undefined ? l : scalePayers(l, total));
  const mine = (l: { memberId: string; amount: number }[]) => scale(l).find((x) => x.memberId === myId)?.amount ?? 0;
  return mine(credits) - mine(debits);
}

function originalOf(e: ExpenseRow, myId: string, deleted: boolean) {
  if (e.originalAmount === undefined || !e.originalCurrency || !e.baseCurrency || e.originalCurrency === e.baseCurrency) return null;
  return {
    currency: e.originalCurrency,
    amount: e.originalAmount,
    effect: deleted ? 0 : effectFor(e, myId, e.originalAmount),
  };
}

// `asks`: the ids of a flat move-out's final payments (moveOutPaymentIds). Only those can be "waiting" for the person paid to say Got it / Not received;
// every other payment counts at once and reads plainly ("Asha paid Ravi"), even an older one flagged needsOk by the earlier rule.
// A payment that was confirmed (okAt set) still shows "Confirmed ✓", because that is what happened.
export function buildActivity(expenses: ExpenseRow[], payments: PaymentRow[], myId: string, events: EventRow[] = [], asks?: Set<string>): ActivityItem[] {
  const items: ActivityItem[] = [
    ...expenses.map((e): ActivityItem => {
      const deleted = Boolean(e.deletedAt);
      return {
        kind: "expense",
        id: e.id,
        date: e.spentAt ?? e.createdAt,
        title: e.kind === "pot" ? neutralGameText(e.description) : e.description,
        notes: e.notes ?? "",
        notesHidden: e.notesHidden || undefined,
        category: e.category,
        amount: e.amount,
        paidById: e.paidById,
        payerIds: payerIds(e),
        refund: e.kind === "refund",
        pot: e.kind === "pot",
        people: e.shares.map((s) => s.memberId),
        effect: deleted ? 0 : effectFor(e, myId),
        createdById: e.createdById ?? e.paidById,
        edited: Boolean(e.editedAt),
        deletedById: deleted ? (e.deletedById ?? "") : null,
        original: originalOf(e, myId, deleted),
        cardFeeBp: originalOf(e, myId, deleted) && e.markupBp && e.markupBp > 0 ? e.markupBp : 0,
      };
    }),
    ...payments.map(
      (p): ActivityItem => ({
        kind: "payment",
        id: p.id,
        date: p.createdAt,
        fromId: p.fromId,
        toId: p.toId,
        amount: p.amount,
        effect: p.deletedAt ? 0 : p.fromId === myId ? p.amount : p.toId === myId ? -p.amount : 0,
        createdById: p.createdById ?? p.fromId,
        deletedById: p.deletedAt ? (p.deletedById ?? "") : null,
        status: p.okAt ? "ok" : p.needsOk && asks?.has(p.id) ? "waiting" : undefined,
      }),
    ),
    ...events
      .filter((e) => GROUP_EVENT_KINDS.has(e.kind))
      .map((e): ActivityItem => ({ kind: "event", id: e.id, date: e.createdAt, actorId: e.actorId, text: neutralGameText(e.text), details: e.details, effect: 0 })),
  ];
  return items.sort((a, b) => b.date.getTime() - a.date.getTime());
}

// "Today", "Yesterday", "Mon 12 Oct", or "12 Oct 2025" for older years.
export function dayLabel(date: Date, now = new Date(), timeZone: string = DEFAULT_TIME_ZONE): string {
  if (!isTimeZone(timeZone)) timeZone = DEFAULT_TIME_ZONE;
  const tz = timeZone;
  const key = (d: Date) => dayKey(d, tz); // YYYY-MM-DD
  const today = key(now);
  const yesterday = addDays(today, -1); // calendar day before, right across clock changes
  const k = key(date);
  if (k === today) return "Today";
  if (k === yesterday) return "Yesterday";
  const sameYear = k.slice(0, 4) === today.slice(0, 4);
  return formatter("en-GB", {
    timeZone: isDayMarker(date) ? "UTC" : timeZone,
    ...(sameYear ? { weekday: "short" } : { year: "numeric" }),
    day: "numeric",
    month: "short",
  }).format(date).replace("Sept", "Sep"); // "Sep", never "Sept": one spelling everywhere
}

// Groups items under day headings, keeping order.
export function byDay<T extends { date: Date }>(items: T[], now = new Date(), timeZone?: string): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayLabel(item.date, now, timeZone);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}

// Search and filter for a group's history. Any mix of: words (matched against
// the expense name, category and people), category, person, type, dates,
// who paid and amount.
export type ActivityFilter = {
  q?: string; // words
  cat?: string; // category id
  who?: string; // anyone involved (paid or shared)
  type?: "expense" | "payment" | "refund" | "change";
  from?: string; // "2026-10-01", inclusive
  to?: string; // inclusive
  by?: string; // who paid (any payer); for money back, who got it
  min?: string; // amount as typed, in the group currency
  max?: string;
  tz?: string; // for which day something happened
  currency?: string; // the group currency, to read min / max
};

export function hasFilter(f: ActivityFilter): boolean {
  return Boolean(f.q?.trim() || f.cat || f.who || f.type || f.from || f.to || f.by || f.min?.trim() || f.max?.trim());
}

export function filterActivity(items: ActivityItem[], f: ActivityFilter, nameOf: (id: string) => string): ActivityItem[] {
  if (!hasFilter(f)) return items;
  const words = (f.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (text: string) => {
    const t = text.toLowerCase();
    return words.every((w) => t.includes(w));
  };
  const min = f.min?.trim() ? parseAmount(f.min, f.currency ?? "INR") : null;
  const max = f.max?.trim() ? parseAmount(f.max, f.currency ?? "INR") : null;
  const amountOk = (a: number) => (min === null || a >= min) && (max === null || a <= max);
  const dayOk = (d: Date) => {
    const k = dayKey(d, f.tz);
    return (!f.from || k >= f.from) && (!f.to || k <= f.to);
  };
  return items.filter((item) => {
    if (!dayOk(item.date)) return false;
    if (item.kind === "event") {
      // Group changes only show up for a plain word search, or "changes".
      if (f.type && f.type !== "change") return false;
      if (f.cat || f.who || f.by || min !== null || max !== null) return false;
      return matches(`${nameOf(item.actorId)} ${item.text}`);
    }
    if (f.type === "change") return false;
    if (item.kind === "payment") {
      if (f.type && f.type !== "payment") return false;
      if (f.cat) return false;
      if (f.who && item.fromId !== f.who && item.toId !== f.who) return false;
      if (f.by && item.fromId !== f.by) return false;
      if (!amountOk(item.amount)) return false;
      return matches(`${nameOf(item.fromId)} paid ${nameOf(item.toId)} payment settle-up`);
    }
    if (f.type === "payment" || (f.type === "refund" && !item.refund) || (f.type === "expense" && item.refund)) return false;
    if (!amountOk(item.amount)) return false;
    const paidBy = item.payerIds ?? [item.paidById];
    if (f.by && !paidBy.includes(f.by)) return false;
    const cat = getCategory(item.category);
    if (f.cat && cat.id !== f.cat) return false;
    if (f.who && !paidBy.includes(f.who) && !item.people.includes(f.who)) return false;
    return matches(`${item.title} ${item.notes ?? ""} ${cat.label} ${PLAIN_WORDS[cat.id] ?? ""} ${paidBy.map(nameOf).join(" ")} ${item.people.map(nameOf).join(" ")}`);
  });
}

// The address of the Activity tab with the given filters (and, for "Show more", a longer list).
export function activityHref(groupId: string, f: ActivityFilter, n?: number): string {
  const q = new URLSearchParams({ tab: "activity", ...(n ? { n: String(n) } : {}) });
  const keep: [string, string | undefined][] = [
    ["q", f.q],
    ["cat", f.cat],
    ["who", f.who],
    ["type", f.type],
    ["from", f.from],
    ["to", f.to],
    ["by", f.by],
    ["min", f.min?.trim()],
    ["max", f.max?.trim()],
  ];
  for (const [k, v] of keep) if (v) q.set(k, v);
  return `/groups/${groupId}?${q}`;
}

// "Show more" keeps every filter.
export function activityMoreHref(groupId: string, f: ActivityFilter, n: number): string {
  return activityHref(groupId, f, n);
}

const DAY = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`)).replace("Sept", "Sep");
const TYPE_WORDS: Record<string, string> = { expense: "Expenses", payment: "Payments", refund: "Money back", change: "Changes" };

// One small chip for each filter in use; tapping a chip opens the same list without that one filter.
export function filterChips(
  groupId: string,
  f: ActivityFilter,
  words: { cat: (id: string) => string; person: (id: string) => string },
): { key: string; label: string; href: string }[] {
  const without = (...keys: (keyof ActivityFilter)[]) => {
    const rest = { ...f };
    for (const k of keys) delete rest[k];
    return activityHref(groupId, rest);
  };
  const out: { key: string; label: string; href: string }[] = [];
  if (f.q?.trim()) out.push({ key: "q", label: `“${f.q.trim().slice(0, 24)}”`, href: without("q") });
  if (f.type) out.push({ key: "type", label: TYPE_WORDS[f.type] ?? f.type, href: without("type") });
  if (f.cat) out.push({ key: "cat", label: words.cat(f.cat), href: without("cat") });
  if (f.who) out.push({ key: "who", label: words.person(f.who), href: without("who") });
  if (f.by) out.push({ key: "by", label: `Paid by ${words.person(f.by)}`, href: without("by") });
  if (f.from || f.to) out.push({ key: "dates", label: f.from && f.to ? `${DAY(f.from)} – ${DAY(f.to)}` : f.from ? `From ${DAY(f.from)}` : `Until ${DAY(f.to!)}`, href: without("from", "to") });
  if (f.min?.trim() || f.max?.trim()) out.push({ key: "amount", label: f.min?.trim() && f.max?.trim() ? `${f.min.trim()} – ${f.max.trim()}` : f.min?.trim() ? `From ${f.min.trim()}` : `Up to ${f.max!.trim()}`, href: without("min", "max") });
  return out;
}

// The small grey line under a card-paid foreign expense: "incl. 3% card fee" (the real percentage; 350 is "3.5%"). "" when no fee was added.
export function cardFeeLabel(bp: number): string {
  if (!(bp > 0)) return "";
  const pct = bp / 100;
  return `incl. ${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, "")}% card fee`;
}

// Busy groups show the latest PAGE items first, with "Show more".
export const ACTIVITY_PAGE = 60;

// The expenses on the page the Activity tab draws for these filters (the tab and the screen's reaction read share this one list,
// so reactions are only read for rows that are shown). `shown` is how many rows were asked for ("Show more").
export function shownExpenseIds(
  v: { group: { members: { id: string; name: string }[]; expenses: ExpenseRow[]; payments: PaymentRow[]; events: EventRow[] }; myId: string; moveOutIds?: Set<string> },
  filter: ActivityFilter,
  shown: number = ACTIVITY_PAGE,
): string[] {
  const { group, myId } = v;
  const searchName = (id: string) => {
    const name = group.members.find((m) => m.id === id)?.name ?? "";
    return id === myId ? `${name} you` : name;
  };
  const items = filterActivity(buildActivity(group.expenses, group.payments, myId, group.events, v.moveOutIds), filter, searchName);
  return items.slice(0, Math.max(ACTIVITY_PAGE, Math.min(5000, shown))).filter((i) => i.kind === "expense").map((i) => i.id);
}
