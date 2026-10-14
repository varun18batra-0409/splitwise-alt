import { originalShares } from "./currency-ledgers";

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
const GROUP_EVENT_KINDS = new Set(["group_renamed", "currency_changed", "markup_changed", "display_currency_changed", "members_added", "members_removed", "group_closed", "group_reopened"]);

export type ActivityItem =
  | {
      kind: "expense";
      id: string;
      date: Date;
      title: string;
      category: string;
      amount: number;
      paidById: string;
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

function originalOf(e: ExpenseRow, myId: string, deleted: boolean) {
  if (e.originalAmount === undefined || !e.originalCurrency || !e.baseCurrency || e.originalCurrency === e.baseCurrency) return null;
  const mine = originalShares({ amount: e.amount, originalAmount: e.originalAmount, originalCurrency: e.originalCurrency, paidById: e.paidById, shares: e.shares })
    .find((s) => s.memberId === myId)?.amount ?? 0;
  return {
    currency: e.originalCurrency,
    amount: e.originalAmount,
    effect: deleted ? 0 : (e.paidById === myId ? e.originalAmount : 0) - mine,
  };
}

export function buildActivity(expenses: ExpenseRow[], payments: PaymentRow[], myId: string, events: EventRow[] = []): ActivityItem[] {
  const items: ActivityItem[] = [
    ...expenses.map((e): ActivityItem => {
      const myShare = e.shares.find((s) => s.memberId === myId)?.amount ?? 0;
      const deleted = Boolean(e.deletedAt);
      return {
        kind: "expense",
        id: e.id,
        date: e.spentAt ?? e.createdAt,
        title: e.description,
        category: e.category,
        amount: e.amount,
        paidById: e.paidById,
        people: e.shares.map((s) => s.memberId),
        effect: deleted ? 0 : (e.paidById === myId ? e.amount : 0) - myShare,
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
export function dayLabel(date: Date, now = new Date(), timeZone = "Asia/Kolkata"): string {
  const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone }); // YYYY-MM-DD
  const today = key(now);
  const yesterday = key(new Date(now.getTime() - 86_400_000));
  const k = key(date);
  if (k === today) return "Today";
  if (k === yesterday) return "Yesterday";
  const sameYear = k.slice(0, 4) === today.slice(0, 4);
  return date.toLocaleDateString("en-GB", {
    timeZone,
    weekday: sameYear ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}

// Groups items under day headings, keeping order.
export function byDay<T extends { date: Date }>(items: T[], now = new Date()): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayLabel(item.date, now);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}
