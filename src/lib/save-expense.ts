import { db } from "./db";
import { buildExpense, type ExpenseDraft } from "./expense";
import { getCategory, guessCategory, isCategory } from "./categories";
import { formatMoney, isSupportedCurrency } from "./money";
import { parseRate, PAYMENT_METHODS } from "./conversion";
import { diffExpense, logEvent, type ExpenseSnapshot } from "./events";
import type { RateAnswer } from "./rate-cache";

export type SaveExpenseInput = ExpenseDraft & {
  groupId: string;
  expenseId?: string; // set when editing an existing expense
  name: string;
  category: string; // "" = guess from the name
  rateMode: "auto" | "manual" | "keep"; // "keep" = editing, keep the rate saved with the expense
  manualRate: string; // used when rateMode = "manual"
};

type RateLookupFn = (from: string, to: string) => Promise<RateAnswer>;
type Result = { ok: true; id: string } | { ok: false; error: string };

const today = () => new Date().toISOString().slice(0, 10);

// Checks and saves one expense — new, or an edit of an existing one. Used by the
// Add/Edit expense screen (via a server action) and by the tests. Everything is
// re-checked here, so the phone can never store numbers that don't add up.
export async function saveExpense(input: SaveExpenseInput, actingMemberId: string | undefined, lookupRate: RateLookupFn): Promise<Result> {
  const group = await db.group.findUnique({
    where: { id: input.groupId },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true } } },
  });
  if (!group) return { ok: false, error: "This group no longer exists." };
  if (group.closed) return { ok: false, error: "This group is closed. Reopen it to add or change expenses." };

  const memberIds = group.members.map((m) => m.id);
  if (!actingMemberId || !memberIds.includes(actingMemberId)) return { ok: false, error: "Please join this group first." };
  if (!isSupportedCurrency(input.currency)) return { ok: false, error: "Pick a currency from the list." };
  if (!["equal", "exact", "percent"].includes(input.splitType)) return { ok: false, error: "Pick how to split." };
  if (!["everyone", "selected", "one"].includes(input.forMode)) return { ok: false, error: "Pick who it was for." };
  if (!PAYMENT_METHODS.some((p) => p.id === input.paymentMethod)) return { ok: false, error: "Pick how it was paid." };

  // Editing: anyone in the group can change any expense (every change is logged
  // with who made it and everyone else is notified), but not once it's deleted.
  const existing = input.expenseId
    ? await db.expense.findFirst({ where: { id: input.expenseId, groupId: group.id }, include: { shares: true } })
    : null;
  if (input.expenseId) {
    if (!existing) return { ok: false, error: "That expense no longer exists." };
    if (existing.deletedAt) return { ok: false, error: "This expense was deleted. Restore it before changing it." };
  }

  // Which exchange rate to use.
  let rate = "1";
  let rateDate = today();
  let rateSource = "same";
  if (input.currency !== group.currency) {
    const canKeep =
      existing && existing.originalCurrency === input.currency && existing.baseCurrency === group.currency && parseRate(existing.exchangeRate);
    if (input.rateMode === "keep" && existing && canKeep) {
      rate = existing.exchangeRate;
      rateDate = existing.rateDate;
      rateSource = existing.rateSource;
    } else if (input.rateMode === "manual") {
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

  const built = buildExpense(input, { memberIds, baseCurrency: group.currency, groupMarkupBp: group.cardMarkupBp, rate });
  if (!built.ok) return built;
  const e = built.expense;

  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80) || "Expense";
  const category = isCategory(input.category) ? input.category : guessCategory(name);
  const fields = {
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
  };
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "Someone";
  const money = formatMoney(e.amount, group.currency);

  if (!existing) {
    const saved = await db.$transaction(async (tx) => {
      const created = await tx.expense.create({ data: { ...fields, groupId: group.id, createdById: actingMemberId, shares: { create: e.shares } } });
      await logEvent(tx, {
        groupId: group.id,
        actorId: actingMemberId,
        kind: "expense_added",
        text: `added ${name} (${money})`,
        details: [`${getCategory(category).emoji} ${getCategory(category).label}`, `Paid by ${nameOf(e.paidById)}`],
        expenseId: created.id,
      });
      return created;
    });
    return { ok: true, id: saved.id };
  }

  const changes = diffExpense(snapshot(existing), snapshot({ ...fields, shares: e.shares }), nameOf);
  if (changes.length === 0) return { ok: true, id: existing.id }; // nothing changed

  await db.$transaction(async (tx) => {
    await tx.expenseShare.deleteMany({ where: { expenseId: existing.id } });
    await tx.expense.update({
      where: { id: existing.id },
      data: { ...fields, editedAt: new Date(), shares: { create: e.shares } },
    });
    await logEvent(tx, {
      groupId: group.id,
      actorId: actingMemberId,
      kind: "expense_edited",
      text: `changed ${name}`,
      details: changes,
      expenseId: existing.id,
    });
  });
  return { ok: true, id: existing.id };
}

function snapshot(x: Omit<ExpenseSnapshot, "shares"> & { shares: { memberId: string; amount: number }[] }): ExpenseSnapshot {
  return { ...x, shares: x.shares.map((s) => ({ memberId: s.memberId, amount: s.amount })) };
}

// Delete or restore an expense. Deleted expenses stay in history (crossed out)
// but stop counting towards balances, Smart Settle and charts.
export async function setExpenseDeleted(expenseId: string, actingMemberId: string | undefined, deleted: boolean): Promise<Result> {
  const expense = await db.expense.findUnique({ where: { id: expenseId }, include: { group: { include: { members: { select: { id: true } } } } } });
  if (!expense) return { ok: false, error: "That expense no longer exists." };
  if (!actingMemberId || !expense.group.members.some((m) => m.id === actingMemberId)) {
    return { ok: false, error: "Only people in this group can delete or restore its expenses." };
  }
  if (expense.group.closed) return { ok: false, error: "This group is closed. Reopen it to change expenses." };
  if (Boolean(expense.deletedAt) === deleted) return { ok: true, id: expense.id };

  await db.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id: expense.id },
      data: deleted ? { deletedAt: new Date(), deletedById: actingMemberId } : { deletedAt: null, deletedById: null },
    });
    await logEvent(tx, {
      groupId: expense.groupId,
      actorId: actingMemberId,
      kind: deleted ? "expense_deleted" : "expense_restored",
      text: `${deleted ? "deleted" : "restored"} ${expense.description} (${formatMoney(expense.amount, expense.baseCurrency)})`,
      expenseId: expense.id,
    });
  });
  return { ok: true, id: expense.id };
}

// Delete a recorded settle-up payment (anyone in the group). It stays in history.
export async function deletePayment(paymentId: string, actingMemberId: string | undefined): Promise<Result> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { group: { include: { members: { select: { id: true } } } }, from: true, to: true },
  });
  if (!payment) return { ok: false, error: "That payment no longer exists." };
  if (!actingMemberId || !payment.group.members.some((m) => m.id === actingMemberId)) {
    return { ok: false, error: "Only people in this group can delete its payments." };
  }
  if (payment.deletedAt) return { ok: true, id: payment.id };
  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: payment.id }, data: { deletedAt: new Date(), deletedById: actingMemberId } });
    await logEvent(tx, {
      groupId: payment.groupId,
      actorId: actingMemberId,
      kind: "payment_deleted",
      text: `deleted the payment ${payment.from.name} → ${payment.to.name} (${formatMoney(payment.amount, payment.group.currency)})`,
      paymentId: payment.id,
    });
  });
  return { ok: true, id: payment.id };
}
