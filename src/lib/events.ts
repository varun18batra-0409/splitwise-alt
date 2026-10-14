import type { Prisma, PrismaClient } from "@prisma/client";
import { getCategory } from "./categories";
import { formatMoney, formatPercent } from "./money";

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
  | "group_renamed"
  | "currency_changed"
  | "markup_changed"
  | "display_currency_changed"
  | "members_added"
  | "group_closed"
  | "group_reopened";

type Db = PrismaClient | Prisma.TransactionClient;

export async function logEvent(
  db: Db,
  e: { groupId: string; actorId: string; kind: EventKind; text: string; details?: string[]; expenseId?: string; paymentId?: string },
) {
  await db.groupEvent.create({
    data: {
      groupId: e.groupId,
      actorId: e.actorId,
      kind: e.kind,
      text: e.text,
      details: JSON.stringify(e.details ?? []),
      expenseId: e.expenseId ?? null,
      paymentId: e.paymentId ?? null,
    },
  });
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
  forMode: string;
  splitType: string;
  shares: { memberId: string; amount: number }[];
};

const SPLIT: Record<string, string> = { equal: "equally", exact: "by amounts", percent: "by percentage" };
const FOR: Record<string, string> = { everyone: "everyone", selected: "selected people", one: "one person" };
const PAID_WITH: Record<string, string> = { card: "card", cash: "cash", bank: "bank / UPI", "": "—" };

// Human-readable list of what changed, e.g. ["Amount: THB 3,000 → THB 3,500", "Paid by: Asha → Ravi"].
export function diffExpense(before: ExpenseSnapshot, after: ExpenseSnapshot, nameOf: (id: string) => string): string[] {
  const out: string[] = [];
  const add = (label: string, a: string, b: string) => {
    if (a !== b) out.push(`${label}: ${a} → ${b}`);
  };
  add("Name", before.description, after.description);
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
  add("Paid by", nameOf(before.paidById), nameOf(after.paidById));
  add("For", FOR[before.forMode] ?? before.forMode, FOR[after.forMode] ?? after.forMode);
  add("Split", SPLIT[before.splitType] ?? before.splitType, SPLIT[after.splitType] ?? after.splitType);

  // Each person's share.
  const ids = [...new Set([...before.shares, ...after.shares].map((s) => s.memberId))];
  for (const id of ids) {
    const a = before.shares.find((s) => s.memberId === id)?.amount ?? 0;
    const b = after.shares.find((s) => s.memberId === id)?.amount ?? 0;
    if (a !== b) out.push(`${nameOf(id)}’s share: ${formatMoney(a, before.baseCurrency)} → ${formatMoney(b, after.baseCurrency)}`);
  }
  return out;
}
