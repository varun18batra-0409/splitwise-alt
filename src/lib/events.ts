import type { Prisma, PrismaClient } from "@prisma/client";
import { getCategory } from "./categories";
import { formatMoney, formatPercent } from "./money";
import { niceDate } from "./format";
import { moneyLines, parsePayers } from "./payers";
import { after } from "next/server";

// Phone notifications go out after the response is sent (so after the change
// is saved). Outside a request — tests, scripts — nothing is sent.
function schedulePush(eventId: string) {
  try {
    after(async () => {
      const { sendEventPush } = await import("./push");
      await sendEventPush(eventId);
    });
  } catch {
    /* not inside a request */
  }
}

// The group's change history. Every add / edit / delete / settings change is
// written here; it powers both the history shown in the group and the
// notifications everyone else sees.

export type EventKind =
  | "expense_added"
  | "expense_edited"
  | "expense_deleted"
  | "expense_restored"
  | "payment_recorded"
  | "payment_deleted"
  | "payment_restored"
  | "payment_confirmed"
  | "payment_claimed"
  | "group_renamed"
  | "currency_changed"
  | "markup_changed"
  | "display_currency_changed"
  | "members_added"
  | "member_invited"
  | "members_removed"
  | "member_renamed"
  | "member_left"
  | "member_rejoined"
  | "group_settled_closed"
  | "group_deleted"
  | "group_restored"
  | "group_closed"
  | "group_reopened"
  | "split_changed"
  | "trip_dates_set"
  | "countdown_shared"
  | "pot_started"
  | "pot_finished"
  | "pot_reopened"
  | "pot_deleted"
  | "bill_added"
  | "bill_changed"
  | "group_imported";

export type Db = PrismaClient | Prisma.TransactionClient;

// Everything needed to put an expense back exactly as it was.
export type ExpenseState = {
  description: string;
  category: string;
  amount: number;
  splitType: string;
  forMode: string;
  paidById: string;
  payers?: string; // more than one payer (JSON); missing/"" = just paidById
  kind?: string; // "expense" | "refund"; missing = expense
  originalAmount: number;
  originalCurrency: string;
  baseCurrency: string;
  exchangeRate: string;
  rateDate: string;
  rateSource: string;
  convertedAmount: number;
  paymentMethod: string;
  markupBp: number;
  markupAmount: number;
  spentAt: string | null; // the chosen day, as an ISO time; null = the day it was added
  notes?: string; // missing in changes saved before notes existed
  shares: { memberId: string; amount: number }[];
};

export function expenseState(
  e: Omit<ExpenseState, "spentAt" | "notes" | "payers" | "kind"> & { spentAt?: Date | string | null; notes?: string; payers?: string | null; kind?: string | null },
): ExpenseState {
  return {
    description: e.description,
    category: e.category,
    amount: e.amount,
    splitType: e.splitType,
    forMode: e.forMode,
    paidById: e.paidById,
    payers: e.payers ?? "",
    kind: e.kind ?? "expense",
    originalAmount: e.originalAmount,
    originalCurrency: e.originalCurrency,
    baseCurrency: e.baseCurrency,
    exchangeRate: e.exchangeRate,
    rateDate: e.rateDate,
    rateSource: e.rateSource,
    convertedAmount: e.convertedAmount,
    paymentMethod: e.paymentMethod,
    markupBp: e.markupBp,
    markupAmount: e.markupAmount,
    spentAt: e.spentAt instanceof Date ? e.spentAt.toISOString() : (e.spentAt ?? null),
    notes: e.notes ?? "",
    shares: e.shares.map((s) => ({ memberId: s.memberId, amount: s.amount })),
  };
}

// How to reverse a change. Stored with each event; undoing it is itself a
// logged, undoable change (so "undo" can always be followed by "redo").
export type UndoPayload =
  | { type: "expense_delete"; expenseId: string }
  | { type: "expense_restore"; expenseId: string }
  | { type: "expense_revert"; expenseId: string; before: ExpenseState }
  | { type: "payment_delete"; paymentId: string }
  | { type: "payment_restore"; paymentId: string }
  | { type: "group_set"; data: { name?: string; cardMarkupBp?: number; secondaryCurrency?: string; closed?: boolean; closedAt?: string | null } }
  | {
      type: "currency_restore";
      currency: string;
      expenses: {
        id: string;
        baseCurrency: string;
        exchangeRate: string;
        rateSource: string;
        convertedAmount: number;
        markupAmount: number;
        amount: number;
        payers?: string; // missing in changes made before several payers existed
        shares: { id: string; amount: number }[];
      }[];
      payments: { id: string; amount: number }[];
      // Everything else that holds money in the group's currency (missing in
      // changes made before these were converted too).
      other?: OtherMoney;
      after?: OtherMoney; // the amounts as the change left them (to spot changes since)
    }
  | { type: "members_remove"; memberIds: string[] }
  | {
      type: "members_restore";
      // accountId … joinedFrom: missing in changes saved before they were kept.
      members: { id: string; name: string; phone: string; createdAt: string; accountId?: string | null; claimedAt?: string | null; splitWeight?: number; notify?: string; joinedFrom?: string | null; addedBy?: string; seenAt?: string | null }[];
    }
  | { type: "member_set"; memberId: string; data: { name?: string; leftAt?: string | null; removedAt?: string | null; removedById?: string }; moveOut?: MoveOutUndo }
  | { type: "settle_all"; paymentIds: string[]; apply: boolean }
  | { type: "payments_set"; paymentIds: string[]; deleted: boolean };

