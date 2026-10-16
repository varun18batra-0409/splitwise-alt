import { db } from "./db";
import { buildExpense, type ExpenseDraft } from "./expense";
import { getCategory, guessCategory, isCategory } from "./categories";
import { formatMoney, isSupportedCurrency } from "./money";
import { parseRate, PAYMENT_METHODS } from "./conversion";
import { diffExpense, expenseState, logEvent, type ExpenseSnapshot } from "./events";
import type { RateAnswer } from "./rate-cache";
import { dayKey, parseDay } from "./dates";
import { claimKey, isDuplicateKey, previousResult, withRetry } from "./once";
import { parsePayers, payersJson, payersLabel } from "./payers";
import { findLikelyDuplicate } from "./duplicates";

export type SaveExpenseInput = ExpenseDraft & {
  groupId: string;
  expenseId?: string; // set when editing an existing expense
  requestKey?: string; // one per opened form, makes retries safe
  name: string;
  date?: string; // "2026-10-14"; empty = today (new) or unchanged (edit)
  notes?: string; // undefined = leave as it is (edit) / none (new)
  baseVersion?: string; // editing: when the expense was last changed as the person saw it
  category: string; // "" = guess from the name
  rateMode: "auto" | "manual" | "keep"; // "keep" = editing, keep the rate saved with the expense
  manualRate: string; // used when rateMode = "manual"
  allowDuplicate?: boolean; // "It's a different one": skip the duplicate warning
};

type RateLookupFn = (from: string, to: string) => Promise<RateAnswer>;
export type Result =
  | { ok: true; id: string; eventId?: string }
  | { ok: false; error: string; duplicateOf?: { id: string; description: string; amount: number; by: string; when: string } };

const today = () => new Date().toISOString().slice(0, 10);

// Checks and saves one expense — new, or an edit of an existing one. Used by the
// Add/Edit expense screen (via a server action) and by the tests. Everything is
// re-checked here, so the phone can never store numbers that don't add up.
export async function saveExpense(
  input: SaveExpenseInput,
  actingMemberId: string | undefined,
  lookupRate: RateLookupFn,
  opts: { ignoreDoubleTap?: boolean; requestKey?: string; checkDuplicate?: boolean; eventText?: string } = {},
): Promise<Result> {
  return withRetry(async () => {
    // The same request again (retry / double tap): it already happened.
    const done = await previousResult(opts.requestKey);
    if (done !== null) return { ok: true, id: done };
    try {
      return await saveExpenseOnce(input, actingMemberId, lookupRate, opts);
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      return { ok: true, id: (await previousResult(opts.requestKey)) ?? "" };
    }
  });
}

class Clash extends Error {}

