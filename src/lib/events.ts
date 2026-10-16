import type { Prisma, PrismaClient } from "@prisma/client";
import { getCategory } from "./categories";
import { formatMoney, formatPercent } from "./money";
import { niceDate } from "./format";
import { parsePayers } from "./payers";
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
  | "split_changed";

type Db = PrismaClient | Prisma.TransactionClient;

// Everything needed to put an expense back exactly as it was.
export type ExpenseState = {
  description: string;
  category: string;
  amount: number;
  splitType: string;
  forMode: string;
  paidById: string;
  payers?: string; // more than one payer (JSON); missing/"" = just paidById
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

export function expenseState(e: Omit<ExpenseState, "spentAt" | "notes" | "payers"> & { spentAt?: Date | string | null; notes?: string; payers?: string | null }): ExpenseState {
  return {
    description: e.description,
    category: e.category,
    amount: e.amount,
    splitType: e.splitType,
    forMode: e.forMode,
    paidById: e.paidById,
    payers: e.payers ?? "",
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
      expenses: { id: string; baseCurrency: string; exchangeRate: string; rateSource: string; convertedAmount: number; markupAmount: number; amount: number; shares: { id: string; amount: number }[] }[];
      payments: { id: string; amount: number }[];
    }
  | { type: "members_remove"; memberIds: string[] }
  | { type: "members_restore"; members: { id: string; name: string; phone: string; createdAt: string }[] }
  | { type: "member_set"; memberId: string; data: { name?: string; leftAt?: string | null } }
  | { type: "settle_all"; paymentIds: string[]; apply: boolean };

export function parseUndo(json: string): UndoPayload | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" && typeof v.type === "string" ? (v as UndoPayload) : null;
  } catch {
    return null;
  }
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
  },
): Promise<string> {
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
