import { getCategory } from "./categories";
import { DEFAULT_TIME_ZONE, dayKey, formatter, isDayMarker, isTimeZone } from "./dates";
import { moneyLines, payerIds, scalePayers } from "./payers";
import { parseAmount } from "./money";

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
  notes?: string;
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
};
type EventRow = { id: string; kind: string; actorId: string; text: string; details: string; createdAt: Date };

// Group-level changes shown as their own lines (expense/payment changes show on the item itself).
const GROUP_EVENT_KINDS = new Set(["group_renamed", "currency_changed", "markup_changed", "display_currency_changed", "members_added", "members_removed", "group_closed", "group_reopened", "split_changed"]);

export type ActivityItem =
  | {
      kind: "expense";
      id: string;
      date: Date;
      title: string;
      notes?: string;
      category: string;
      amount: number;
      paidById: string;
      payerIds: string[]; // everyone who paid (usually just paidById); for money back, who got it
      refund: boolean; // money back
      people: string[]; // who it was for
      effect: number; // + you're owed this much more, − you owe this much more, 0 not involved
      createdById: string;
      edited: boolean;
      deletedById: string | null; // set when deleted
      // For foreign-currency expenses: the same, in that currency, without card markup.
      original: { currency: string; amount: number; effect: number } | null;
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

export function buildActivity(expenses: ExpenseRow[], payments: PaymentRow[], myId: string, events: EventRow[] = []): ActivityItem[] {
  const items: ActivityItem[] = [
    ...expenses.map((e): ActivityItem => {
      const deleted = Boolean(e.deletedAt);
      return {
        kind: "expense",
        id: e.id,
        date: e.spentAt ?? e.createdAt,
        title: e.description,
        notes: e.notes ?? "",
        category: e.category,
        amount: e.amount,
        paidById: e.paidById,
        payerIds: payerIds(e),
        refund: e.kind === "refund",
        people: e.shares.map((s) => s.memberId),
        effect: deleted ? 0 : effectFor(e, myId),
        createdById: e.createdById ?? e.paidById,
        edited: Boolean(e.editedAt),
        deletedById: deleted ? (e.deletedById ?? "") : null,
        original: originalOf(e, myId, deleted),
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
      }),
    ),
    ...events
      .filter((e) => GROUP_EVENT_KINDS.has(e.kind))
      .map((e): ActivityItem => ({ kind: "event", id: e.id, date: e.createdAt, actorId: e.actorId, text: e.text, details: e.details, effect: 0 })),
  ];
  return items.sort((a, b) => b.date.getTime() - a.date.getTime());
}

// "Today", "Yesterday", "Mon 12 Oct", or "12 Oct 2025" for older years.
export function dayLabel(date: Date, now = new Date(), timeZone: string = DEFAULT_TIME_ZONE): string {
  if (!isTimeZone(timeZone)) timeZone = DEFAULT_TIME_ZONE;
  const tz = timeZone;
  const key = (d: Date) => dayKey(d, tz); // YYYY-MM-DD
  const today = key(now);
  const yesterday = key(new Date(now.getTime() - 86_400_000));
  const k = key(date);
  if (k === today) return "Today";
  if (k === yesterday) return "Yesterday";
  const sameYear = k.slice(0, 4) === today.slice(0, 4);
  return formatter("en-GB", {
    timeZone: isDayMarker(date) ? "UTC" : timeZone,
    ...(sameYear ? { weekday: "short" } : { year: "numeric" }),
    day: "numeric",
    month: "short",
  }).format(date);
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
    return matches(`${item.title} ${item.notes ?? ""} ${cat.label} ${paidBy.map(nameOf).join(" ")} ${item.people.map(nameOf).join(" ")}`);
  });
}
