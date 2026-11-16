import { db } from "../db";
import { logEvent, markUndone, expenseState, touchedByExpense, type MoveOutUndo, type UndoMark } from "../events";
import { netBalances } from "../balances";
import { formatMoney, parseAmount } from "../money";
import { claimKey, fingerprintOf, isDuplicateKey, keyState, STALE_KEY_ERROR } from "../once";
import { niceDate } from "../format";
import { createPayment } from "../payments";
import { addMonths, daysInMonth } from "./month";
import { DEFAULT_TIME_ZONE, dayKey } from "../dates";
import { addPrepaid, dailyPrecharge, depositRefunds, leaverPayments, parsePrepaid, proRataShares, removePrepaid, type DailyPrecharge } from "./moving";
import { monthsBetween, payerFor } from "./bills";
import type { Transfer } from "../settle";
import { GroupChanged, groupChangedText, guardGroup, ledgerInTx, LeaverBreak, leaverBalanceBreaks } from "../money-guard";
import { needsOkFor } from "../payment-ok";
import { claimRef, tellReceiver } from "../payment-claims";
import { lateMoveText, putBackOpen } from "../put-back";
import type { Prisma } from "@prisma/client";
import { PAIR_NO_MOVE_OUT } from "../direct-guard";

// Moving out, the deposit — database side.

type Fail = { ok: false; error: string };

export const CURRENCY_SINCE = "The group currency changed after the move-out, so it can’t be undone.";
// An "I've paid" note involving the person moving out is still waiting: it would be silently closed by the square-up, so it is sorted out first.
export const MOVE_OUT_WAITING_NOTE = "There’s an “I’ve paid” waiting to be confirmed. Sort it out on Settle up first, then do the move-out.";
// The payments shown on the page are not what would be recorded now.
export const MOVE_OUT_KEY_CHANGED = "Balances changed since you opened this. Check the move-out again.";

async function loadFlat(groupId: string) {
  return db.group.findUnique({
    where: { id: groupId },
    include: {
      members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      expenses: { where: { deletedAt: null }, include: { shares: true } },
      payments: { where: { deletedAt: null } },
      deposit: { include: { shares: true } },
    },
  });
}
type Flat = NonNullable<Awaited<ReturnType<typeof loadFlat>>>;

// Bill expenses (rent, Wi-Fi…) the leaver shares in, from the month of their
// last day onwards: that month is pro-rata, any later month isn't theirs at all.
async function billExpensesFor(flat: Flat, leaverId: string, fromMonth: string) {
  const runs = await db.billRun.findMany({ where: { period: { gte: fromMonth }, status: "added", bill: { groupId: flat.id } }, select: { expenseId: true, period: true } });
  const periodOf = new Map(runs.map((r) => [r.expenseId, r.period]));
  return flat.expenses
    .filter((e) => periodOf.has(e.id) && e.shares.some((s) => s.memberId === leaverId && s.amount > 0))
    .map((e) => ({ e, period: periodOf.get(e.id)! }))
    .sort((a, b) => a.period.localeCompare(b.period) || a.e.description.localeCompare(b.e.description));
}
type BillExpense = Awaited<ReturnType<typeof billExpensesFor>>[number];

// Daily bills (milk, water cans) whose month hasn't been added yet: the leaver's share of the
// days they were there, which would otherwise never reach them (only people still here share the month-end bill).
type DailyOffer = { bill: Awaited<ReturnType<typeof db.bill.findMany>>[number]; period: string; d: DailyPrecharge };
async function dailyOffers(flat: Flat, leaverId: string, lastDay: string): Promise<DailyOffer[]> {
  const period = lastDay.slice(0, 7);
  const bills = await db.bill.findMany({ where: { groupId: flat.id, nature: "daily", deletedAt: null, paused: false }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const runs = await db.billRun.findMany({ where: { period, billId: { in: bills.map((b) => b.id) } }, select: { billId: true, status: true } });
  const members = flat.members.map((m) => ({ id: m.id, splitWeight: m.splitWeight, joinedFrom: m.joinedFrom, leftAt: m.leftAt }));
  const out: DailyOffer[] = [];
  for (const bill of bills) {
    if (period < bill.startMonth || (bill.endMonth && period > bill.endMonth) || monthsBetween(bill.startMonth, period) % Math.max(1, bill.every) !== 0) continue;
    // Already added (the existing re-split handles it), skipped or being added: nothing to charge now.
    const run = runs.find((r) => r.billId === bill.id);
    if (run && run.status !== "waiting") continue;
    if ((parsePrepaid(bill.prepaid)[period] ?? []).some((x) => x.m === leaverId)) continue;
    const d = dailyPrecharge(bill, period, lastDay, members, leaverId);
    if (d.unsupported || d.amount > 0) out.push({ bill, period, d });
  }
  return out;
}

// Who pays the precharge expense: the bill's payer once the leaver's bills are handed on (or the heir).
function prechargePayer(bill: DailyOffer["bill"], period: string, leaverId: string, others: string[], heir: string): string {
  let rotation: string[] = [];
  try {
    const v = JSON.parse(bill.rotation);
    if (Array.isArray(v)) rotation = v.filter((x): x is string => typeof x === "string" && x !== leaverId);
  } catch {
    rotation = [];
  }
  const payer = bill.payer === leaverId ? heir : bill.payer;
  return payerFor({ payer, rotation: JSON.stringify(rotation), startMonth: bill.startMonth, every: bill.every }, period, others) ?? heir;
}

// "1–14 Nov" (or "5–14 Nov" for someone who moved in on the 5th).
function stayLabel(lastDay: string, joinedFrom: Date | null): string {
  const from = joinedFrom && joinedFrom.toISOString().slice(0, 7) === lastDay.slice(0, 7) ? Number(joinedFrom.toISOString().slice(8, 10)) : 1;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(lastDay.slice(5, 7)) - 1] ?? "";
  return `${from}–${Number(lastDay.slice(8, 10))} ${month}`;
}

type Charge = { payerId: string; amount: number };

// The final payments, split in two. When the person squaring up is the one PAYING (they move out owing, or they mark someone out who is
// owed by them), and the person paid has joined (can tap Confirm received), nothing is counted until that person confirms: it becomes an
// "I've paid" note. Everything else is recorded as paid at once, as before (a name nobody has joined can't confirm anything).
function splitSquareUp(flat: Flat, actorId: string, transfers: Transfer[]): { claims: Transfer[]; paid: Transfer[] } {
  const claims: Transfer[] = [];
  const paid: Transfer[] = [];
  for (const t of transfers) {
    const receiver = flat.members.find((m) => m.id === t.to);
    if (t.from === actorId && needsOkFor(receiver, actorId)) claims.push(t);
    else paid.push(t);
  }
  return { claims, paid };
}

// The final payments as one comparable text: the move-out page posts it, and the move-out refuses if it is not what would be recorded now.
export const transfersKey = (ts: Transfer[]) => ts.map((t) => `${t.from}>${t.to}:${t.amount}`).sort().join("|");

// Is an "I've paid" note waiting that involves this person (as payer or as the one paid)?
async function waitingNoteFor(client: Client, groupId: string, memberId: string): Promise<boolean> {
  const row = await client.paymentClaim.findFirst({ where: { groupId, status: "waiting", OR: [{ fromId: memberId }, { toId: memberId }] }, select: { id: true } });
  return Boolean(row);
}

function plan(flat: Flat, leaverId: string, lastDay: string, bills: BillExpense[], charges: Charge[] = []) {
  const month = lastDay.slice(0, 7);
  const monthDays = daysInMonth(month);
  const daysStayed = Number(lastDay.slice(8, 10));
  // Only people still in the flat take the freed share: someone who moved out earlier left square and stays that way.
  const stillHere = new Set(flat.members.filter((m) => !m.leftAt && m.id !== leaverId).map((m) => m.id));
  const resplit = bills.map(({ e, period }) => {
    const days = period === month ? daysStayed : 0;
    // What's freed goes to the others the way this expense was already shared.
    const weights = Object.fromEntries(e.shares.map((x) => [x.memberId, x.amount]));
    return { e, period, days, monthDays: daysInMonth(period), shares: proRataShares(e.shares, leaverId, days, daysInMonth(period), weights, stillHere) };
  });
  const credit = resplit.reduce(
    (s, r) => s + (r.e.shares.find((x) => x.memberId === leaverId)?.amount ?? 0) - (r.shares.find((x) => x.memberId === leaverId)?.amount ?? 0),
    0,
  );
  const ids = flat.members.map((m) => m.id);
  const before = netBalances(ids, flat.expenses, flat.payments);
  // The daily-bill shares charged now: the payer is credited, the leaver owes.
  const extra = charges.map((c) => ({ paidById: c.payerId, amount: c.amount, shares: [{ memberId: leaverId, amount: c.amount }] }));
  const after = netBalances(
    ids,
    [...flat.expenses.map((e) => resplit.find((r) => r.e.id === e.id) ? { ...e, shares: resplit.find((r) => r.e.id === e.id)!.shares } : e), ...extra],
    flat.payments,
  );
  return { resplit, credit, before, after, payments: leaverPayments(after, leaverId), daysStayed, monthDays };
}

// The last day: a real date, not in the future, and this month or last.
function checkDay(lastDay: string, now: Date): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay) || Number.isNaN(new Date(`${lastDay}T12:00:00Z`).getTime())) return "Pick the last day in the flat.";
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  if (lastDay > today) return "The last day can’t be in the future. Do this on the day they move out (or after).";
  if (lastDay.slice(0, 7) < addMonths(today.slice(0, 7), -1)) return "Pick a last day this month or last month.";
  return null;
}