async function saveExpenseOnce(
  input: SaveExpenseInput,
  actingMemberId: string | undefined,
  lookupRate: RateLookupFn,
  opts: { ignoreDoubleTap?: boolean; requestKey?: string; checkDuplicate?: boolean; eventText?: string },
): Promise<Result> {
  const group = await db.group.findUnique({
    where: { id: input.groupId },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true } } },
  });
  if (!group) return { ok: false, error: "This group no longer exists." };
  if (group.deletedAt) return { ok: false, error: "This group was deleted." };
  if (group.closed) return { ok: false, error: "This group is closed. Reopen it to add or change expenses." };

  const memberIds = group.members.map((m) => m.id);
  if (!actingMemberId || !memberIds.includes(actingMemberId)) return { ok: false, error: "Please join this group first." };
  if (group.members.find((m) => m.id === actingMemberId)?.leftAt) return { ok: false, error: "You left this group. Rejoin it to make changes." };
  if (!isSupportedCurrency(input.currency)) return { ok: false, error: "Pick a currency from the list." };
  if (!["equal", "exact", "percent", "shares"].includes(input.splitType)) return { ok: false, error: "Pick how to split." };
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
    // Someone else saved a change while this person was editing: don't overwrite it silently.
    if (input.baseVersion && (existing.editedAt ?? existing.createdAt).toISOString() !== input.baseVersion) {
      const last = await db.groupEvent.findFirst({ where: { expenseId: existing.id }, orderBy: { createdAt: "desc" } });
      const who = last?.actorId === actingMemberId ? "You" : (group.members.find((m) => m.id === last?.actorId)?.name ?? "Someone");
      return { ok: false, error: `${who} changed this expense a moment ago. Go back and open it again to see the latest version.` };
    }
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

  // People who left aren't part of new expenses ("everyone" means everyone still
  // in the group); an edit keeps anyone who was already in that expense.
  const inExisting = (id: string) =>
    Boolean(existing && (existing.paidById === id || existing.shares.some((s) => s.memberId === id) || parsePayers(existing.payers).some((p) => p.memberId === id)));
  const pool = group.members.filter((m) => !m.leftAt || inExisting(m.id)).map((m) => m.id);
  const built = buildExpense(input, { memberIds: pool, baseCurrency: group.currency, groupMarkupBp: group.cardMarkupBp, rate });
  if (!built.ok) return built;
  const e = built.expense;

  // The day it was spent.
  let spentAt: Date | null = existing ? existing.spentAt : null;
  if (input.date && input.date.trim()) {
    const d = parseDay(input.date);
    if (!d) return { ok: false, error: "Pick a real date, not more than a day ahead." };
    spentAt = d;
  } else if (!existing) {
    spentAt = new Date();
  }

  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 80) || "Expense";
  const category = isCategory(input.category) ? input.category : guessCategory(name);
  const notes = input.notes === undefined ? (existing?.notes ?? "") : input.notes.trim().replace(/\r\n/g, "\n").slice(0, 500);
  const fields = {
    description: name,
    notes,
    category,
    amount: e.amount,
    splitType: e.splitType,
    forMode: e.forMode,
    paidById: e.paidById,
    payers: payersJson(e.payers),
    kind: e.kind,
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
    spentAt,
  };
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "Someone";
  const money = formatMoney(e.amount, group.currency);

  if (!existing) {
    // The same expense from the same person seconds ago = a double tap: keep one.
    // With a request key (every Add screen sends one) a resend is already caught
    // above, so a second form saving the same thing is a real second expense
    // (the duplicate warning asks about it instead).
    const twin = opts.ignoreDoubleTap && !opts.requestKey && await db.expense.findFirst({
      where: { groupId: group.id, createdById: actingMemberId, description: name, amount: e.amount, deletedAt: null, createdAt: { gt: new Date(Date.now() - 20_000) } },
    });
    if (twin) return { ok: true, id: twin.id };
    // Looks like something already added? Ask first (the Add screen offers "It's a different one").
    if (opts.checkDuplicate && !input.allowDuplicate) {
      const hit = await findLikelyDuplicate(group.id, { amount: e.amount, name, category, spentAt: spentAt ?? new Date(), kind: e.kind });
      if (hit) {
        return {
          ok: false,
          error: `Looks like “${hit.description} ${formatMoney(hit.amount, group.currency)}”, already added by ${hit.by}.`,
          duplicateOf: { ...hit, when: hit.when.toISOString() },
        };
      }
    }
    const saved = await db.$transaction(async (tx) => {
      const created = await tx.expense.create({ data: { ...fields, groupId: group.id, createdById: actingMemberId, shares: { create: e.shares } } });
      await claimKey(tx, opts.requestKey, created.id);
      const eventId = await logEvent(tx, {
        groupId: group.id,
        actorId: actingMemberId,
        kind: "expense_added",
        text: opts.eventText ?? (e.kind === "refund" ? `added money back: ${name} (${money})` : `added ${name} (${money})`),
        details: [
          `${getCategory(category).emoji} ${getCategory(category).label}`,
          `${e.kind === "refund" ? "Received by" : "Paid by"} ${e.payers.length ? payersLabel(e.payers, nameOf) : nameOf(e.paidById)}`,
        ],
        expenseId: created.id,
        undo: { type: "expense_delete", expenseId: created.id },
      });
      return { created, eventId };
    });
    return { ok: true, id: saved.created.id, eventId: saved.eventId };
  }

  const changes = diffExpense(
    { ...snapshot(existing), day: dayKey(existing.spentAt ?? existing.createdAt) },
    { ...snapshot({ ...fields, shares: e.shares }), day: dayKey(spentAt ?? existing.createdAt) },
    nameOf,
  );
  if (changes.length === 0) return { ok: true, id: existing.id }; // nothing changed

  let eventId: string;
  try {
   eventId = await db.$transaction(async (tx) => {
    // Only if nobody else saved a change in the meantime (checked and written in one step).
    const lock = await tx.expense.updateMany({ where: { id: existing.id, editedAt: existing.editedAt, deletedAt: null }, data: { editedAt: new Date() } });
    if (lock.count !== 1) throw new Clash();
    await claimKey(tx, opts.requestKey, existing.id);
    await tx.expenseShare.deleteMany({ where: { expenseId: existing.id } });
    await tx.expense.update({
      where: { id: existing.id },
      data: { ...fields, editedAt: new Date(), shares: { create: e.shares } },
    });
    return logEvent(tx, {
      groupId: group.id,
      actorId: actingMemberId,
      kind: "expense_edited",
      text: `changed ${name}`,
      details: changes,
      expenseId: existing.id,
      undo: { type: "expense_revert", expenseId: existing.id, before: expenseState(existing) },
    });
   });
  } catch (err) {
    if (err instanceof Clash) return { ok: false, error: "Someone changed this expense a moment ago. Go back and open it again to see the latest version." };
    throw err;
  }
  return { ok: true, id: existing.id, eventId };
}