// Money kept outside expenses and payments, in the group's currency.
// What a move-out changed besides the person (bill payers and rotations, and
// the deposit handed over), so undoing it puts those back too.
export type MoveOutUndo = {
  // Daily-bill shares charged at move-out (one expense each), taken off again by the undo.
  prepaid?: { billId: string; period: string; expenseId: string }[];
  bills: { id: string; before: { payer: string; rotation: string; split: string }; after: { payer: string; rotation: string; split: string } }[];
  deposit?: {
    leaverShareId: string;
    receiverShareId: string;
    created: boolean; // the receiver had no share before
    receiverBefore: { amount: number; status: string };
    receiverAfter: { amount: number; status: string };
  };
};

export type OtherMoney = {
  settleMin: number;
  bills: { id: string; amount: number; split: string }[];
  budgets: { id: string; amount: number }[];
  goals: { id: string; target: number }[];
  goalEntries: { id: string; amount: number }[];
  depositShares: { id: string; amount: number; returnedAmount: number }[];
  potMoves: { id: string; amount: number }[];
};

export function parseUndo(json: string): UndoPayload | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && typeof v.type === "string" ? (v as UndoPayload) : null;
  } catch {
    return null;
  }
}

// An expense as far as "whose balance does it move" is concerned.
export type Involved = {
  paidById: string;
  amount: number;
  payers?: string | null;
  kind?: string | null;
  shares: { memberId: string; amount: number }[];
};

// What an expense does to each person: money they put in minus their share
// (money back flips the signs, like the balances do).
function effectOf(x: Involved): Map<string, number> {
  const { credits, debits } = moneyLines(x);
  const out = new Map<string, number>();
  for (const c of credits) out.set(c.memberId, (out.get(c.memberId) ?? 0) + c.amount);
  for (const d of debits) out.set(d.memberId, (out.get(d.memberId) ?? 0) - d.amount);
  return out;
}

// Whose balance a change to an expense moved. Adding, deleting or restoring (only one side given)
// touches everyone in it; an edit touches only those whose money in or share actually changed.
export function touchedByExpense(before: Involved | null, after: Involved | null): string[] {
  const a = before ? effectOf(before) : new Map<string, number>();
  const b = after ? effectOf(after) : new Map<string, number>();
  const ids = new Set([...a.keys(), ...b.keys()]);
  if (!before || !after) return [...ids];
  return [...ids].filter((id) => (a.get(id) ?? 0) !== (b.get(id) ?? 0));
}

export function parseTouches(csv: string | null | undefined): string[] {
  return csv ? csv.split(",").filter(Boolean) : [];
}

// Used when the caller doesn't say: everyone in the expense or payment the event is about
// (and in the payments of a "settle everyone" step), read as they are right now.
async function touchesFromDb(db: Db, e: { expenseId?: string; paymentId?: string; undo?: UndoPayload }): Promise<string[]> {
  const ids = new Set<string>();
  try {
    if (e.expenseId) {
      const x = await db.expense.findUnique({ where: { id: e.expenseId }, include: { shares: true } });
      if (x) for (const id of touchedByExpense(null, x)) ids.add(id);
    }
    const paymentIds = [...(e.paymentId ? [e.paymentId] : []), ...(e.undo && (e.undo.type === "settle_all" || e.undo.type === "payments_set") ? e.undo.paymentIds : [])];
    if (paymentIds.length) {
      for (const p of await db.payment.findMany({ where: { id: { in: paymentIds } }, select: { fromId: true, toId: true } })) {
        ids.add(p.fromId);
        ids.add(p.toId);
      }
    }
  } catch {
    /* never let this break the change being logged */
  }
  return [...ids];
}