// `actorId`: who is confirming it. They take over the leaver's bills if they are staying, exactly as moveOut does.
export async function moveOutPreview(groupId: string, leaverId: string, lastDay: string, now = new Date(), actorId = "") {
  const flat = await loadFlat(groupId);
  if (!flat || flat.deletedAt) return { ok: false, error: "This group no longer exists." } as Fail;
  if (flat.type === "direct") return { ok: false, error: PAIR_NO_MOVE_OUT } as Fail;
  if (!flat.members.some((m) => m.id === leaverId && !m.leftAt)) return { ok: false, error: "That person isn’t in the flat." } as Fail;
  const bad = checkDay(lastDay, now);
  if (bad) return { ok: false, error: bad } as Fail;
  if (await waitingNoteFor(db, groupId, leaverId)) return { ok: false, error: MOVE_OUT_WAITING_NOTE } as Fail;
  const bills = await billExpensesFor(flat, leaverId, lastDay.slice(0, 7));
  const p = plan(flat, leaverId, lastDay, bills);
  const dep = flat.deposit?.shares.find((s) => s.memberId === leaverId && s.status === "held") ?? null;
  // Daily bills this month: their share for the days they were there, charged now if they tick "Add it now".
  const offers = await dailyOffers(flat, leaverId, lastDay);
  const others = flat.members.filter((m) => !m.leftAt && m.id !== leaverId);
  const heir = others.find((m) => m.id === actorId)?.id ?? others[0]?.id ?? "";
  const charges = offers.filter((o) => !o.d.unsupported).map((o) => ({ payerId: prechargePayer(o.bill, o.period, leaverId, others.map((m) => m.id), heir), amount: o.d.amount }));
  const withDaily = charges.length ? plan(flat, leaverId, lastDay, bills, charges).payments : p.payments;
  // Which of the final payments wait for the person paid to confirm (only when the person confirming this is the one paying).
  const waitsOf = (ts: Transfer[]) => splitSquareUp(flat, actorId, ts).claims.map((t) => `${t.from}>${t.to}`);
  return {
    ok: true as const,
    balanceToday: p.before[leaverId] ?? 0,
    rentCredit: p.credit,
    bills: p.resplit.map((r) => ({
      name: r.e.description,
      period: r.period,
      days: r.days,
      monthDays: r.monthDays,
      before: r.e.shares.find((x) => x.memberId === leaverId)?.amount ?? 0,
      after: r.shares.find((x) => x.memberId === leaverId)?.amount ?? 0,
    })),
    payments: p.payments,
    daily: offers.map((o) => ({ billId: o.bill.id, name: o.bill.name, days: o.d.days, missed: o.d.missed, amount: o.d.amount, unsupported: o.d.unsupported })),
    paymentsWithDaily: withDaily,
    waits: waitsOf(p.payments), // "from>to" of each final payment that waits for the person paid to confirm
    waitsWithDaily: waitsOf(withDaily),
    expectKey: transfersKey(p.payments), // posted back by the page: the move-out refuses if the payments are different by then
    expectKeyDaily: transfersKey(withDaily),
    daysStayed: p.daysStayed,
    monthDays: p.monthDays,
    deposit: dep ? { amount: dep.amount, heldBy: flat.deposit!.heldBy } : null,
  };
}

