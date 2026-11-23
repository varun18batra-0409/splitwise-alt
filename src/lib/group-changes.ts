import { parsePayers, spentAmount } from "./payers";
import { squareGameMoves } from "./pot-currency";
import { db } from "./db";
import { hasLeft, LEFT_ERROR } from "./active";
import { logEvent, type Db, type OtherMoney } from "./events";
import { allocateByWeights } from "./split";
import { formatMoney, formatPercent, isSupportedCurrency } from "./money";
import { parseRate } from "./conversion";
import { keepSquareAtZero, rebaseExpense, squareLimit, rebasePayment, type SquareExpense, type SquarePayment } from "./rebase";
import { GroupChanged, ledgerInTx, moneySig } from "./money-guard";

type Result = { ok: true; eventId?: string } | { ok: false; error: string; needsRate?: true };

// Converting would leave someone who is settled up (or who has left) with a tiny balance, and no nudge of a paisa can fix it.
export const CURRENCY_ROUNDING_TEXT = "At this rate, rounding would leave someone who’s settled up with a tiny balance, so the currency wasn’t changed. Try a slightly different rate.";
export const CURRENCY_PAYMENT_TEXT = "That rate makes a payment too small or too large. Check it.";

export { squareLimit };
const MORE_THAN_ROUNDING = (cur: string) => `That’s more than rounding, usually because some expenses were entered in ${cur} at a different rate. Nothing was changed. Check the rate.`;
export const paymentJumpText = (payer: string, payee: string, was: string, now: string, plain: string, cur: string) =>
  `At this rate, ${payer}’s ${was} payment to ${payee} would have to become ${now} (not ${plain}) to keep everyone settled. ${MORE_THAN_ROUNDING(cur)}`;
export const shareJumpText = (person: string, expense: string, now: string, plain: string, cur: string) =>
  `At this rate, ${person}’s share of ${expense} would have to become ${now} (not ${plain}) to keep everyone settled. ${MORE_THAN_ROUNDING(cur)}`;
export const paymentRoundedLine = (payer: string, payee: string, was: string, now: string) => `${payer} → ${payee}: ${was} is now ${now} (rounded so balances stay settled).`;

export const PAIR_NO_SETTINGS = "This is just between two people, so it has no settings to change.";

// Rename the group and/or change its card markup. Logged for everyone.
export async function updateGroupBasics(
  groupId: string,
  actorId: string,
  changes: { name?: string; markupBp?: number; secondaryCurrency?: string },
  opts?: { dryRun?: boolean; tx?: Db }, // tx: run inside the caller's transaction (the one Save)
): Promise<Result> {
  const c = opts?.tx ?? db;
  const group = await c.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (group.type === "direct") return { ok: false, error: PAIR_NO_SETTINGS }; // a pair has no name or settings to change
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change it." };
  if (await hasLeft(groupId, actorId, c)) return { ok: false, error: LEFT_ERROR };
  const name = changes.name?.trim().replace(/\s+/g, " ").slice(0, 60);
  if (changes.name !== undefined && !name) return { ok: false, error: "Give the group a name." };

  const sec = changes.secondaryCurrency;
  if (sec !== undefined && sec !== "" && sec !== "none" && !isSupportedCurrency(sec)) return { ok: false, error: "Pick a currency from the list." };
  if (opts?.dryRun) return { ok: true }; // checked only: the one Save validates everything before writing anything

  let lastEventId: string | undefined;
  const write = async (tx: Db) => {
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
  };
  if (opts?.tx) await write(opts.tx);
  else await db.$transaction(write);
  return { ok: true, eventId: lastEventId };
}

// Thrown inside the write transaction to roll it back with the answer to give.
class Refused extends Error {
  constructor(public result: Extract<Result, { ok: false }>) {
    super("currency change refused");
  }
}