export async function logEvent(
  db: Db,
  e: {
    groupId: string;
    actorId: string;
    kind: EventKind;
    text: string;
    details?: string[];
    expenseId?: string;
    paymentId?: string;
    undo?: UndoPayload;
    // Whose balance this moved (member ids). Left out = worked out from the expense or payment.
    touches?: string[];
  },
): Promise<string> {
  const touches = e.touches ?? (e.expenseId || e.paymentId || e.undo ? await touchesFromDb(db, e) : []);
  const created = await db.groupEvent.create({
    data: {
      groupId: e.groupId,
      actorId: e.actorId,
      kind: e.kind,
      text: e.text,
      details: JSON.stringify(e.details ?? []),
      expenseId: e.expenseId ?? null,
      paymentId: e.paymentId ?? null,
      undo: e.undo ? JSON.stringify(e.undo) : "",
      touches: [...new Set(touches)].join(","),
    },
  });
  schedulePush(created.id);
  return created.id;
}

export function parseDetails(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// The fields of an expense that people care about when it changes.
export type ExpenseSnapshot = {
  description: string;
  category: string;
  amount: number; // final, in base currency
  baseCurrency: string;
  originalAmount: number;
  originalCurrency: string;
  exchangeRate: string;
  paymentMethod: string;
  markupBp: number;
  paidById: string;
  payers?: string | null;
  kind?: string | null;
  forMode: string;
  splitType: string;
  day?: string; // "2026-10-14"
  notes?: string;
  shares: { memberId: string; amount: number }[];
};

const SPLIT: Record<string, string> = { equal: "equally", exact: "by amounts", percent: "by percentage", shares: "by shares" };
const FOR: Record<string, string> = { everyone: "everyone", selected: "selected people", one: "one person" };
const PAID_WITH: Record<string, string> = { card: "card", cash: "cash", bank: "bank / UPI", "": "—" };

// Human-readable list of what changed, e.g. ["Amount: THB 3,000 → THB 3,500", "Paid by: Asha → Ravi"].
export function diffExpense(before: ExpenseSnapshot, after: ExpenseSnapshot, nameOf: (id: string) => string): string[] {
  const out: string[] = [];
  const add = (label: string, a: string, b: string) => {
    if (a !== b) out.push(`${label}: ${a} → ${b}`);
  };
  add("Name", before.description, after.description);
  const kindText = (k?: string | null) => (k === "refund" ? "Money back" : "Money spent");
  add("Type", kindText(before.kind), kindText(after.kind));
  if (before.day && after.day) add("Date", niceDate(before.day), niceDate(after.day));
  add("Amount", formatMoney(before.originalAmount, before.originalCurrency), formatMoney(after.originalAmount, after.originalCurrency));
  if (before.originalCurrency !== before.baseCurrency || after.originalCurrency !== after.baseCurrency) {
    add("Exchange rate", before.exchangeRate, after.exchangeRate);
    add("Paid with", PAID_WITH[before.paymentMethod] ?? before.paymentMethod, PAID_WITH[after.paymentMethod] ?? after.paymentMethod);
    add("Card markup", formatPercent(before.markupBp), formatPercent(after.markupBp));
  }
  if (before.originalCurrency !== after.originalCurrency || before.amount !== after.amount) {
    add("Group total", formatMoney(before.amount, before.baseCurrency), formatMoney(after.amount, after.baseCurrency));
  }
  add("Category", getCategory(before.category).label, getCategory(after.category).label);
  const paidBy = (x: ExpenseSnapshot) => {
    const list = parsePayers(x.payers);
    return list.length ? list.map((p) => `${nameOf(p.memberId)} ${formatMoney(p.amount, x.baseCurrency)}`).join(" + ") : nameOf(x.paidById);
  };
  add("Paid by", paidBy(before), paidBy(after));
  add("For", FOR[before.forMode] ?? before.forMode, FOR[after.forMode] ?? after.forMode);
  add("Split", SPLIT[before.splitType] ?? before.splitType, SPLIT[after.splitType] ?? after.splitType);
  if ((before.notes ?? "") !== (after.notes ?? "")) {
    const short = (t: string) => (t ? `“${t.length > 40 ? `${t.slice(0, 40)}…` : t}”` : "none");
    out.push(`Notes: ${short(before.notes ?? "")} → ${short(after.notes ?? "")}`);
  }

  // Each person's share.
  const ids = [...new Set([...before.shares, ...after.shares].map((s) => s.memberId))];
  for (const id of ids) {
    const a = before.shares.find((s) => s.memberId === id)?.amount ?? 0;
    const b = after.shares.find((s) => s.memberId === id)?.amount ?? 0;
    if (a !== b) out.push(`${nameOf(id)}’s share: ${formatMoney(a, before.baseCurrency)} → ${formatMoney(b, after.baseCurrency)}`);
  }
  return out;
}