export async function moveOut(
  groupId: string,
  actorId: string,
  // `expectKey`: the final payments the person saw (transfersKey). When given, a move-out whose payments are different now is refused.
  // The move-out screen always sends it.
  input: { leaverId: string; lastDay: string; depositTo?: string; addDaily?: boolean; requestKey: string; expectKey?: string },
  now = new Date(),
  opts: { afterRead?: () => Promise<void> } = {}, // tests only: runs after the reads, before the write begins
): Promise<{ ok: true; payments: Transfer[]; claims?: Transfer[]; eventId?: string } | Fail> {
  const fp = fingerprintOf("move-out", groupId, input.leaverId, input.lastDay, input.depositTo ?? "", input.addDaily ? "daily" : "");
  const ks = await keyState(input.requestKey, fp);
  if (ks.state === "stale") return { ok: false, error: STALE_KEY_ERROR };
  if (ks.state === "done") return { ok: true, payments: [] };
  const flat = await loadFlat(groupId);
  if (!flat || flat.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (flat.type === "direct") return { ok: false, error: PAIR_NO_MOVE_OUT };
  if (!flat.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can do this." };
  const leaver = flat.members.find((m) => m.id === input.leaverId && !m.leftAt);
  if (!leaver) return { ok: false, error: "That person isn’t in the flat." };
  const bad = checkDay(input.lastDay, now);
  if (bad) return { ok: false, error: bad };
  const others = flat.members.filter((m) => !m.leftAt && m.id !== leaver.id);
  if (!others.length) return { ok: false, error: "Someone has to stay in the flat." };
  const depositTo = input.depositTo && others.some((m) => m.id === input.depositTo) ? input.depositTo : "";

  const bills = await billExpensesFor(flat, leaver.id, input.lastDay.slice(0, 7));
  const heir = others.find((m) => m.id === actorId)?.id ?? others[0].id;
  // Their share of this month's daily bills, charged now (only if asked: "Add it now").
  const offers = input.addDaily ? (await dailyOffers(flat, leaver.id, input.lastDay)).filter((o) => !o.d.unsupported && o.d.amount > 0) : [];
  const charges = offers.map((o) => ({ ...o, payerId: prechargePayer(o.bill, o.period, leaver.id, others.map((m) => m.id), heir) }));
  const p = plan(flat, leaver.id, input.lastDay, bills, charges.map((c) => ({ payerId: c.payerId, amount: c.d.amount })));
  const name = (id: string) => flat.members.find((m) => m.id === id)?.name ?? "Someone";
  const money = (n: number) => formatMoney(n, flat.currency);
  if (input.expectKey !== undefined && input.expectKey !== transfersKey(p.payments)) return { ok: false, error: MOVE_OUT_KEY_CHANGED };
  if (await waitingNoteFor(db, groupId, leaver.id)) return { ok: false, error: MOVE_OUT_WAITING_NOTE };
  const squareUp = splitSquareUp(flat, actorId, p.payments);

  const netBefore = netBalances(flat.members.map((m) => m.id), flat.expenses, flat.payments);
  await opts.afterRead?.();
  let eventId: string;
  let madeClaims: { id: string; t: Transfer }[] = [];
  try {
    eventId = await db.$transaction(async (tx) => {
      madeClaims = [];
      // First: the flat must still be in the currency the amounts were worked out in, and the person doing it still in it.
      await guardGroup(tx, groupId, { currency: flat.currency, actorId, allowClosed: true });
      // The square-up payments were worked out from these balances: if anything moved since (an expense or payment that
      // landed meanwhile), they would be wrong, so nothing is recorded and the person looks again.
      const netNow = (await ledgerInTx(tx, groupId)).net;
      // (Someone who joined meanwhile with nothing owed either way is not a change.)
      const sig = (n: Record<string, number>) => JSON.stringify(Object.entries(n).filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b)));
      if (sig(netNow) !== sig(netBefore)) throw new Error("BALANCES_CHANGED");
      // A note involving the leaver was made meanwhile: sort that out first (it would otherwise be closed silently).
      if (await waitingNoteFor(tx, groupId, leaver.id)) throw new Error("WAITING_NOTE");
      // Someone who left earlier may only end with the balance they had, or 0: what this move-out changes (the re-split, the daily
      // charges, and the payments that are recorded now, not the notes) must not move theirs.
      const stuck = await leaverBalanceBreaks(tx, groupId, flat.members.filter((m) => m.id !== leaver.id).map((m) => m.id), (l) => ({
        expenses: [
          ...l.expenses.map((e) => {
            const r = p.resplit.find((x) => x.e.id === e.id);
            return r ? { ...e, shares: r.shares } : e;
          }),
          ...charges.map((c, i) => ({ id: `move-out-charge-${i}`, paidById: c.payerId, amount: c.d.amount, shares: [{ memberId: leaver.id, amount: c.d.amount }] })),
        ],
        payments: [...l.payments, ...squareUp.paid.map((t, i) => ({ id: `move-out-payment-${i}`, fromId: t.from, toId: t.to, amount: t.amount }))],
      }));
      if (stuck.length) throw new LeaverBreak(stuck[0], "changed here");
      await claimKey(tx, input.requestKey, "moved", fp);
      // Claim the move-out first: if two people confirm it at the same moment,
      // only the first one goes through (the second finds them already gone).
      const claimed = await tx.member.updateMany({ where: { id: leaver.id, leftAt: null }, data: { leftAt: new Date(`${input.lastDay}T12:00:00Z`) } });
      if (claimed.count !== 1) throw new Error("ALREADY_MOVED");
      // The bills as they are now: an edit made meanwhile isn't overwritten.
      for (const r of p.resplit) {
        const now2 = await tx.expense.findUnique({ where: { id: r.e.id }, select: { amount: true, deletedAt: true, shares: { select: { memberId: true, amount: true } } } });
        const sharesOf = (xs: { memberId: string; amount: number }[]) => xs.map((x) => `${x.memberId}:${x.amount}`).sort().join("|");
        if (!now2 || now2.deletedAt || now2.amount !== r.e.amount || sharesOf(now2.shares) !== sharesOf(r.e.shares)) throw new Error("BILLS_CHANGED");
      }
      // What this move-out did to the money, kept on the move-out's line so Undo can take all of it back (see undoMoveOut).
      const undoInfo: MoveOutUndo = { bills: [] };
      const moneyInfo: NonNullable<MoveOutUndo["money"]> = { currency: flat.currency, shares: [], payments: [], eventIds: [] };
      const plainShares = (xs: { memberId: string; amount: number }[]) => xs.map((x) => ({ memberId: x.memberId, amount: x.amount }));
      // 1. Bills: their share only for the days they stayed (none for later months).
      for (const r of p.resplit) {
        // Undoing the move-out puts the shares back exactly as they were (saved in `money` on the move-out's line) and leaves the bill's item lines as they are.
        // (This line's own "undo" is never offered: it belongs to the move-out and is marked undone with it.)
        const items = await tx.expenseItem.findMany({ where: { expenseId: r.e.id }, orderBy: [{ position: "asc" }, { id: "asc" }] });
        await tx.expenseShare.deleteMany({ where: { expenseId: r.e.id } });
        await tx.expense.update({ where: { id: r.e.id }, data: { splitType: "exact", forMode: "selected", editedAt: new Date(), shares: { create: r.shares.map((s) => ({ memberId: s.memberId, amount: s.amount })) } } });
        moneyInfo.shares.push({ expenseId: r.e.id, amount: r.e.amount, splitType: r.e.splitType, forMode: r.e.forMode, before: plainShares(r.e.shares), after: plainShares(r.shares) });
        const changedId = await logEvent(tx, {
          groupId,
          actorId,
          kind: "expense_edited",
          text: `changed ${r.e.description}`,
          details: [`${leaver.name}’s share: ${money(r.e.shares.find((s) => s.memberId === leaver.id)?.amount ?? 0)} → ${money(r.shares.find((s) => s.memberId === leaver.id)?.amount ?? 0)} (moved out ${niceDate(input.lastDay)})`],
          expenseId: r.e.id,
          undo: { type: "expense_revert", expenseId: r.e.id, before: expenseState({ ...r.e, items }) },
          touches: touchedByExpense(r.e, { ...r.e, shares: r.shares }),
        });
        moneyInfo.eventIds.push(changedId);
      }
      // 1b. Their share of this month's daily bills, for the days they were there: an expense with only them
      // in it, written down on the bill so the month-end bill takes it off. The month must still be open.
      for (const c of charges) {
        const run = await tx.billRun.findUnique({ where: { billId_period: { billId: c.bill.id, period: c.period } }, select: { status: true } });
        if (run && run.status !== "waiting") throw new Error("BILLS_CHANGED");
        const label = `${c.bill.name} · ${stayLabel(input.lastDay, leaver.joinedFrom)} (${leaver.name}’s share)`;
        const made = await tx.expense.create({
          data: {
            groupId,
            description: label,
            notes: `${c.d.days} days × ${money(c.bill.amount)}`,
            amount: c.d.amount,
            splitType: "exact",
            forMode: "selected",
            category: c.bill.category,
            paidById: c.payerId,
            originalAmount: c.d.amount,
            originalCurrency: flat.currency,
            baseCurrency: flat.currency,
            convertedAmount: c.d.amount,
            createdById: actorId,
            spentAt: new Date(`${input.lastDay}T12:00:00Z`),
            shares: { create: [{ memberId: leaver.id, amount: c.d.amount }] },
          },
        });
        const fresh = await tx.bill.findUnique({ where: { id: c.bill.id }, select: { prepaid: true } });
        await tx.bill.update({ where: { id: c.bill.id }, data: { prepaid: addPrepaid(fresh?.prepaid ?? "{}", c.period, { m: leaver.id, a: c.d.amount, e: made.id, d: input.lastDay }) } });
        (undoInfo.prepaid ??= []).push({ billId: c.bill.id, period: c.period, expenseId: made.id });
        const chargeEventId = await logEvent(tx, {
          groupId,
          actorId,
          kind: "expense_added",
          text: `added ${label} (${money(c.d.amount)})`,
          details: [`Paid by ${name(c.payerId)}`, `Moved out ${niceDate(input.lastDay)}; the rest of the month is shared by the others`],
          expenseId: made.id,
        });
        moneyInfo.eventIds.push(chargeEventId);
      }
      // 2. Square up. A payment the person making it records for themselves, to someone who can confirm it, is an "I've paid" note:
      // it counts only when the person paid taps Confirm received (so nobody can be marked as paid up on their own word).
      for (const t of squareUp.claims) {
        const claim = await tx.paymentClaim
          .create({ data: { groupId, fromId: t.from, toId: t.to, amount: t.amount, currency: flat.currency, source: "move_out", status: "waiting", slot: "" } })
          .catch((e: unknown) => {
            // The unique rule: another note for this pair appeared at the same moment.
            throw (e as { code?: string })?.code === "P2002" ? new Error("WAITING_NOTE") : e;
          });
        madeClaims.push({ id: claim.id, t });
        (undoInfo.claims ??= []).push({ id: claim.id, fromId: t.from, toId: t.to, amount: t.amount });
        const claimEventId = await logEvent(tx, {
          groupId,
          actorId,
          kind: "payment_claimed",
          text: `says they paid ${name(t.to)} ${money(t.amount)} (waiting for ${name(t.to)} to confirm)`,
          paymentId: claimRef(claim.id), // names its claim, as every "I've paid" line does
          touches: [], // no balance moves until it's confirmed
        });
        moneyInfo.eventIds.push(claimEventId);
      }
      for (const t of squareUp.paid) {
        const pay = await createPayment(tx, { groupId, fromId: t.from, toId: t.to, amount: t.amount, createdById: actorId });
        moneyInfo.payments.push({ id: pay.id, fromId: t.from, toId: t.to, amount: t.amount });
        const payEventId = await logEvent(tx, {
          groupId,
          actorId,
          kind: "payment_recorded",
          text: `recorded ${name(t.from)} paid ${name(t.to)} ${money(t.amount)}`,
          paymentId: pay.id,
          undo: { type: "payment_delete", paymentId: pay.id },
        });
        moneyInfo.eventIds.push(payEventId);
      }
      // 3. Their deposit: handed to whoever moves in, or kept on record until the lease ends.
      const dep = flat.deposit?.shares.find((s) => s.memberId === leaver.id && s.status === "held");
      if (dep && depositTo) {
        // Claim their share inside this step, exactly as it was read: if a second move-out (or a return) got there first,
        // this one is refused and nothing is handed on twice.
        const claimedDep = await tx.depositShare.updateMany({ where: { id: dep.id, status: "held", amount: dep.amount }, data: { status: "transferred", toMemberId: depositTo, updatedAt: new Date() } });
        if (claimedDep.count !== 1) throw new Error("DEPOSIT_CHANGED");
        // The new holder's share is read again here (another move-out may have just added to it), and must be held.
        const existing = await tx.depositShare.findUnique({ where: { depositId_memberId: { depositId: flat.deposit!.id, memberId: depositTo } } });
        if (existing && existing.status !== "held") throw new Error("DEPOSIT_CHANGED");
        if (existing) {
          const amount = existing.amount + dep.amount;
          const bumped = await tx.depositShare.updateMany({ where: { id: existing.id, status: "held", amount: existing.amount }, data: { amount, updatedAt: new Date() } });
          if (bumped.count !== 1) throw new Error("DEPOSIT_CHANGED");
          undoInfo.deposit = { leaverShareId: dep.id, receiverShareId: existing.id, created: false, receiverBefore: { amount: existing.amount, status: existing.status }, receiverAfter: { amount, status: "held" } };
        } else {
          // (A second move-out created their share a moment ago: that is a change, not a repeated request.)
          const made = await tx.depositShare.create({ data: { depositId: flat.deposit!.id, memberId: depositTo, amount: dep.amount } }).catch((e: unknown) => {
            throw (e as { code?: string })?.code === "P2002" ? new Error("DEPOSIT_CHANGED") : e;
          });
          undoInfo.deposit = { leaverShareId: dep.id, receiverShareId: made.id, created: true, receiverBefore: { amount: 0, status: "held" }, receiverAfter: { amount: dep.amount, status: "held" } };
        }
      }
      // 4. Bills they paid go to someone still here; they leave any rotation.
      const bills2 = await tx.bill.findMany({ where: { groupId, deletedAt: null } });
      for (const b of bills2) {
        let rotation: string[] = [];
        try {
          rotation = JSON.parse(b.rotation);
        } catch {
          rotation = [];
        }
        let split: { mode: string; ids?: string[]; pct?: Record<string, number>; amt?: Record<string, number> } = { mode: "group" };
        try {
          split = JSON.parse(b.split);
        } catch {
          split = { mode: "group" };
        }
        const data: { payer?: string; rotation?: string; split?: string } = {};
        if (b.payer === leaver.id) data.payer = heir;
        if (rotation.includes(leaver.id)) data.rotation = JSON.stringify(rotation.filter((x) => x !== leaver.id));
        if (split.ids?.includes(leaver.id)) data.split = JSON.stringify({ ...split, ids: split.ids.filter((x) => x !== leaver.id) });
        // Their percentage or fixed amount can't just vanish: back to the flat's own split.
        if ((split.mode === "percent" && split.pct?.[leaver.id]) || (split.mode === "amounts" && split.amt?.[leaver.id])) data.split = JSON.stringify({ mode: "group" });
        if (Object.keys(data).length) {
          await tx.bill.update({ where: { id: b.id }, data });
          undoInfo.bills.push({ id: b.id, before: { payer: b.payer, rotation: b.rotation, split: b.split }, after: { payer: data.payer ?? b.payer, rotation: data.rotation ?? b.rotation, split: data.split ?? b.split } });
        }
      }
      // 5. Moved out (set at the start, when it was claimed).
      undoInfo.money = moneyInfo;
      return logEvent(tx, {
        groupId,
        actorId,
        kind: "member_left",
        text: actorId === leaver.id ? `moved out (last day ${niceDate(input.lastDay)})` : `marked ${leaver.name} as moved out (last day ${niceDate(input.lastDay)})`,
        details: [
          ...(p.credit ? [`${money(p.credit)} of bills after they left moved to the others`] : []),
          ...squareUp.claims.map((t) => `${name(t.from)} says they paid ${name(t.to)} ${money(t.amount)} (waiting for ${name(t.to)} to confirm)`),
          ...squareUp.paid.map((t) => `${name(t.from)} paid ${name(t.to)} ${money(t.amount)}`),
          ...charges.map((c) => `${c.bill.name}: ${leaver.name}’s share for ${c.d.days} days, ${money(c.d.amount)}, charged now`),
          ...(dep && depositTo ? [`Deposit ${money(dep.amount)} taken over by ${name(depositTo)}`] : []),
        ],
        undo: { type: "member_set", memberId: leaver.id, data: { leftAt: null }, moveOut: undoInfo },
      });
    }, { timeout: 15000 });
  } catch (err) {
    if (isDuplicateKey(err)) return { ok: true, payments: [] };
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("ALREADY_MOVED")) return { ok: false, error: `${leaver.name} has already moved out.` };
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    if (err instanceof LeaverBreak) return { ok: false, error: err.message };
    if (msg.includes("WAITING_NOTE")) return { ok: false, error: MOVE_OUT_WAITING_NOTE };
    if (msg.includes("BALANCES_CHANGED")) return { ok: false, error: "Balances just changed. Check the move-out again." };
    if (msg.includes("BILLS_CHANGED")) return { ok: false, error: "A bill changed just now. Check it and try again." };
    if (msg.includes("DEPOSIT_CHANGED")) return { ok: false, error: "The deposit changed just now. Check it and try again." };
    throw err;
  }
  // The person paid is told, for each note (after the move-out is saved).
  for (const c of madeClaims) {
    tellReceiver({ claimId: c.id, groupId, groupName: flat.name, toId: c.t.to, fromName: name(c.t.from), amountText: money(c.t.amount), fromId: c.t.from });
  }
  return { ok: true, payments: p.payments, claims: squareUp.claims, eventId };
}

