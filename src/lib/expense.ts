import { computeTotals, type PaymentMethod } from "./conversion";
import { formatMoney, parseAmount, parsePercent } from "./money";
import { allocateByWeights, computeSplit, participantsFor, type ForMode, type Share, type SplitType } from "./split";

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
  multiPay?: boolean; // more than one person paid
  payers?: Record<string, string>; // each payer's amount as typed (expense's own currency), when multiPay
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
  payers: Share[]; // more than one payer, in the group currency (adds up to amount); [] = just paidById
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
  if (!draft.multiPay && !ctx.memberIds.includes(draft.paidById)) return { ok: false, error: "Pick who paid." };

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

  // More than one payer: their amounts (typed in the expense's currency) must
  // add up to it; then they're converted with the same rounding as the shares.
  let paidById = draft.paidById;
  let payers: Share[] = [];
  if (draft.multiPay) {
    const typed: Share[] = [];
    for (const id of ctx.memberIds) {
      const raw = (draft.payers?.[id] ?? "").trim();
      if (!raw || /^0*(\.0*)?$/.test(raw)) continue;
      const amt = parseAmount(raw, draft.currency);
      if (amt === null) return { ok: false, error: "One of the payers' amounts isn't a valid number." };
      typed.push({ memberId: id, amount: amt });
    }
    if (typed.length === 0) return { ok: false, error: "Pick who paid." };
    const sum = typed.reduce((s, p) => s + p.amount, 0);
    if (sum !== totals.originalAmount) {
      return { ok: false, error: `The payers add up to ${formatMoney(sum, draft.currency)}, but the total is ${formatMoney(totals.originalAmount, draft.currency)}.` };
    }
    const converted = sum === totals.total ? typed : allocateByWeights(totals.total, typed.map((p) => ({ memberId: p.memberId, weight: p.amount })));
    paidById = converted.reduce((best, p) => (p.amount > best.amount ? p : best), converted[0]).memberId;
    payers = converted.length > 1 ? converted : [];
  }

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
      paidById,
      payers,
      shares: split.shares,
    },
  };
}