function snapshot(x: Omit<ExpenseSnapshot, "shares"> & { shares: { memberId: string; amount: number }[] }): ExpenseSnapshot {
  return { ...x, shares: x.shares.map((s) => ({ memberId: s.memberId, amount: s.amount })) };
}

// Delete or restore an expense. Deleted expenses stay in history (crossed out)
// but stop counting towards balances, Smart Settle and charts.
export async function setExpenseDeleted(expenseId: string, actingMemberId: string | undefined, deleted: boolean): Promise<Result> {
  return withRetry(() => setExpenseDeletedOnce(expenseId, actingMemberId, deleted));
}
async function setExpenseDeletedOnce(expenseId: string, actingMemberId: string | undefined, deleted: boolean): Promise<Result> {
  const expense = await db.expense.findUnique({ where: { id: expenseId }, include: { group: { include: { members: { select: { id: true } } } } } });
  if (!expense) return { ok: false, error: "That expense no longer exists." };
  if (!actingMemberId || !expense.group.members.some((m) => m.id === actingMemberId)) {
    return { ok: false, error: "Only people in this group can delete or restore its expenses." };
  }
  if (expense.group.deletedAt) return { ok: false, error: "This group was deleted." };
  if (expense.group.closed) return { ok: false, error: "This group is closed. Reopen it to change expenses." };
  if (Boolean(expense.deletedAt) === deleted) return { ok: true, id: expense.id };

  const eventId = await db.$transaction(async (tx) => {
    // Only if it's still in the state we saw (two taps at once change it once).
    const changed = await tx.expense.updateMany({
      where: { id: expense.id, deletedAt: deleted ? null : { not: null } },
      data: deleted ? { deletedAt: new Date(), deletedById: actingMemberId } : { deletedAt: null, deletedById: null },
    });
    if (changed.count !== 1) return "";
    return logEvent(tx, {
      groupId: expense.groupId,
      actorId: actingMemberId,
      kind: deleted ? "expense_deleted" : "expense_restored",
      text: `${deleted ? "deleted" : "restored"} ${expense.description} (${formatMoney(expense.amount, expense.baseCurrency)})`,
      expenseId: expense.id,
      undo: { type: deleted ? "expense_restore" : "expense_delete", expenseId: expense.id },
    });
  });
  return { ok: true, id: expense.id, eventId: eventId || undefined };
}

// Delete a recorded settle-up payment (anyone in the group). It stays in history.
export async function deletePayment(paymentId: string, actingMemberId: string | undefined): Promise<Result> {
  return setPaymentDeleted(paymentId, actingMemberId, true);
}

// Delete or restore a settle-up payment. Deleted payments stay in history.
export async function setPaymentDeleted(paymentId: string, actingMemberId: string | undefined, deleted: boolean): Promise<Result> {
  return withRetry(() => setPaymentDeletedOnce(paymentId, actingMemberId, deleted));
}
async function setPaymentDeletedOnce(paymentId: string, actingMemberId: string | undefined, deleted: boolean): Promise<Result> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { group: { include: { members: { select: { id: true } } } }, from: true, to: true },
  });
  if (!payment) return { ok: false, error: "That payment no longer exists." };
  if (!actingMemberId || !payment.group.members.some((m) => m.id === actingMemberId)) {
    return { ok: false, error: "Only people in this group can delete its payments." };
  }
  if (payment.group.deletedAt) return { ok: false, error: "This group was deleted." };
  if (payment.group.closed) return { ok: false, error: "This group is closed. Reopen it to change payments." };
  if (Boolean(payment.deletedAt) === deleted) return { ok: true, id: payment.id };
  const eventId = await db.$transaction(async (tx) => {
    const changed = await tx.payment.updateMany({
      where: { id: payment.id, deletedAt: deleted ? null : { not: null } },
      data: deleted ? { deletedAt: new Date(), deletedById: actingMemberId } : { deletedAt: null, deletedById: null },
    });
    if (changed.count !== 1) return "";
    return logEvent(tx, {
      groupId: payment.groupId,
      actorId: actingMemberId,
      kind: deleted ? "payment_deleted" : "payment_restored",
      text: `${deleted ? "deleted" : "restored"} the payment ${payment.from.name} → ${payment.to.name} (${formatMoney(payment.amount, payment.group.currency)})`,
      paymentId: payment.id,
      undo: { type: deleted ? "payment_restore" : "payment_delete", paymentId: payment.id },
    });
  });
  return { ok: true, id: payment.id, eventId: eventId || undefined };
}
