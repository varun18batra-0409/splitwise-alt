import { toInputAmount } from "./money";
import { dayKey } from "./dates";
import { allocateByWeights, sharesBack, type ForMode, type SplitType } from "./split";
import { parsePayers, scalePayers } from "./payers";
import type { ExpenseDraft } from "./expense";
import type { PaymentMethod } from "./conversion";

// What the Add / Edit expense screen starts from.
export type ExpenseInitial = {
  name: string;
  amount: string;
  currency: string;
  category: string;
  paidById: string;
  forMode: ForMode;
  selected: string[];
  onePersonId: string;
  splitType: SplitType;
  exact: Record<string, string>;
  percent: Record<string, string>;
  shares?: Record<string, string>;
  kind?: "expense" | "refund";
  multiPay?: boolean;
  payers?: Record<string, string>; // each payer's amount, in the expense's currency
  paymentMethod: PaymentMethod;
  markupChoice: ExpenseDraft["markupChoice"];
  markupCustom: string;
  rate: string; // the rate saved with the expense
  rateDate: string;
  date: string; // "2026-10-14"
  notes: string;
  version: string; // editing: when it was last changed, to catch someone else's edit; "" for new
};

type SavedExpense = {
  description: string;
  category: string;
  notes: string;
  amount: number;
  originalAmount: number;
  originalCurrency: string;
  baseCurrency: string;
  exchangeRate: string;
  rateDate: string;
  paymentMethod: string;
  markupBp: number;
  splitType: string;
  forMode: string;
  paidById: string;
  payers?: string | null;
  kind?: string | null;
  spentAt: Date | null;
  createdAt: Date;
  editedAt: Date | null;
  shares: { memberId: string; amount: number }[];
};

// edit   = the expense exactly as saved;
// again  = "Save & add another": same payer(s), people, split and date, blank name/amount;
// repeat = "Repeat": a copy dated today.
export function initialFromExpense(
  e: SavedExpense,
  ctx: { groupMarkupBp: number; groupWeights: Record<string, number>; tz: string; today: string },
  mode: "edit" | "again" | "repeat",
): ExpenseInitial {
  // Rebuild what was typed, from what was saved.
  const shares = e.shares.filter((s) => s.amount > 0);
  const weights = shares.map((s) => ({ memberId: s.memberId, weight: s.amount }));
  const exact = Object.fromEntries(allocateByWeights(e.originalAmount, weights).map((s) => [s.memberId, toInputAmount(s.amount, e.originalCurrency)]));
  const percent = Object.fromEntries(allocateByWeights(10000, weights).map((s) => [s.memberId, String(s.amount / 100)]));
  const sharesText = e.splitType === "shares" ? sharesBack(e.amount, shares, ctx.groupWeights) : null;
  const savedPayers = parsePayers(e.payers);
  const foreignCard = e.originalCurrency !== e.baseCurrency && e.paymentMethod === "card";
  const known = <T extends string>(v: string, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

  // Shares that can't be rebuilt exactly are edited as amounts instead;
  // "add another" can't reuse typed amounts, so it starts equal.
  let splitType: SplitType = e.splitType === "shares" ? (sharesText ? "shares" : "exact") : known(e.splitType, ["equal", "exact", "percent"] as const, "equal");
  if (mode === "again" && splitType === "exact") splitType = "equal";

  const fresh = mode === "again";
  return {
    name: fresh ? "" : e.description,
    amount: fresh ? "" : toInputAmount(e.originalAmount, e.originalCurrency),
    currency: e.originalCurrency,
    category: fresh ? "" : e.category,
    paidById: e.paidById,
    forMode: known(e.forMode, ["everyone", "selected", "one"] as const, "everyone"),
    selected: shares.map((s) => s.memberId),
    onePersonId: shares.length === 1 ? shares[0].memberId : "",
    splitType,
    exact: fresh ? {} : exact,
    percent,
    shares: sharesText ?? undefined,
    kind: e.kind === "refund" ? "refund" : "expense",
    multiPay: savedPayers.length > 1,
    payers: fresh ? {} : Object.fromEntries(scalePayers(savedPayers, e.originalAmount).map((p) => [p.memberId, toInputAmount(p.amount, e.originalCurrency)])),
    paymentMethod: known(e.paymentMethod, ["card", "cash", "bank"] as const, "card"),
    markupChoice: !foreignCard || e.markupBp === ctx.groupMarkupBp ? "group" : e.markupBp === 0 ? "none" : "custom",
    markupCustom: foreignCard && e.markupBp !== ctx.groupMarkupBp ? String(e.markupBp / 100) : "",
    rate: mode === "edit" ? e.exchangeRate : "",
    rateDate: mode === "edit" ? e.rateDate : "",
    date: mode === "repeat" ? ctx.today : dayKey(e.spentAt ?? e.createdAt, ctx.tz),
    notes: fresh ? "" : e.notes,
    version: mode === "edit" ? (e.editedAt ?? e.createdAt).toISOString() : "",
  };
}
