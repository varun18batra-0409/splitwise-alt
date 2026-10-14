import { db } from "./db";
import { buildExpense, type ExpenseDraft } from "./expense";
import { guessCategory, isCategory } from "./categories";
import { isSupportedCurrency } from "./money";
import { parseRate, PAYMENT_METHODS } from "./conversion";
import type { RateAnswer } from "./rate-cache";

export type SaveExpenseInput = ExpenseDraft & {
  groupId: string;
  name: string;
  category: string; // "" = guess from the name
  rateMode: "auto" | "manual";
  manualRate: string; // used when rateMode = "manual"
};

type RateLookupFn = (from: string, to: string) => Promise<RateAnswer>;

// Checks and saves one expense. Used by the Add expense screen (via a server
// action) and by the tests. Everything is re-checked here, so the phone can
// never store numbers that don't add up.
export async function saveExpense(
  input: SaveExpenseInput,
  actingMemberId: string | undefined,
  lookupRate: RateLookupFn,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const group = await db.group.findUnique({
    where: { id: input.groupId },
    include: { members: { orderBy: { createdAt: "asc" }, select: { id: true } } },
  });
  if (!group) return { ok: false, error: "This group no longer exists." };

  const memberIds = group.members.map((m) => m.id);
  if (!actingMemberId || !memberIds.includes(actingMemberId)) return { ok: false, error: "Please join this group first." };
  if (!isSupportedCurrency(input.currency)) return { ok: false, error: "Pick a currency from the list." };
  if (!["equal", "exact", "percent"].includes(input.splitType)) return { ok: false, error: "Pick how to split." };
  if (!["everyone", "selected", "one"].includes(input.forMode)) return { ok: false, error: "Pick who it was for." };
  if (!PAYMENT_METHODS.some((p) => p.id === input.paymentMethod)) return { ok: false, error: "Pick how it was paid." };

  // Which exchange rate to use.
  let rate = "1";
  let rateDate = new Date().toISOString().slice(0, 10);
  let rateSource: "same" | "api" | "manual" = "same";
  if (input.currency !== group.currency) {
    if (input.rateMode === "manual") {
      if (!parseRate(input.manualRate)) return { ok: false, error: "Enter a valid exchange rate, like 2.84." };
      rate = input.manualRate.replace(/[,\s]/g, "");
      rateSource = "manual";
    } else {
      const live = await lookupRate(input.currency, group.currency);
      if (!live.ok) return { ok: false, error: live.message };
      rate = live.rate;
      rateDate = live.date;
      rateSource = "api";
    }
  }

  const built = buildExpense(input, {
    memberIds,
    baseCurrency: group.currency,
    groupMarkupBp: group.cardMarkupBp,
    rate,
  });
  if (!built.ok) return built;
  const e = built.expense;

  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80) || "Expense";
  const category = isCategory(input.category) ? input.category : guessCategory(name);

  const saved = await db.expense.create({
    data: {
      groupId: group.id,
      description: name,
      category,
      amount: e.amount,
      splitType: e.splitType,
      forMode: e.forMode,
      paidById: e.paidById,
      originalAmount: e.originalAmount,
      originalCurrency: e.originalCurrency,
      baseCurrency: e.baseCurrency,
      exchangeRate: e.exchangeRate,
      rateDate,
      rateSource,
      convertedAmount: e.convertedAmount,
      paymentMethod: e.paymentMethod,
      markupBp: e.markupBp,
      markupAmount: e.markupAmount,
      shares: { create: e.shares },
    },
  });
  return { ok: true, id: saved.id };
}
