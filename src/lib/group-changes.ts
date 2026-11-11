import { db } from "./db";
import { hasLeft, LEFT_ERROR } from "./active";
import { logEvent, type OtherMoney } from "./events";
import { allocateByWeights } from "./split";
import { formatMoney, formatPercent, isSupportedCurrency } from "./money";
import { parseRate } from "./conversion";
import { rebaseExpense, rebasePayment } from "./rebase";

type Result = { ok: true; eventId?: string } | { ok: false; error: string };

// Rename the group and/or change its card markup. Logged for everyone.
export async function updateGroupBasics(
  groupId: string,
  actorId: string,
  changes: { name?: string; markupBp?: number; secondaryCurrency?: string },
  opts?: { dryRun?: boolean },
): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change it." };
  if (await hasLeft(groupId, actorId)) return { ok: false, error: LEFT_ERROR };
  const name = changes.name?.trim().replace(/\s+/g, " ").slice(0, 60);
  if (changes.name !== undefined && !name) return { ok: false, error: "Give the group a name." };

  const sec = changes.secondaryCurrency;
  if (sec !== undefined && sec !== "" && sec !== "none" && !isSupportedCurrency(sec)) return { ok: false, error: "Pick a currency from the list." };
  if (opts?.dryRun) return { ok: true }; // checked only: the one Save validates everything before writing anything

  let lastEventId: string | undefined;
  await db.$transaction(async (tx) => {
    if (sec !== undefined && sec !== group.secondaryCurrency) {
      await tx.group.update({ where: { id: group.id }, data: { secondaryCurrency: sec } });
      const label = (v: string) => (v === "" ? "automatic" : v === "none" ? "off" : v);
      lastEventId = await logEvent(tx, {
        groupId,
        actorId,
        undo: { type: "group_set", data: { secondaryCurrency: group.secondaryCurrency } },
        kind: "display_currency_changed",
        text: sec === "none" ? "turned off the second currency" : `set the second currency to ${label(sec)}`,
        details: [`Also shown in: ${label(group.secondaryCurrency)} → ${label(sec)}`],
      });
    }
    if (name && name !== group.name) {
      await tx.group.update({ where: { id: group.id }, data: { name } });
      lastEventId = await logEvent(tx, {
        groupId,
        actorId,
        kind: "group_renamed",
        text: `renamed the group to “${name}”`,
        details: [`Name: ${group.name} → ${name}`],
        undo: { type: "group_set", data: { name: group.name } },
      });
    }
    if (changes.markupBp !== undefined && changes.markupBp !== group.cardMarkupBp) {
      await tx.group.update({ where: { id: group.id }, data: { cardMarkupBp: changes.markupBp } });
      lastEventId = await logEvent(tx, {
        groupId,
        actorId,
        undo: { type: "group_set", data: { cardMarkupBp: group.cardMarkupBp } },
        kind: "markup_changed",
        text: `set the card markup to ${formatPercent(changes.markupBp)}`,
        details: [`Card markup: ${formatPercent(group.cardMarkupBp)} → ${formatPercent(changes.markupBp)}`, "Applies to new expenses only"],
      });
    }
  });
  return { ok: true, eventId: lastEventId };
}

