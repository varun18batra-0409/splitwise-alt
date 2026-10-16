import { computeTotals, type PaymentMethod } from "./conversion";
import { parsePercent } from "./money";
import { computeSplit, participantsFor, type ForMode, type Share, type SplitType } from "./split";

// Everything the Add expense screen collects (amounts as typed).
export type ExpenseDraft = {
  amount: string;
  currency: string;
  paidById: string;
  forMode: ForMode;
  selected: string[]; // used when forMode = "selected"
  onePersonId: string; // used when forMode = "one"
  splitType: SplitType;
  exact: Record<string, string>;
  percent: Record<string, string>;
  shares?: Record<string, string>; // "1.2" per person, when splitType = "shares"
  paymentMethod: PaymentMethod;
  markupChoice: "group" | "none" | "custom";
  markupCustom: string; // e.g. "3.5"
};

export type BuiltExpense = {
  originalAmount: number;
  originalCurrency: string;
  baseCurrency: string;
  exchangeRate: string;
  convertedAmount: number;
  paymentMethod: PaymentMethod | "";
  markupBp: number;
  markupAmount: number;
  amount: number; // final total — the only number used for splitting and balances
  forMode: ForMode;
  splitType: SplitType;
  paidById: string;
  shares: Share[];
};

export function chosenMarkupBp(draft: Pick<ExpenseDraft, "markupChoice" | "markupCustom">, groupMarkupBp: number): number | null {
  if (draft.markupChoice === "none") return 0;
  if (draft.markupChoice === "group") return groupMarkupBp;
  const bp = parsePercent(draft.markupCustom);
  return bp === null || bp > 2000 ? null : bp;
}

export function buildExpense(
  draft: ExpenseDraft,
  ctx: { memberIds: string[]; baseCurrency: string; groupMarkupBp: number; rate: string },
): { ok: true; expense: BuiltExpense } | { ok: false; error: string } {
  if (!ctx.memberIds.includes(draft.paidById)) return { ok: false, error: "Pick who paid." };

  const foreign = draft.currency !== ctx.baseCurrency;
  const markupBp = chosenMarkupBp(draft, ctx.groupMarkupBp);
  if (markupBp === null) return { ok: false, error: "Enter a card markup between 0% and 20%." };

  const totals = computeTotals({
    amount: draft.amount,
    currency: draft.currency,
    baseCurrency: ctx.baseCurrency,
    rate: ctx.rate,
    paymentMethod: foreign ? draft.paymentMethod : "",
    markupBp,
  });
  if (!totals.ok) return { ok: false, error: totals.error };

  const participants = participantsFor({ ...draft, memberIds: ctx.memberIds });
  const split = computeSplit({
    total: totals.total,
    originalAmount: totals.originalAmount,
    originalCurrency: draft.currency,
    splitType: draft.splitType,
    participants,
    exact: draft.exact,
    percent: draft.percent,
    shares: draft.shares,
  });
  if (!split.ok) return { ok: false, error: split.error };

  return {
    ok: true,
    expense: {
      originalAmount: totals.originalAmount,
      originalCurrency: draft.currency,
      baseCurrency: ctx.baseCurrency,
      exchangeRate: totals.exchangeRate,
      convertedAmount: totals.convertedAmount,
      paymentMethod: foreign ? draft.paymentMethod : "",
      markupBp: totals.markupBp,
      markupAmount: totals.markupAmount,
      amount: totals.total,
      forMode: draft.forMode,
      splitType: participants.length === 1 ? "equal" : draft.splitType,
      paidById: draft.paidById,
      shares: split.shares,
    },
  };
}