// Change the group's currency. Every expense, share and payment is converted
// at `rate` (1 old = rate new). Original receipt amounts are kept as they were,
// and every expense's shares still add up exactly.
// expectEmpty: the caller checked that the group holds no money and so uses rate "1". If money turned up since
// (an expense added meanwhile), nothing is changed and `needsRate` says the caller must ask for a real rate.
// `afterRead` is for tests only: it runs after the group has been read and before the write begins (the gap in which
// someone else can add an expense).
// quiet (only with expectEmpty, so there is no money to account for): no history line, so nobody is told and there is nothing to undo.
export async function changeGroupCurrency(groupId: string, actorId: string, newCurrency: string, rate: string, opts?: { expectEmpty?: boolean; quiet?: boolean; afterRead?: () => Promise<void> }): Promise<Result> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: {
      expenses: { include: { shares: true, items: { select: { id: true } } } },
      payments: true,
      members: { select: { id: true, name: true, leftAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  // A pair's currency is fixed by its first expense: the only way in is the empty-pair path (expectEmpty), which writes nothing once money is there.
  if (group.type === "direct" && !opts?.expectEmpty) return { ok: false, error: PAIR_NO_SETTINGS };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change it." };
  if (await hasLeft(groupId, actorId)) return { ok: false, error: LEFT_ERROR };
  if (!isSupportedCurrency(newCurrency)) return { ok: false, error: "Pick a currency from the list." };
  if (newCurrency === group.currency) return { ok: true };
  // A card game still being played would come out a cent or two off after
  // converting each chips-in and took-home line on its own: finish it first.
  if (await db.potGame.count({ where: { groupId, status: "open", deletedAt: null } })) return { ok: false, error: "Finish (or delete) the game that’s still open first, then change the currency." };
  // Everything else that holds money: bills, budgets, goals, the deposit, the
  // smallest payment worth settling and card games. All at the same rate.
  const otherBefore = await loadOtherMoney(groupId, group.settleMin);
  const hasMoney = group.expenses.length > 0 || group.payments.length > 0 || hasOtherMoney(otherBefore);
  if (hasMoney && opts?.expectEmpty) return { ok: false, error: "Something was added to the group just now, so the new currency needs a conversion rate.", needsRate: true };
  if (hasMoney && !parseRate(rate)) return { ok: false, error: "Enter the conversion rate, like 0.012." };

  const oldCurrency = group.currency;
  const expenseUpdates = group.expenses.map((e) => ({ e, r: rebaseExpense(e, oldCurrency, newCurrency, rate) }));
  if (expenseUpdates.some((x) => x.r === null)) return { ok: false, error: "That rate makes some amounts too small or too large. Check it." };
  const paymentUpdates = group.payments.map((p) => ({ p, amount: rebasePayment(p.amount, oldCurrency, newCurrency, rate) }));
  if (paymentUpdates.some((x) => x.amount === null || x.amount <= 0)) return { ok: false, error: CURRENCY_PAYMENT_TEXT };

  // Everyone who was settled up (or has left) must stay exactly at 0: nudge whole paise between the shares of an expense or the
  // two sides of a payment (see keepSquareAtZero). Nothing in the books changes except those rows.
  const liveExpenses = expenseUpdates.filter((x) => !x.e.deletedAt);
  const livePayments = paymentUpdates.filter((x) => !x.p.deletedAt);
  const squareRows = (xs: typeof liveExpenses, rebased: boolean): SquareExpense[] =>
    xs.map(({ e, r }) => ({
      id: e.id,
      createdAt: e.createdAt.getTime(),
      kind: e.kind,
      paidById: e.paidById,
      payers: rebased ? r!.payers : e.payers,
      amount: rebased ? r!.amount : e.amount,
      itemSplit: e.items.length > 0,
      shares: e.shares.map((s) => ({ id: s.id, memberId: s.memberId, amount: rebased ? r!.shares.find((x) => x.id === s.id)!.amount : s.amount })),
    }));
  const squarePayments = (rebased: boolean): SquarePayment[] =>
    livePayments.map(({ p, amount }) => ({ id: p.id, createdAt: p.createdAt.getTime(), fromId: p.fromId, toId: p.toId, amount: rebased ? amount! : p.amount }));
  let squared: ReturnType<typeof keepSquareAtZero> = null;
  let roundedLines: string[] = []; // Activity: payments that moved by 2 or more to keep someone settled (at most 5, then "and N more")
  if (liveExpenses.length || livePayments.length) {
    const squareInput = {
      members: group.members.map((m) => ({ id: m.id, left: Boolean(m.leftAt) })),
      before: { expenses: squareRows(liveExpenses, false), payments: squarePayments(false) },
      after: { expenses: squareRows(liveExpenses, true), payments: squarePayments(true) },
      convert: (a: number) => rebasePayment(a, oldCurrency, newCurrency, rate),
    };
    // First spread the nudges so no row moves beyond rounding. If no row has room, look at the unlimited answer: the check below then
    // says which payment or share would have had to move too far (and if there is no answer at all, it is the rounding refusal).
    squared = keepSquareAtZero(squareInput, { rowLimit: true }) ?? keepSquareAtZero(squareInput);
    if (!squared) return { ok: false, error: CURRENCY_ROUNDING_TEXT };
    // Keeping people settled may nudge a few paise, never rewrite a past payment or share: a bigger move means the rate does not
    // fit the group's history (some expenses were entered at another rate). Refused before anything is written.
    const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "Someone";
    const order = (id: string) => group.members.findIndex((m) => m.id === id); // ties are named in member order, so the sentence is always the same
    const bigPay = livePayments
      .map(({ p, amount }) => ({ p, plain: amount!, final: squared!.payments[p.id], delta: squared!.moved.payments[p.id] ?? 0 }))
      .filter((x) => Math.abs(x.delta) > squareLimit(x.plain))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || order(a.p.fromId) - order(b.p.fromId) || a.p.id.localeCompare(b.p.id))[0];
    if (bigPay) {
      return { ok: false, error: paymentJumpText(nameOf(bigPay.p.fromId), nameOf(bigPay.p.toId), formatMoney(bigPay.p.amount, oldCurrency), formatMoney(bigPay.final, newCurrency), formatMoney(bigPay.plain, newCurrency), newCurrency) };
    }
    const bigShare = liveExpenses
      .flatMap(({ e, r }) => e.shares.map((s) => ({ e, s, plain: r!.shares.find((x) => x.id === s.id)!.amount })))
      .map((x) => ({ ...x, final: squared!.shares[x.s.id], delta: squared!.moved.shares[x.s.id] ?? 0 }))
      .filter((x) => Math.abs(x.delta) > squareLimit(x.plain))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || order(a.s.memberId) - order(b.s.memberId) || a.s.id.localeCompare(b.s.id))[0];
    if (bigShare) {
      return { ok: false, error: shareJumpText(nameOf(bigShare.s.memberId), bigShare.e.description, formatMoney(bigShare.final, newCurrency), formatMoney(bigShare.plain, newCurrency), newCurrency) };
    }
    for (const x of expenseUpdates) {
      for (const s of x.r!.shares) if (squared.shares[s.id] !== undefined) s.amount = squared.shares[s.id];
    }
    const moved = livePayments
      .map(({ p, amount }) => ({ p, plain: amount!, final: squared!.payments[p.id], delta: squared!.moved.payments[p.id] ?? 0 }))
      .filter((x) => Math.abs(x.delta) >= 2)
      .sort((a, b) => a.p.createdAt.getTime() - b.p.createdAt.getTime() || a.p.id.localeCompare(b.p.id));
    roundedLines = moved.slice(0, 5).map((x) => paymentRoundedLine(nameOf(x.p.fromId), nameOf(x.p.toId), formatMoney(x.p.amount, oldCurrency), formatMoney(x.final, newCurrency)));
    if (moved.length > 5) roundedLines.push(`and ${moved.length - 5} more`);
    for (const x of paymentUpdates) if (squared.payments[x.p.id] !== undefined) x.amount = squared.payments[x.p.id];
  }

  const otherAfter = convertOtherMoney(otherBefore, (a) => rebaseSigned(a, oldCurrency, newCurrency, rate));
  if (!otherAfter) return { ok: false, error: "That rate makes a bill, budget, goal or deposit too small or too large. Check it." };
  // Each finished card game's lines were converted one by one; its result was converted as one expense. Make every player's net match the
  // converted result exactly (and the game's gap 0), by nudging their own take/return lines by whole minor units.
  const games = await db.potGame.findMany({ where: { groupId, deletedAt: null, status: "done" }, select: { resultId: true, moves: { select: { id: true, memberId: true, kind: true, amount: true, deletedAt: true } } } });
  for (const game of games) {
    const result = game.resultId ? expenseUpdates.find((x) => x.e.id === game.resultId) : undefined;
    if (game.resultId && (!result || result.e.deletedAt)) continue; // a result that is gone: nothing to match
    const targets: Record<string, number> = {};
    if (result) {
      const paid = parsePayers(result.r!.payers);
      for (const p of paid.length ? paid : [{ memberId: result.e.paidById, amount: result.r!.amount }]) targets[p.memberId] = (targets[p.memberId] ?? 0) + p.amount;
      for (const sh of result.r!.shares) {
        const memberId = result.e.shares.find((x) => x.id === sh.id)?.memberId;
        if (memberId) targets[memberId] = (targets[memberId] ?? 0) - sh.amount;
      }
    }
    const converted = new Map(otherAfter.potMoves.map((m) => [m.id, m.amount]));
    const nudged = squareGameMoves(game.moves.map((m) => ({ id: m.id, memberId: m.memberId, kind: m.kind, amount: converted.get(m.id) ?? m.amount, live: !m.deletedAt })), targets);
    if (!nudged) return { ok: false, error: CURRENCY_ROUNDING_TEXT };
    otherAfter.potMoves = otherAfter.potMoves.map((m) => (m.id in nudged ? { ...m, amount: nudged[m.id] } : m));
  }

  // The group's spending: money back takes away, a card game's result isn't spending (spentAmount), a deleted expense doesn't count.
  const totalBefore = group.expenses.filter((e) => !e.deletedAt).reduce((s, e) => s + spentAmount(e), 0);
  const totalAfter = expenseUpdates.filter((x) => !x.e.deletedAt).reduce((s, x) => s + spentAmount({ amount: x.r!.amount, kind: x.e.kind }), 0);

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

  await opts?.afterRead?.();
  try {
  const eventId: string | undefined = await db.$transaction(async (tx) => {
    // First a write that only matches if the group is still as read (same currency, not deleted; closed is fine here):
    // it takes the write lock, so every count below is current and no other money save can slip in until we commit.
    // (Money saves do the same with guardGroup, so one of the two always loses cleanly.)
    const held = await tx.group.updateMany({ where: { id: groupId, deletedAt: null, currency: oldCurrency }, data: { currency: oldCurrency } });
    if (held.count !== 1) throw new Refused({ ok: false, error: "The group’s currency was changed just now. Check and try again." });
    // A game that was started (or is still open) while we were reading: its chips would come out a cent off.
    if (await tx.potGame.count({ where: { groupId, status: "open", deletedAt: null } })) {
      throw new Refused({ ok: false, error: "Finish (or delete) the game that’s still open first, then change the currency." });
    }
    // The checks above were made before this transaction began. Count again inside it: money that turned up in the
    // gap would otherwise be left in the old currency (or, for a group thought empty, be converted at rate 1).
    const [expensesNow, paymentsNow, settleNow] = await Promise.all([
      tx.expense.count({ where: { groupId } }),
      tx.payment.count({ where: { groupId } }),
      tx.group.findUnique({ where: { id: groupId }, select: { settleMin: true, currency: true } }),
    ]);
    const otherNow = await loadOtherMoney(groupId, settleNow?.settleMin ?? group.settleMin, tx);
    if (settleNow && settleNow.currency !== oldCurrency) throw new Refused({ ok: false, error: "The group’s currency was changed just now. Check and try again." });
    if (opts?.expectEmpty) {
      if (expensesNow > 0 || paymentsNow > 0 || hasOtherMoney(otherNow)) {
        throw new Refused({ ok: false, error: "Something was added to the group just now, so the new currency needs a conversion rate.", needsRate: true });
      }
    } else if (expensesNow !== group.expenses.length || paymentsNow !== group.payments.length || !sameOtherMoney(otherNow, otherBefore)) {
      throw new Refused({ ok: false, error: "Something in the group changed just now. Check it and try again." });
    }
    if (!opts?.expectEmpty) {
      // Same counts is not enough: an edit in the gap would be overwritten by nudges worked out from the old numbers.
      const [expensesRead, paymentsRead] = await Promise.all([
        tx.expense.findMany({ where: { groupId }, include: { shares: true } }),
        tx.payment.findMany({ where: { groupId } }),
      ]);
      if (moneySig(expensesRead, paymentsRead) !== moneySig(group.expenses, group.payments)) {
        throw new Refused({ ok: false, error: "Something in the group changed just now. Check it and try again." });
      }
    }
    for (const { e, r } of expenseUpdates) {
      // updateMany + a count: an edit that replaced this expense's shares in the gap is a calm "changed", not an error.
      const wrote = await tx.expense.updateMany({
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
      if (wrote.count !== 1) throw new Refused({ ok: false, error: "Something in the group changed just now. Check it and try again." });
      for (const s of r!.shares) {
        const one = await tx.expenseShare.updateMany({ where: { id: s.id }, data: { amount: s.amount } });
        if (one.count !== 1) throw new Refused({ ok: false, error: "Something in the group changed just now. Check it and try again." });
      }
    }
    for (const { p, amount } of paymentUpdates) {
      const one = await tx.payment.updateMany({ where: { id: p.id }, data: { amount: amount! } });
      if (one.count !== 1) throw new Refused({ ok: false, error: "Something in the group changed just now. Check it and try again." });
    }
    // The proof, read back from the database: everyone who had to stay at a balance is exactly on it.
    if (squared) {
      const { net } = await ledgerInTx(tx, groupId);
      if (Object.entries(squared.targets).some(([id, t]) => (net[id] ?? 0) !== t)) throw new Refused({ ok: false, error: CURRENCY_ROUNDING_TEXT });
    }
    await writeOtherMoney(tx, otherAfter);
    await tx.group.update({ where: { id: group.id }, data: { currency: newCurrency, settleMin: otherAfter.settleMin } });
    if (opts?.quiet && opts.expectEmpty) return undefined;
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
            ...roundedLines,
          ]
        : [`Currency: ${oldCurrency} → ${newCurrency}`],
    });
  }, { timeout: 15000 });
  return { ok: true, eventId };
  } catch (e) {
    if (e instanceof Refused) return e.result;
    if (e instanceof GroupChanged) return { ok: false, error: "The group’s currency was changed just now. Check and try again." };
    throw e;
  }
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

export async function loadOtherMoney(groupId: string, settleMin: number, c: Db = db): Promise<OtherMoney> {
  const [bills, budgets, goals, deposit, games] = await Promise.all([
    c.bill.findMany({ where: { groupId }, select: { id: true, amount: true, split: true } }),
    c.budget.findMany({ where: { groupId }, select: { id: true, amount: true } }),
    c.goal.findMany({ where: { groupId }, select: { id: true, target: true, entries: { select: { id: true, amount: true } } } }),
    c.deposit.findUnique({ where: { groupId }, select: { shares: { select: { id: true, amount: true, returnedAmount: true } } } }),
    c.potGame.findMany({ where: { groupId }, select: { moves: { select: { id: true, amount: true } } } }),
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