// The deposit: who put in what. Never part of balances.
export async function saveDepositFor(groupId: string, actorId: string, input: { heldBy: string; amounts: Record<string, string> }): Promise<{ ok: true } | Fail> {
  const flat = await loadFlat(groupId);
  if (!flat || flat.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (flat.type === "direct") return { ok: false, error: "This is just between two people, so it has none of these extras." };
  if (!flat.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can do this." };
  const rows: { memberId: string; amount: number }[] = [];
  for (const [memberId, raw] of Object.entries(input.amounts)) {
    if (!flat.members.some((m) => m.id === memberId)) continue;
    if (!raw.trim()) continue;
    const amount = parseAmount(raw, flat.currency);
    if (amount === null || amount < 0) return { ok: false, error: "Enter each amount as a number, like 36000." };
    if (amount > 0) rows.push({ memberId, amount });
  }
  const heldBy = input.heldBy.trim().slice(0, 40) || "Landlord";
  try {
    await db.$transaction(async (tx) => {
      const dep = await tx.deposit.upsert({ where: { groupId }, create: { groupId, heldBy }, update: { heldBy } });
      // Only the shares still held can be edited; returned/transferred ones are history. A form opened before a
      // deposit was returned or handed on must not bring it back to life: it is refused instead.
      for (const r of rows) {
        const cur = await tx.depositShare.findUnique({ where: { depositId_memberId: { depositId: dep.id, memberId: r.memberId } } });
        if (cur && cur.status !== "held") throw new Error("DEPOSIT_CHANGED");
      }
      // A cleared box removes that person's held share, but only for people who are in the flat now (the form only has boxes
      // for them). Someone who moved out and kept their deposit on record has no box: their share is never touched.
      const inFlat = flat.members.filter((m) => !m.leftAt && !rows.some((r) => r.memberId === m.id)).map((m) => m.id);
      if (inFlat.length) await tx.depositShare.deleteMany({ where: { depositId: dep.id, status: "held", memberId: { in: inFlat } } });
      for (const r of rows) {
        const cur = await tx.depositShare.findUnique({ where: { depositId_memberId: { depositId: dep.id, memberId: r.memberId } } });
        if (!cur) {
          await tx.depositShare.create({ data: { depositId: dep.id, memberId: r.memberId, amount: r.amount } });
        } else {
          const done = await tx.depositShare.updateMany({ where: { id: cur.id, status: "held" }, data: { amount: r.amount, updatedAt: new Date() } });
          if (done.count !== 1) throw new Error("DEPOSIT_CHANGED");
        }
      }
      // The total still held after this save: everyone's held share, including a leaver's that stays on record.
      const stillHeld = (await tx.depositShare.aggregate({ where: { depositId: dep.id, status: "held" }, _sum: { amount: true } }))._sum.amount ?? 0;
      await logEvent(tx, {
        groupId,
        actorId,
        kind: "bill_changed",
        text: `updated the deposit with ${heldBy} (${formatMoney(stillHeld, flat.currency)})`,
        details: rows.map((r) => `${flat.members.find((m) => m.id === r.memberId)?.name}: ${formatMoney(r.amount, flat.currency)}`),
      });
    });
  } catch (err) {
    if (String((err as Error)?.message ?? err).includes("DEPOSIT_CHANGED")) return { ok: false, error: "That deposit was already returned or handed on, so it can’t be changed here. Open Deposit again to see where it stands." };
    throw err;
  }
  return { ok: true };
}

// Lease over: the deposit comes back, less deductions shared the group's way.
export async function returnDepositFor(groupId: string, actorId: string, deductionsText: string): Promise<{ ok: true } | Fail> {
  const flat = await loadFlat(groupId);
  if (!flat || flat.deletedAt || !flat.deposit) return { ok: false, error: "There’s no deposit on record." };
  if (!flat.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can do this." };
  const deductions = deductionsText.trim() ? parseAmount(deductionsText, flat.currency) : 0;
  if (deductions === null || deductions < 0) return { ok: false, error: "Enter the deductions as a number, like 8000." };
  const held = flat.deposit.shares.filter((s) => s.status === "held");
  if (!held.length) return { ok: false, error: "Nothing is held any more." };
  const heldTotal = held.reduce((x, h) => x + h.amount, 0);
  if (deductions > heldTotal) return { ok: false, error: `The deductions are more than the deposit held (${formatMoney(heldTotal, flat.currency)}). Check the amount.` };
  const weights = Object.fromEntries(flat.members.map((m) => [m.id, m.splitWeight]));
  const refunds = depositRefunds(held, deductions, weights);
  try {
    await db.$transaction(async (tx) => {
      for (const h of held) {
        const back = refunds.find((r) => r.memberId === h.memberId)?.refund ?? 0;
        // Only a share still held as it was read: if a move-out (or its undo)
        // changed it at the same moment, nothing is returned twice.
        const done = await tx.depositShare.updateMany({ where: { id: h.id, status: "held", amount: h.amount }, data: { status: "returned", returnedAmount: back, updatedAt: new Date() } });
        if (done.count !== 1) throw new Error("DEPOSIT_CHANGED");
      }
      const still = await tx.depositShare.count({ where: { depositId: flat.deposit!.id, status: "held" } });
      if (still) throw new Error("DEPOSIT_CHANGED");
      await logEvent(tx, {
        groupId,
        actorId,
        kind: "bill_changed",
        text: `marked the deposit as returned${deductions ? ` (${formatMoney(deductions, flat.currency)} deducted)` : ""}`,
        details: refunds.map((r) => `${flat.members.find((m) => m.id === r.memberId)?.name} gets back ${formatMoney(r.refund, flat.currency)}`),
      });
    });
  } catch (err) {
    if (String((err as Error)?.message ?? err).includes("DEPOSIT_CHANGED")) return { ok: false, error: "The deposit changed just now. Check it and try again." };
    throw err;
  }
  return { ok: true };
}

// Why a move-out can't be undone right now, read from the database without writing anything (null = nothing in the way).
// `text` is what people in the flat are told; `leaver` is what the person who moved out is told: it never names anyone else.
// undoMoveOut asks this inside its transaction before any write (and throws to roll back); the screens ask it with `db`, so the
// Undo my move-out button is only shown when these checks pass. Keep every check exactly as strict as the money it protects.
export type MoveOutBlock = { text: string; leaver: string };
export const MOVE_OUT_LEAVER_FIXABLE = "Something the move-out changed was changed again since, so it can’t be undone. Ask someone in the flat to undo that change first.";
export const MOVE_OUT_GONE_FOR_GOOD = "This move-out can’t be undone any more.";

type Client = Prisma.TransactionClient;

async function checkMoveOut(client: Client, groupId: string, memberId: string, info: MoveOutUndo) {
  const touched = new Set<string>();
  const described = new Map<string, string>();
  const stop = (text: string, leaver = MOVE_OUT_LEAVER_FIXABLE): { block: MoveOutBlock; touched: Set<string>; described: Map<string, string> } => ({ block: { text, leaver }, touched, described });
  const mo = info.money;
  const g = await client.group.findUnique({ where: { id: groupId }, select: { currency: true } });
  if (mo && g && g.currency !== mo.currency) return stop(CURRENCY_SINCE, MOVE_OUT_GONE_FOR_GOOD);
  if (mo) {
    const sig = (xs: { memberId: string; amount: number }[]) => xs.map((x) => `${x.memberId}:${x.amount}`).sort().join("|");
    // Everything the move-out changed must still be exactly as it left it.
    for (const x of mo.shares) {
      const e = await client.expense.findUnique({ where: { id: x.expenseId }, select: { description: true, amount: true, deletedAt: true, shares: { select: { memberId: true, amount: true } } } });
      if (!e || e.deletedAt || e.amount !== x.amount || sig(e.shares) !== sig(x.after)) return stop(`${e?.description ?? "A bill"} was changed after the move-out, so this can’t be undone. Ask someone in the flat to undo that change first.`);
      described.set(x.expenseId, e.description);
      const was = new Map(x.after.map((a) => [a.memberId, a.amount]));
      const will = new Map(x.before.map((b) => [b.memberId, b.amount]));
      for (const id of new Set([...was.keys(), ...will.keys()])) if ((was.get(id) ?? 0) !== (will.get(id) ?? 0)) touched.add(id);
    }
    for (const x of mo.payments) {
      const pay = await client.payment.findUnique({ where: { id: x.id }, select: { fromId: true, toId: true, amount: true, deletedAt: true } });
      if (!pay || pay.deletedAt || pay.fromId !== x.fromId || pay.toId !== x.toId || pay.amount !== x.amount) return stop("The square-up payment was changed after the move-out, so this can’t be undone. Ask someone in the flat to undo that change first.");
      touched.add(x.fromId);
      touched.add(x.toId);
    }
    // A payment someone said they made ("I've paid") was counted in the square-up: taking it off would count that money twice.
    if (mo.payments.length && (await client.paymentClaim.count({ where: { paymentId: { in: mo.payments.map((x) => x.id) }, status: "covered" } })) > 0) {
      return stop("A payment someone said they made (“I’ve paid”) was counted in the move-out’s square-up, so it can’t be undone.", MOVE_OUT_GONE_FOR_GOOD);
    }
  }
  // The daily charges come off too: the person who paid them, and the leaver, change.
  const chargeIds = (info.prepaid ?? []).map((x) => x.expenseId);
  if (chargeIds.length) {
    for (const c of await client.expense.findMany({ where: { id: { in: chargeIds }, groupId, deletedAt: null }, select: { paidById: true } })) {
      touched.add(c.paidById);
      touched.add(memberId);
    }
  }
  // Someone who has left since must not have their balance moved by this: they left square, and only they can come back to change it.
  if (mo) {
    const gone = await leaverBalanceBreaks(client, groupId, [...touched].filter((id) => id !== memberId), (l) => ({
      expenses: l.expenses.filter((e) => !chargeIds.includes(e.id)).map((e) => {
        const x = mo.shares.find((y) => y.expenseId === e.id);
        return x ? { ...e, shares: x.before } : e;
      }),
      payments: l.payments.filter((p) => !mo.payments.some((x) => x.id === p.id)),
    }));
    if (gone.length) return stop(`${gone[0]} has left the group since, so the move-out can’t be undone. Ask ${gone[0]} to rejoin first.`);
  }
  if (info.deposit) {
    const d = info.deposit;
    const leaverShare = await client.depositShare.findUnique({ where: { id: d.leaverShareId } });
    const receiver = await client.depositShare.findUnique({ where: { id: d.receiverShareId } });
    if (
      !leaverShare || leaverShare.status !== "transferred" ||
      !receiver || receiver.memberId !== leaverShare.toMemberId || receiver.amount !== d.receiverAfter.amount || receiver.status !== d.receiverAfter.status
    ) return stop("The deposit changed since the move-out (returned or handed on), so this can’t be undone. Change the deposit back first.");
  }
  // The daily-bill shares charged at move-out come off again, unless that month's bill was added since
  // (it was worked out without them: edit it by hand instead).
  for (const x of info.prepaid ?? []) {
    const run = await client.billRun.findUnique({ where: { billId_period: { billId: x.billId, period: x.period } }, select: { status: true } });
    if (run && run.status !== "waiting") {
      const bill = (await client.bill.findUnique({ where: { id: x.billId }, select: { name: true } }))?.name ?? "The bill";
      return { block: { text: `This month’s ${bill} was already added, so the move-out can’t be undone. Edit ${bill} instead.`, leaver: MOVE_OUT_LEAVER_FIXABLE }, touched, described };
    }
  }
  return { block: null as MoveOutBlock | null, touched, described };
}

export async function moveOutUndoBlock(client: Client, groupId: string, memberId: string, info: MoveOutUndo): Promise<MoveOutBlock | null> {
  return (await checkMoveOut(client, groupId, memberId, info)).block;
}

class MoveOutBlocked extends Error {
  constructor(public block: MoveOutBlock) {
    super(block.text);
  }
}

// Undo a move-out: they're back in the flat, and everything the move-out did goes back as it was: the bills they paid or took
// turns on, the deposit they handed over, their share of the bills (each back to the exact shares it had), the square-up payments
// (taken off) and the daily charge. A bill's settings changed since keep their newer settings; a deposit, a bill share or a
// square-up payment changed since (returned, handed on, edited, deleted) blocks the undo, so money is never put in two places.
// Everything is one transaction: a refused undo changes nothing (every refusal below throws, which rolls it all back).
// A move-out saved before `money` was kept that did move money is refused earlier (historyCheck in undo.ts).
export async function undoMoveOut(groupId: string, actorId: string, memberId: string, info: MoveOutUndo, mark?: UndoMark, opts: { recordedBy?: string; recordedAt?: Date; now?: Date } = {}): Promise<{ ok: true; eventId: string } | Fail> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (group.type === "direct") return { ok: false, error: PAIR_NO_MOVE_OUT };
  const m = group.members.find((x) => x.id === memberId);
  if (!m) return { ok: false, error: "That person is no longer in the group." };
  if (!m.leftAt) return { ok: false, error: `${m.name} is already back in the flat.` };
  // Only they can undo their own move-out (someone with an account is never put back without their say; the admin invites them back),
  // or whoever recorded it, for 10 minutes (put-back.ts).
  const recorder = opts.recordedBy === actorId && opts.recordedAt && putBackOpen(opts.recordedAt, opts.now);
  if (m.accountId && memberId !== actorId && !recorder) {
    return { ok: false, error: opts.recordedBy === actorId ? lateMoveText(m.name) : `Only ${m.name} can undo moving out. You can invite them back from People.` };
  }
  // The admin removed them since: they don't undo their way back in.
  if (m.removedAt) return { ok: false, error: `${m.name} was removed from the group, so the move-out can’t be undone.` };
  // The amounts were saved in one currency: after a currency change they can't be put back.
  if (info.money && group.currency !== info.money.currency) return { ok: false, error: group.members.find((x) => x.id === actorId)?.leftAt ? MOVE_OUT_GONE_FOR_GOOD : CURRENCY_SINCE };
  const money = (n: number) => formatMoney(n, group.currency);
  const nameOf = (id: string) => group.members.find((x) => x.id === id)?.name ?? "Someone";
  try {
    const eventId = await db.$transaction(async (tx) => {
      // First: the flat is open, in the same currency, and this person still in it (a closed flat is changed by reopening it first).
      // (Someone undoing their OWN move-out has, of course, left: the check that the person acting is still in the flat is for everyone else.)
      await guardGroup(tx, groupId, { currency: group.currency, ...(actorId === memberId ? {} : { actorId }) });
      await markUndone(tx, mark); // this undo is marked in the same transaction as the reversal
      const at = new Date();
      const mo = info.money;
      // Everything that could stand in the way, read first (before any write): a refusal throws and rolls the whole undo back.
      const { block, touched, described } = await checkMoveOut(tx, groupId, memberId, info);
      if (block) throw new MoveOutBlocked(block);
      if (info.deposit) {
        const d = info.deposit;
        const leaverShare = (await tx.depositShare.findUnique({ where: { id: d.leaverShareId } }))!;
        const receiver = (await tx.depositShare.findUnique({ where: { id: d.receiverShareId } }))!;
        await tx.depositShare.update({ where: { id: leaverShare.id }, data: { status: "held", toMemberId: "", updatedAt: new Date() } });
        if (d.created) await tx.depositShare.delete({ where: { id: receiver.id } });
        else await tx.depositShare.update({ where: { id: receiver.id }, data: { amount: d.receiverBefore.amount, status: d.receiverBefore.status, updatedAt: new Date() } });
      }
      for (const x of info.prepaid ?? []) {
        await tx.expense.updateMany({ where: { id: x.expenseId, deletedAt: null }, data: { deletedAt: new Date(), deletedById: actorId } });
        const fresh = await tx.bill.findUnique({ where: { id: x.billId }, select: { prepaid: true } });
        if (fresh) await tx.bill.update({ where: { id: x.billId }, data: { prepaid: removePrepaid(fresh.prepaid, x.period, x.expenseId) } });
      }
      let kept = 0;
      for (const b of info.bills) {
        const now = await tx.bill.findUnique({ where: { id: b.id }, select: { payer: true, rotation: true, split: true, deletedAt: true } });
        if (!now || now.deletedAt) continue;
        if (now.payer !== b.after.payer || now.rotation !== b.after.rotation || now.split !== b.after.split) {
          kept++;
          continue;
        }
        await tx.bill.update({ where: { id: b.id }, data: b.before });
      }
      const back = await tx.member.updateMany({ where: { id: memberId, leftAt: { not: null }, removedAt: null }, data: { leftAt: null } });
      if (back.count !== 1) throw new Error("ALREADY_BACK");
      // Their share of each bill goes back exactly as it was (and the bill's split type with it); the square-up payments come off;
      // the move-out's own lines in Activity are marked undone with it.
      const lines: string[] = [];
      if (mo) {
        for (const x of mo.shares) {
          await tx.expenseShare.deleteMany({ where: { expenseId: x.expenseId } });
          await tx.expense.update({ where: { id: x.expenseId }, data: { splitType: x.splitType, forMode: x.forMode, editedAt: at, shares: { create: x.before.map((b) => ({ memberId: b.memberId, amount: b.amount })) } } });
          const mine = (xs: { memberId: string; amount: number }[]) => xs.find((y) => y.memberId === memberId)?.amount ?? 0;
          lines.push(`${m.name}’s share: ${money(mine(x.after))} → ${money(mine(x.before))} (${described.get(x.expenseId) ?? "a bill"}, move-out undone)`);
        }
        await tx.payment.updateMany({ where: { id: { in: mo.payments.map((x) => x.id) }, deletedAt: null }, data: { deletedAt: at, deletedById: actorId } });
        for (const x of mo.payments) lines.push(`Taken off: ${nameOf(x.fromId)} paid ${nameOf(x.toId)} ${money(x.amount)}`);
        if (mo.payments.length) lines.push("If any of these payments really happened, record it again.");
        await tx.groupEvent.updateMany({ where: { id: { in: mo.eventIds }, undoneAt: null }, data: { undoneAt: at, undoneById: actorId } });
      }
      // The move-out's "I've paid" notes: one still waiting is taken back (withdrawn, decided by whoever undoes). One already confirmed
      // is real money, so its payment stays and doesn't stand in the way. (One declined, expired or covered has nothing left to take back.)
      for (const x of info.claims ?? []) {
        const done = await tx.paymentClaim.updateMany({ where: { id: x.id, status: "waiting" }, data: { status: "withdrawn", slot: x.id, decidedAt: at, decidedById: actorId } });
        if (done.count === 1) lines.push(`Taken back: ${nameOf(x.fromId)} said they paid ${nameOf(x.toId)} ${money(x.amount)}`);
      }
      return logEvent(tx, {
        groupId,
        actorId,
        kind: "member_rejoined",
        text: `${memberId === actorId ? "moved back in" : `brought ${m.name} back into the flat`} (undo)`,
        details: [
          ...(info.bills.length - kept > 0 ? ["Bills they paid or took turns on are back as they were"] : []),
          ...(kept ? [`${kept} bill${kept === 1 ? "" : "s"} changed since kept the newer settings`] : []),
          ...(info.deposit ? ["Their deposit is back with them"] : []),
          ...((info.prepaid ?? []).length ? ["Their share of the daily bills was taken off again"] : []),
          ...lines,
        ],
        touches: [...touched, memberId],
        // No redo from here: moving out again hands over bills and the deposit,
        // which only the move-out screen does properly.
      });
    });
    return { ok: true, eventId };
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    // Whoever has left (the person undoing their own move-out) is never told who did what, or who left, after them.
    if (err instanceof MoveOutBlocked) return { ok: false, error: group.members.find((x) => x.id === actorId)?.leftAt ? err.block.leaver : err.block.text };
    if (err instanceof GroupChanged) return { ok: false, error: err.reason === "closed" ? "This group is closed. Reopen it to change expenses." : groupChangedText(err) };
    if (msg.includes("ALREADY_BACK")) return { ok: false, error: `${m.name} is already back in the flat.` };
    throw err;
  }
}
