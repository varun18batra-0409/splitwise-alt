import { db } from "./db";
import { logEvent } from "./events";
import { formatMoney, formatPercent, isSupportedCurrency } from "./money";
import { parseRate } from "./conversion";
import { rebaseExpense, rebasePayment } from "./rebase";

type Result = { ok: true } | { ok: false; error: string };

// Rename the group and/or change its card markup. Logged for everyone.
export async function updateGroupBasics(groupId: string, actorId: string, changes: { name?: string; markupBp?: number }): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId } });
  if (!group) return { ok: false, error: "This group no longer exists." };
  const name = changes.name?.trim().replace(/\s+/g, " ").slice(0, 60);
  if (changes.name !== undefined && !name) return { ok: false, error: "Give the group a name." };

  await db.$transaction(async (tx) => {
    if (name && name !== group.name) {
      await tx.group.update({ where: { id: group.id }, data: { name } });
      await logEvent(tx, { groupId, actorId, kind: "group_renamed", text: `renamed the group to “${name}”`, details: [`Name: ${group.name} → ${name}`] });
    }
    if (changes.markupBp !== undefined && changes.markupBp !== group.cardMarkupBp) {
      await tx.group.update({ where: { id: group.id }, data: { cardMarkupBp: changes.markupBp } });
      await logEvent(tx, {
        groupId,
        actorId,
        kind: "markup_changed",
        text: `set the card markup to ${formatPercent(changes.markupBp)}`,
        details: [`Card markup: ${formatPercent(group.cardMarkupBp)} → ${formatPercent(changes.markupBp)}`, "Applies to new expenses only"],
      });
    }
  });
  return { ok: true };
}

// Change the group's currency. Every expense, share and payment is converted
// at `rate` (1 old = rate new). Original receipt amounts are kept as they were,
// and every expense's shares still add up exactly.
export async function changeGroupCurrency(groupId: string, actorId: string, newCurrency: string, rate: string): Promise<Result> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { expenses: { include: { shares: true } }, payments: true },
  });
  if (!group) return { ok: false, error: "This group no longer exists." };
  if (!isSupportedCurrency(newCurrency)) return { ok: false, error: "Pick a currency from the list." };
  if (newCurrency === group.currency) return { ok: true };
  const hasMoney = group.expenses.length > 0 || group.payments.length > 0;
  if (hasMoney && !parseRate(rate)) return { ok: false, error: "Enter the conversion rate, like 0.012." };

  const oldCurrency = group.currency;
  const expenseUpdates = group.expenses.map((e) => ({ e, r: rebaseExpense(e, oldCurrency, newCurrency, rate) }));
  if (expenseUpdates.some((x) => x.r === null)) return { ok: false, error: "That rate makes some amounts too small or too large. Check it." };
  const paymentUpdates = group.payments.map((p) => ({ p, amount: rebasePayment(p.amount, oldCurrency, newCurrency, rate) }));
  if (paymentUpdates.some((x) => x.amount === null || x.amount <= 0)) return { ok: false, error: "That rate makes a payment too small. Check it." };

  const totalBefore = group.expenses.filter((e) => !e.deletedAt).reduce((s, e) => s + e.amount, 0);
  const totalAfter = expenseUpdates.filter((x) => !x.e.deletedAt).reduce((s, x) => s + x.r!.amount, 0);

  await db.$transaction(async (tx) => {
    for (const { e, r } of expenseUpdates) {
      await tx.expense.update({
        where: { id: e.id },
        data: {
          baseCurrency: r!.baseCurrency,
          exchangeRate: r!.exchangeRate,
          rateSource: r!.rateSource,
          convertedAmount: r!.convertedAmount,
          markupAmount: r!.markupAmount,
          amount: r!.amount,
        },
      });
      for (const s of r!.shares) await tx.expenseShare.update({ where: { id: s.id }, data: { amount: s.amount } });
    }
    for (const { p, amount } of paymentUpdates) await tx.payment.update({ where: { id: p.id }, data: { amount: amount! } });
    await tx.group.update({ where: { id: group.id }, data: { currency: newCurrency } });
    await logEvent(tx, {
      groupId,
      actorId,
      kind: "currency_changed",
      text: `changed the group currency to ${newCurrency}`,
      details: hasMoney
        ? [
            `Currency: ${oldCurrency} → ${newCurrency}`,
            `Rate used: 1 ${oldCurrency} = ${rate} ${newCurrency}`,
            `Group total: ${formatMoney(totalBefore, oldCurrency)} → ${formatMoney(totalAfter, newCurrency)}`,
          ]
        : [`Currency: ${oldCurrency} → ${newCurrency}`],
    });
  });
  return { ok: true };
}