// Change the group's currency. Every expense, share and payment is converted
// at `rate` (1 old = rate new). Original receipt amounts are kept as they were,
// and every expense's shares still add up exactly.
export async function changeGroupCurrency(groupId: string, actorId: string, newCurrency: string, rate: string): Promise<Result> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { expenses: { include: { shares: true } }, payments: true, members: { select: { id: true } } },
  });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change it." };
  if (await hasLeft(groupId, actorId)) return { ok: false, error: LEFT_ERROR };
  if (!isSupportedCurrency(newCurrency)) return { ok: false, error: "Pick a currency from the list." };
  if (newCurrency === group.currency) return { ok: true };
  // A card game still being played would come out a cent or two off after
  // converting each buy-in and return on its own: finish it first.
  if (await db.potGame.count({ where: { groupId, status: "open" } })) return { ok: false, error: "Finish (or delete) the card game that’s still open first, then change the currency." };
  // Everything else that holds money: bills, budgets, goals, the deposit, the
  // smallest payment worth settling and card games. All at the same rate.
  const otherBefore = await loadOtherMoney(groupId, group.settleMin);
  const hasMoney = group.expenses.length > 0 || group.payments.length > 0 || hasOtherMoney(otherBefore);
  if (hasMoney && !parseRate(rate)) return { ok: false, error: "Enter the conversion rate, like 0.012." };

  const oldCurrency = group.currency;
  const expenseUpdates = group.expenses.map((e) => ({ e, r: rebaseExpense(e, oldCurrency, newCurrency, rate) }));
  if (expenseUpdates.some((x) => x.r === null)) return { ok: false, error: "That rate makes some amounts too small or too large. Check it." };
  const paymentUpdates = group.payments.map((p) => ({ p, amount: rebasePayment(p.amount, oldCurrency, newCurrency, rate) }));
  if (paymentUpdates.some((x) => x.amount === null || x.amount <= 0)) return { ok: false, error: "That rate makes a payment too small. Check it." };

  const otherAfter = convertOtherMoney(otherBefore, (a) => rebaseSigned(a, oldCurrency, newCurrency, rate));
  if (!otherAfter) return { ok: false, error: "That rate makes a bill, budget, goal or deposit too small or too large. Check it." };

  const totalBefore = group.expenses.filter((e) => !e.deletedAt).reduce((s, e) => s + e.amount, 0);
  const totalAfter = expenseUpdates.filter((x) => !x.e.deletedAt).reduce((s, x) => s + x.r!.amount, 0);

  // Exactly what every amount was, so the change can be undone without rounding.
  const before = {
    type: "currency_restore" as const,
    currency: oldCurrency,
    expenses: group.expenses.map((e) => ({
      id: e.id,
      baseCurrency: e.baseCurrency,
      exchangeRate: e.exchangeRate,
      rateSource: e.rateSource,
      convertedAmount: e.convertedAmount,
      markupAmount: e.markupAmount,
      amount: e.amount,
      payers: e.payers,
      shares: e.shares.map((s) => ({ id: s.id, amount: s.amount })),
    })),
    payments: group.payments.map((p) => ({ id: p.id, amount: p.amount })),
    other: otherBefore,
    after: otherAfter, // what was written, so undo can tell if anything changed since
  };

  const eventId = await db.$transaction(async (tx) => {
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
          payers: r!.payers,
        },
      });
      for (const s of r!.shares) await tx.expenseShare.update({ where: { id: s.id }, data: { amount: s.amount } });
    }
    for (const { p, amount } of paymentUpdates) await tx.payment.update({ where: { id: p.id }, data: { amount: amount! } });
    await writeOtherMoney(tx, otherAfter);
    await tx.group.update({ where: { id: group.id }, data: { currency: newCurrency, settleMin: otherAfter.settleMin } });
    return logEvent(tx, {
      groupId,
      actorId,
      undo: before,
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
  return { ok: true, eventId };
}

// ---------- Money outside expenses and payments ----------

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

function rebaseSigned(amount: number, from: string, to: string, rate: string): number | null {
  if (amount === 0) return 0;
  const v = rebasePayment(Math.abs(amount), from, to, rate);
  return v === null ? null : amount < 0 ? -v : v;
}

// True if anything besides expenses and payments holds an amount.
export function hasOtherMoney(o: OtherMoney): boolean {
  return o.settleMin > 0 || o.bills.length > 0 || o.budgets.length > 0 || o.goals.length > 0 || o.goalEntries.length > 0 || o.depositShares.length > 0 || o.potMoves.length > 0;
}

// The same money in a fixed order, to compare two snapshots exactly.
export function sameOtherMoney(a: OtherMoney, b: OtherMoney): boolean {
  const norm = (o: OtherMoney) =>
    JSON.stringify({
      settleMin: o.settleMin,
      bills: [...o.bills].sort((x, y) => x.id.localeCompare(y.id)).map((x) => [x.id, x.amount, x.split]),
      budgets: [...o.budgets].sort((x, y) => x.id.localeCompare(y.id)).map((x) => [x.id, x.amount]),
      goals: [...o.goals].sort((x, y) => x.id.localeCompare(y.id)).map((x) => [x.id, x.target]),
      goalEntries: [...o.goalEntries].sort((x, y) => x.id.localeCompare(y.id)).map((x) => [x.id, x.amount]),
      depositShares: [...o.depositShares].sort((x, y) => x.id.localeCompare(y.id)).map((x) => [x.id, x.amount, x.returnedAmount]),
      potMoves: [...o.potMoves].sort((x, y) => x.id.localeCompare(y.id)).map((x) => [x.id, x.amount]),
    });
  return norm(a) === norm(b);
}

export async function loadOtherMoney(groupId: string, settleMin: number): Promise<OtherMoney> {
  const [bills, budgets, goals, deposit, games] = await Promise.all([
    db.bill.findMany({ where: { groupId }, select: { id: true, amount: true, split: true } }),
    db.budget.findMany({ where: { groupId }, select: { id: true, amount: true } }),
    db.goal.findMany({ where: { groupId }, select: { id: true, target: true, entries: { select: { id: true, amount: true } } } }),
    db.deposit.findUnique({ where: { groupId }, select: { shares: { select: { id: true, amount: true, returnedAmount: true } } } }),
    db.potGame.findMany({ where: { groupId }, select: { moves: { select: { id: true, amount: true } } } }),
  ]);
  return {
    settleMin,
    bills,
    budgets,
    goals: goals.map((g) => ({ id: g.id, target: g.target })),
    goalEntries: goals.flatMap((g) => g.entries),
    depositShares: deposit?.shares ?? [],
    potMoves: games.flatMap((g) => g.moves),
  };
}

// The same money at a new rate; null if any amount can't be converted. A bill
// split by fixed amounts is re-shared by weight, so it still adds up exactly.
export function convertOtherMoney(o: OtherMoney, conv: (amount: number) => number | null): OtherMoney | null {
  let bad = false;
  const c = (a: number) => {
    const v = conv(a);
    if (v === null) bad = true;
    return v ?? 0;
  };
  const bills = o.bills.map((b) => {
    const amount = c(b.amount);
    let split = b.split;
    try {
      const s = JSON.parse(b.split) as { mode?: string; amt?: Record<string, number> };
      if (s.mode === "amounts" && s.amt) {
        const entries = Object.entries(s.amt).map(([memberId, weight]) => ({ memberId, weight: Math.max(0, Math.round(weight)) }));
        const total = entries.reduce((x, e) => x + e.weight, 0);
        const target = total === b.amount ? amount : c(total);
        const amt = Object.fromEntries(allocateByWeights(target, entries).map((x) => [x.memberId, x.amount]));
        split = JSON.stringify({ ...s, amt });
      }
    } catch {
      // Not JSON we know: left as it is.
    }
    return { id: b.id, amount, split };
  });
  const out: OtherMoney = {
    settleMin: c(o.settleMin),
    bills,
    budgets: o.budgets.map((x) => ({ id: x.id, amount: c(x.amount) })),
    goals: o.goals.map((x) => ({ id: x.id, target: c(x.target) })),
    goalEntries: o.goalEntries.map((x) => ({ id: x.id, amount: c(x.amount) })),
    depositShares: o.depositShares.map((x) => ({ id: x.id, amount: c(x.amount), returnedAmount: c(x.returnedAmount) })),
    potMoves: o.potMoves.map((x) => ({ id: x.id, amount: c(x.amount) })),
  };
  return bad ? null : out;
}

// Rows deleted since are skipped (updateMany), so an old undo never fails on them.
export async function writeOtherMoney(tx: Tx, o: OtherMoney): Promise<void> {
  for (const b of o.bills) await tx.bill.updateMany({ where: { id: b.id }, data: { amount: b.amount, split: b.split } });
  for (const b of o.budgets) await tx.budget.updateMany({ where: { id: b.id }, data: { amount: b.amount } });
  for (const g of o.goals) await tx.goal.updateMany({ where: { id: g.id }, data: { target: g.target } });
  for (const e of o.goalEntries) await tx.goalEntry.updateMany({ where: { id: e.id }, data: { amount: e.amount } });
  for (const d of o.depositShares) await tx.depositShare.updateMany({ where: { id: d.id }, data: { amount: d.amount, returnedAmount: d.returnedAmount } });
  for (const m of o.potMoves) await tx.potMove.updateMany({ where: { id: m.id }, data: { amount: m.amount } });
}
