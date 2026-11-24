import { db } from "../db";
import { memberMark } from "../left-view";
import { logEvent, markUndone, expenseState, touchedByExpense, type MoveOutUndo, type UndoMark } from "../events";
import { openGameFor } from "../pot-db";
import { netBalances } from "../balances";
import { formatMoney, parseAmount } from "../money";
import { typedZero } from "../zero-amount";
import { claimKey, fingerprintOf, isDuplicateKey, keyState, STALE_KEY_ERROR } from "../once";
import { niceDate } from "../format";
import { createPayment, PaymentTooBig } from "../payments";
import { addMonths, daysInMonth } from "./month";
import { DEFAULT_TIME_ZONE, dayKey } from "../dates";
import { addPrepaid, dailyPrecharge, depositRefunds, leaverPayments, parsePrepaid, proRataShares, removePrepaid, type DailyPrecharge } from "./moving";
import { monthsBetween, payerFor } from "./bills";
import type { Transfer } from "../settle";
import { GroupChanged, groupChangedText, guardGroup, ledgerInTx, LeaverBreak, leaverBalanceBreaks, leaversOffZero } from "../money-guard";
import { needsOkFor } from "../payment-ok";
import { lateMoveText, putBackOpen } from "../put-back";
import type { Prisma } from "@prisma/client";
import { PAIR_NO_MOVE_OUT } from "../direct-guard";
import { FORM_OUT_OF_DATE } from "../form-currency";

// Moving out, the deposit — database side.

type Fail = { ok: false; error: string };

export const CURRENCY_SINCE = "The group currency changed after the move-out, so it can’t be undone.";
// An "I've paid" note involving the person moving out is still waiting: it would be silently closed by the square-up, so it is sorted out first.
export const MOVE_OUT_WAITING_NOTE = "An older “I’ve paid” is still being sorted. Try again in a few minutes.";
// The payments shown on the page are not what would be recorded now.
export const MOVE_OUT_KEY_CHANGED = "Balances changed since you opened this. Check the move-out again.";
// A closed flat takes no changes to its money: reopen it first.
export const MOVE_OUT_CLOSED = "This flat is closed. Reopen it first, then mark the move-out.";
// Leaving (or being marked as moved out) while still in a game that is open would leave their chips in it.
const inOpenGameText = (game: string, who: string | null) => (who === null ? `You’re still in a game that’s open (${game}). Ask the host to finish it, then leave.` : `${who} is still in a game that’s open (${game}). Finish the game first.`);
class InOpenGame extends Error {}

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
// A bill an earlier move-out of the same person already re-split (and that was not undone) is skipped: someone who was brought back
// and moves out again must not have the same month's share cut a second time (worked out from their kept share, it would shrink again).
async function resplitAlready(groupId: string, memberId: string): Promise<Set<string>> {
  const rows = await db.groupEvent.findMany({ where: { groupId, kind: "member_left", undoneAt: null, undo: { contains: `"memberId":"${memberId}"` } }, select: { undo: true } });
  const done = new Set<string>();
  for (const r of rows) {
    try {
      const u = JSON.parse(r.undo) as { type?: string; memberId?: string; moveOut?: MoveOutUndo };
      if (u.type !== "member_set" || u.memberId !== memberId) continue;
      for (const s of u.moveOut?.money?.shares ?? []) done.add(s.expenseId);
    } catch {
      /* an unreadable line has nothing to skip */
    }
  }
  return done;
}

async function billExpensesFor(flat: Flat, leaverId: string, fromMonth: string) {
  const runs = await db.billRun.findMany({ where: { period: { gte: fromMonth }, status: "added", bill: { groupId: flat.id } }, select: { expenseId: true, period: true } });
  const periodOf = new Map(runs.map((r) => [r.expenseId, r.period]));
  const already = await resplitAlready(flat.id, leaverId);
  return flat.expenses
    .filter((e) => periodOf.has(e.id) && !already.has(e.id) && e.shares.some((s) => s.memberId === leaverId && s.amount > 0))
    .map((e) => ({ e, period: periodOf.get(e.id)! }))
    .sort((a, b) => a.period.localeCompare(b.period) || a.e.description.localeCompare(b.e.description));
}
type BillExpense = Awaited<ReturnType<typeof billExpensesFor>>[number];

// Daily bills (milk, water cans) whose month hasn't been added yet: the leaver's share of the
// days they were there, which would otherwise never reach them (only people still here share the month-end bill).
type DailyOffer = { bill: Awaited<ReturnType<typeof db.bill.findMany>>[number]; period: string; d: DailyPrecharge };
async function dailyOffers(flat: Flat, leaverId: string, lastDay: string): Promise<DailyOffer[]> {
  const period = lastDay.slice(0, 7);
  const bills = await db.bill.findMany({ where: { groupId: flat.id, nature: "daily", deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const runs = await db.billRun.findMany({ where: { period, billId: { in: bills.map((b) => b.id) } }, select: { billId: true, status: true } });
  const members = flat.members.map((m) => ({ id: m.id, splitWeight: m.splitWeight, joinedFrom: m.joinedFrom, leftAt: m.leftAt }));
  const out: DailyOffer[] = [];
  for (const bill of bills) {
    if (period < bill.startMonth || (bill.endMonth && period > bill.endMonth) || monthsBetween(bill.startMonth, period) % Math.max(1, bill.every) !== 0) continue;
    // Already added (the existing re-split handles it), skipped or being added: nothing to charge now.
    const run = runs.find((r) => r.billId === bill.id);
    if (run && run.status !== "waiting") continue;
    // The charges already on the bill this month: someone with a live one is not charged twice (a charge whose expense was deleted is
    // replaced by the new one), and they say up to which day each earlier leaver was there, the same as the month-end bill does.
    const written = parsePrepaid(bill.prepaid)[period] ?? [];
    const alive = new Set((await db.expense.findMany({ where: { id: { in: written.map((x) => x.e) }, deletedAt: null }, select: { id: true } })).map((e) => e.id));
    const live = written.filter((x) => alive.has(x.e));
    if (live.some((x) => x.m === leaverId)) continue;
    const d = dailyPrecharge(bill, period, lastDay, members, leaverId, { live, gone: written.filter((x) => !alive.has(x.e)) });
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

// A move-out charge (an earlier leaver's share of a daily bill's month) that the person now moving out paid, while that month isn't
// added yet: the month-end bill will be credited to the month's payer, so the charge goes to that person now, instead of being left
// with someone who has gone. Worked out from the flat as read (preview and move-out read it the same way).
type Handover = { expenseId: string; to: string; desc: string; amount: number; sharerId: string; billId: string; billName: string; period: string };
async function pendingHandovers(flat: Flat, leaverId: string, othersIds: string[], heir: string): Promise<Handover[] & { adding?: string }> {
  const bills = (await db.bill.findMany({ where: { groupId: flat.id, nature: "daily", deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).filter((b) => b.prepaid && b.prepaid !== "{}");
  if (!bills.length) return [];
  const runs = await db.billRun.findMany({ where: { billId: { in: bills.map((b) => b.id) } }, select: { billId: true, period: true, status: true } });
  const out: Handover[] & { adding?: string } = [];
  for (const bill of bills) {
    for (const [period, list] of Object.entries(parsePrepaid(bill.prepaid)).sort(([a], [b]) => a.localeCompare(b))) {
      const run = runs.find((r) => r.billId === bill.id && r.period === period);
      // A month being added right now is counting these charges: a move-out can't hand them on in the middle of it.
      if (run?.status === "adding" && list.some((x) => flat.expenses.some((y) => y.id === x.e && y.paidById === leaverId && !y.payers))) out.adding ??= `${bill.name} for ${monthName(period)} is being added right now. Try again in a minute.`;
      if (run && run.status !== "waiting") continue;
      for (const x of list) {
        const e = flat.expenses.find((y) => y.id === x.e);
        // (A charge with several payers written on it is left as it is: handing it on would move the other payers' credit too.)
        if (!e || e.paidById !== leaverId || e.payers) continue;
        const to = prechargePayer(bill, period, leaverId, othersIds, heir);
        if (!to || to === leaverId) continue;
        out.push({ expenseId: e.id, to, desc: e.description, amount: e.amount, sharerId: x.m, billId: bill.id, billName: bill.name, period });
      }
    }
  }
  return out;
}

// "1–14 Nov" (or "5–14 Nov" for someone who moved in on the 5th).
function stayLabel(lastDay: string, joinedFrom: Date | null): string {
  const from = joinedFrom && joinedFrom.toISOString().slice(0, 7) === lastDay.slice(0, 7) ? Number(joinedFrom.toISOString().slice(8, 10)) : 1;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(lastDay.slice(5, 7)) - 1] ?? "";
  return `${from}–${Number(lastDay.slice(8, 10))} ${month}`;
}

type Charge = { payerId: string; amount: number };

// Every final payment is recorded as paid straight away, so the person leaves at exactly 0. When the person paid has joined (can tap
// Confirm received / Not received) and is not the one pressing the button, that payment also asks them. "Not received" takes it off
// again and brings the people who left back into the flat (payment-ok.ts). A name nobody has joined can't be asked.
function waitsFor(flat: Flat, actorId: string, t: Transfer): boolean {
  return needsOkFor(flat.members.find((m) => m.id === t.to), actorId);
}

// The final payments as one comparable text: the move-out page posts it, and the move-out refuses if it is not what would be recorded now.
export const transfersKey = (ts: Transfer[]) => ts.map((t) => `${t.from}>${t.to}:${t.amount}`).sort().join("|");

// Older "I've paid" notes still waiting that involve this person (as payer or as the one paid). No screen can answer a note any more, so a
// move-out does not stop for one: it closes it (closeOldNotes) and says so in the history.
async function waitingNotesFor(client: Client, groupId: string, memberId: string) {
  return client.paymentClaim.findMany({ where: { groupId, status: "waiting", OR: [{ fromId: memberId }, { toId: memberId }] }, select: { id: true, fromId: true, amount: true, currency: true } });
}

function plan(flat: Flat, leaverId: string, lastDay: string, bills: BillExpense[], charges: Charge[] = [], handovers: { expenseId: string; to: string }[] = []) {
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
  // A charge handed on is credited to its new payer (and only to them), so the square-up already includes it.
  const handTo = new Map(handovers.map((h) => [h.expenseId, h.to]));
  const after = netBalances(
    ids,
    [
      ...flat.expenses.map((e) => {
        const x = resplit.find((r) => r.e.id === e.id) ? { ...e, shares: resplit.find((r) => r.e.id === e.id)!.shares } : e;
        const to = handTo.get(e.id);
        return to ? { ...x, paidById: to, payers: "" } : x;
      }),
      ...extra,
    ],
    flat.payments,
  );
  return { resplit, credit, before, after, payments: leaverPayments(after, leaverId), daysStayed, monthDays };
}

// The last day: a real date, not in the future, and this month or last. "Today" is the person's own day (their time zone).
// A tampered zone can only move "today" by a day either way.
export function checkDay(lastDay: string, now: Date, tz: string = DEFAULT_TIME_ZONE): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay) || Number.isNaN(new Date(`${lastDay}T12:00:00Z`).getTime())) return "Pick the last day in the flat.";
  const today = dayKey(now, tz);
  if (lastDay > today) return "The last day can’t be in the future. Do this on the day they move out (or after).";
  if (lastDay.slice(0, 7) < addMonths(today.slice(0, 7), -1)) return "Pick a last day this month or last month.";
  return null;
}

// `actorId`: who is confirming it. They take over the leaver's bills if they are staying, exactly as moveOut does.
export async function moveOutPreview(groupId: string, leaverId: string, lastDay: string, now = new Date(), actorId = "", tz: string = DEFAULT_TIME_ZONE) {
  const flat = await loadFlat(groupId);
  if (!flat || flat.deletedAt) return { ok: false, error: "This group no longer exists." } as Fail;
  if (flat.type === "direct") return { ok: false, error: PAIR_NO_MOVE_OUT } as Fail;
  if (flat.closed) return { ok: false, error: MOVE_OUT_CLOSED } as Fail;
  if (!flat.members.some((m) => m.id === leaverId && !m.leftAt)) return { ok: false, error: "That person isn’t in the flat." } as Fail;
  const bad = checkDay(lastDay, now, tz);
  if (bad) return { ok: false, error: bad } as Fail;
  const bills = await billExpensesFor(flat, leaverId, lastDay.slice(0, 7));
  const others = flat.members.filter((m) => !m.leftAt && m.id !== leaverId);
  const heir = others.find((m) => m.id === actorId)?.id ?? others[0]?.id ?? "";
  // Charges the person paid for an earlier leaver's daily share: handed to this month's payer (the same in the move-out itself).
  const handovers = await pendingHandovers(flat, leaverId, others.map((m) => m.id), heir);
  if (handovers.adding) return { ok: false, error: handovers.adding } as Fail;
  const p = plan(flat, leaverId, lastDay, bills, [], handovers);
  const dep = flat.deposit?.shares.find((s) => s.memberId === leaverId && s.status === "held") ?? null;
  // Daily bills this month: their share for the days they were there, charged now if they tick "Add it now".
  const offers = await dailyOffers(flat, leaverId, lastDay);
  const charges = offers.filter((o) => !o.d.unsupported).map((o) => ({ payerId: prechargePayer(o.bill, o.period, leaverId, others.map((m) => m.id), heir), amount: o.d.amount }));
  const withDaily = charges.length ? plan(flat, leaverId, lastDay, bills, charges, handovers).payments : p.payments;
  // Which of the final payments ask the person paid to confirm (they can answer, and are not the one confirming this).
  const waitsOf = (ts: Transfer[]) => ts.filter((t) => waitsFor(flat, actorId, t)).map((t) => `${t.from}>${t.to}`);
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
    // What the person was paid for an earlier leaver's daily share that goes to this month's payer: the confirm question says so.
    handovers: handovers.map((h) => ({ desc: h.desc, amount: h.amount, to: h.to, sharerId: h.sharerId, billName: h.billName })),
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
  // `expectDeposit`: the leaver's held deposit the page showed in minor units ("" = none). When given, a move-out whose deposit is different now is refused.
  input: { leaverId: string; lastDay: string; depositTo?: string; addDaily?: boolean; requestKey: string; expectKey?: string; expectDeposit?: string },
  now = new Date(),
  opts: { afterRead?: () => Promise<void>; tz?: string } = {}, // afterRead: tests only, runs after the reads, before the write begins. tz: the person's time zone, for "today"
): Promise<{ ok: true; payments: Transfer[]; eventId?: string } | Fail> {
  const fp = fingerprintOf("move-out", groupId, input.leaverId, input.lastDay, input.depositTo ?? "", input.addDaily ? "daily" : "");
  const ks = await keyState(input.requestKey, fp);
  if (ks.state === "stale") return { ok: false, error: STALE_KEY_ERROR };
  if (ks.state === "done") return { ok: true, payments: [] };
  const flat = await loadFlat(groupId);
  if (!flat || flat.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (flat.type === "direct") return { ok: false, error: PAIR_NO_MOVE_OUT };
  if (flat.closed) return { ok: false, error: MOVE_OUT_CLOSED };
  if (!flat.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can do this." };
  const leaver = flat.members.find((m) => m.id === input.leaverId && !m.leftAt);
  if (!leaver) return { ok: false, error: "That person isn’t in the flat." };
  const bad = checkDay(input.lastDay, now, opts.tz);
  if (bad) return { ok: false, error: bad };
  const others = flat.members.filter((m) => !m.leftAt && m.id !== leaver.id);
  if (!others.length) return { ok: false, error: "Someone has to stay in the flat." };
  // A person picked to take the deposit who is no longer in the flat is refused: the hand-over is never silently dropped.
  if (input.depositTo && !others.some((m) => m.id === input.depositTo)) {
    const gone = flat.members.find((m) => m.id === input.depositTo);
    return { ok: false, error: `${gone?.name ?? "That person"} has moved out, so they can’t take over the deposit. Pick someone else.` };
  }
  const depositTo = input.depositTo ?? "";
  // The deposit this person holds must be exactly the one the page showed.
  if (input.expectDeposit !== undefined) {
    const held = flat.deposit?.shares.find((s) => s.memberId === leaver.id && s.status === "held");
    if (String(held?.amount ?? "") !== input.expectDeposit) return { ok: false, error: depositShownChanged(leaver.name, held?.amount ?? null, flat.currency) };
  }

  const bills = await billExpensesFor(flat, leaver.id, input.lastDay.slice(0, 7));
  const heir = others.find((m) => m.id === actorId)?.id ?? others[0].id;
  // Their share of this month's daily bills, charged now (only if asked: "Add it now").
  const offers = input.addDaily ? (await dailyOffers(flat, leaver.id, input.lastDay)).filter((o) => !o.d.unsupported && o.d.amount > 0) : [];
  const charges = offers.map((o) => ({ ...o, payerId: prechargePayer(o.bill, o.period, leaver.id, others.map((m) => m.id), heir) }));
  const handovers = await pendingHandovers(flat, leaver.id, others.map((m) => m.id), heir);
  if (handovers.adding) return { ok: false, error: handovers.adding };
  const p = plan(flat, leaver.id, input.lastDay, bills, charges.map((c) => ({ payerId: c.payerId, amount: c.d.amount })), handovers);
  const name = (id: string) => flat.members.find((m) => m.id === id)?.name ?? "Someone";
  const money = (n: number) => formatMoney(n, flat.currency);
  if (input.expectKey !== undefined && input.expectKey !== transfersKey(p.payments)) return { ok: false, error: MOVE_OUT_KEY_CHANGED };

  const netBefore = netBalances(flat.members.map((m) => m.id), flat.expenses, flat.payments);
  await opts.afterRead?.();
  let eventId: string;
  try {
    eventId = await db.$transaction(async (tx) => {
      // First: the flat must still be in the currency the amounts were worked out in, and the person doing it still in it.
      await guardGroup(tx, groupId, { currency: flat.currency, actorId });
      // The leaver's held deposit is exactly the one the page showed, whether or not it is being handed over (read again here, in the write).
      if (input.expectDeposit !== undefined) {
        const nowHeld = await tx.depositShare.findFirst({ where: { deposit: { groupId }, memberId: leaver.id, status: "held" }, select: { amount: true } });
        if (String(nowHeld?.amount ?? "") !== input.expectDeposit) throw new DepositShownMoved(nowHeld?.amount ?? null);
      }
      // Someone with money in a game that is still open can't move out: the game's result would be worked out with them gone.
      const game = await openGameFor(tx, groupId, leaver.id);
      if (game) throw new InOpenGame(inOpenGameText(game, actorId === leaver.id ? null : leaver.name));
      // The square-up payments were worked out from these balances: if anything moved since (an expense or payment that
      // landed meanwhile), they would be wrong, so nothing is recorded and the person looks again.
      const netNow = (await ledgerInTx(tx, groupId)).net;
      // (Someone who joined meanwhile with nothing owed either way is not a change.)
      const sig = (n: Record<string, number>) => JSON.stringify(Object.entries(n).filter(([, v]) => v !== 0).sort(([a], [b]) => a.localeCompare(b)));
      if (sig(netNow) !== sig(netBefore)) throw new Error("BALANCES_CHANGED");
      // Someone who left earlier may only end with the balance they had, or 0: what this move-out changes (the re-split, the daily
      // charges, and the final payments) must not move theirs.
      const stuck = await leaverBalanceBreaks(tx, groupId, flat.members.filter((m) => m.id !== leaver.id).map((m) => m.id), (l) => ({
        expenses: [
          ...l.expenses.map((e) => {
            const r = p.resplit.find((x) => x.e.id === e.id);
            const h = handovers.find((x) => x.expenseId === e.id);
            const z = r ? { ...e, shares: r.shares } : e;
            return h ? { ...z, paidById: h.to, payers: "" } : z;
          }),
          ...charges.map((c, i) => ({ id: `move-out-charge-${i}`, paidById: c.payerId, amount: c.d.amount, shares: [{ memberId: leaver.id, amount: c.d.amount }] })),
        ],
        payments: [...l.payments, ...p.payments.map((t, i) => ({ id: `move-out-payment-${i}`, fromId: t.from, toId: t.to, amount: t.amount }))],
      }));
      if (stuck.length) throw new LeaverBreak(stuck[0], "changed here");
      await claimKey(tx, input.requestKey, "moved", fp);
      // An older "I've paid" note that is still waiting (one the conversion could not convert, or that was put back to waiting) is closed
      // as "expired", with a line saying so, in this same transaction. It never counted, so the square-up payments are unaffected.
      for (const n of await waitingNotesFor(tx, groupId, leaver.id)) {
        const closed = await tx.paymentClaim.updateMany({ where: { id: n.id, status: "waiting" }, data: { status: "expired", slot: n.id, decidedAt: new Date(), decidedById: actorId } });
        if (closed.count !== 1) continue;
        await logEvent(tx, { groupId, actorId, kind: "payment_note_closed", text: `${name(n.fromId)}’s older “I’ve paid ${formatMoney(n.amount, n.currency)}” was closed by the move-out. Record it again if it was paid.`, touches: [] });
      }
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
        // The share was worked out from the bill's price, days it didn't come, kind and split as read: a change to any of them meanwhile refuses it.
        const fresh = await tx.bill.findUnique({ where: { id: c.bill.id }, select: { prepaid: true, missed: true, amount: true, split: true, nature: true, deletedAt: true, paused: true, pausedAt: true, endMonth: true } });
        // (A pause or stop meanwhile changes which days count, so it refuses too.)
        if (!fresh || fresh.deletedAt || fresh.missed !== c.bill.missed || fresh.amount !== c.bill.amount || fresh.split !== c.bill.split || fresh.nature !== c.bill.nature || fresh.paused !== c.bill.paused || fresh.pausedAt?.getTime() !== c.bill.pausedAt?.getTime() || fresh.endMonth !== c.bill.endMonth) throw new Error("BILLS_CHANGED");
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
        // An older charge of theirs whose expense was deleted is replaced; one that still stands means this is not needed any more.
        const older = (parsePrepaid(fresh.prepaid)[c.period] ?? []).filter((x) => x.m === leaver.id);
        const standing = new Set((await tx.expense.findMany({ where: { id: { in: older.map((x) => x.e) }, deletedAt: null }, select: { id: true } })).map((e) => e.id));
        if (older.some((x) => standing.has(x.e))) throw new Error("BILLS_CHANGED");
        let written = fresh.prepaid;
        for (const x of older) written = removePrepaid(written, c.period, x.e);
        await tx.bill.update({ where: { id: c.bill.id }, data: { prepaid: addPrepaid(written, c.period, { m: leaver.id, a: c.d.amount, e: made.id, d: input.lastDay }) } });
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
      // 1c. Charges the leaver paid for an earlier leaver's daily share (month not added yet): handed to this month's payer, so the
      // month-end bill's credit and the charge's credit land on the same person. Read again here: any change meanwhile refuses it.
      for (const h of handovers) {
        const live = await tx.expense.findUnique({ where: { id: h.expenseId }, select: { deletedAt: true, paidById: true, payers: true } });
        if (!live || live.deletedAt || live.paidById !== leaver.id || live.payers) throw new Error("BILLS_CHANGED");
        const run = await tx.billRun.findUnique({ where: { billId_period: { billId: h.billId, period: h.period } }, select: { status: true } });
        if (run && run.status !== "waiting") throw new Error("BILLS_CHANGED");
        await tx.expense.update({ where: { id: h.expenseId }, data: { paidById: h.to, payers: "" } });
        (undoInfo.chargePayers ??= []).push({ expenseId: h.expenseId, before: leaver.id, after: h.to, billId: h.billId, period: h.period });
        const handEventId = await logEvent(tx, {
          groupId,
          actorId,
          kind: "expense_edited",
          text: `${name(h.to)} now paid ${h.desc}`,
          details: [`Paid by ${name(h.to)} (was ${leaver.name}, who moved out)`],
          expenseId: h.expenseId,
          touches: [leaver.id, h.to],
        });
        moneyInfo.eventIds.push(handEventId);
      }
      // 2. Square up: every final payment is recorded as paid now, so they leave at exactly 0. A person paid who can answer (and isn't
      // the one doing this) is also asked "Confirm received / Not received"; "Not received" brings the people who left back (payment-ok.ts).
      for (const t of p.payments) {
        const pay = await createPayment(tx, { groupId, fromId: t.from, toId: t.to, amount: t.amount, createdById: actorId, asksReceiver: waitsFor(flat, actorId, t) || undefined });
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
        // The person taking it over must still be in the flat (checked again inside the write).
        if ((await tx.member.count({ where: { id: depositTo, groupId, leftAt: null } })) !== 1) throw new Error("DEPOSIT_RECIPIENT_GONE");
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
      // 5. Moved out (set at the start, when it was claimed). They must end at exactly 0: otherwise nothing is saved.
      if (((await ledgerInTx(tx, groupId)).net[leaver.id] ?? 0) !== 0 || (await leaversOffZero(tx, groupId, [leaver.id])).length) throw new Error("NOT_SQUARE");
      undoInfo.money = moneyInfo;
      return logEvent(tx, {
        groupId,
        actorId,
        kind: "member_left",
        text: actorId === leaver.id ? `moved out (last day ${niceDate(input.lastDay)})` : `marked ${leaver.name} as moved out (last day ${niceDate(input.lastDay)})`,
        details: [
          ...(p.credit ? [`${money(p.credit)} of bills after they left moved to the others`] : []),
          ...p.payments.map((t) => `${name(t.from)} paid ${name(t.to)} ${money(t.amount)}${waitsFor(flat, actorId, t) ? ` (${name(t.to)} is asked to confirm)` : ""}`),
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
    if (err instanceof LeaverBreak || err instanceof InOpenGame || err instanceof PaymentTooBig) return { ok: false, error: err.message };
    if (msg.includes("BALANCES_CHANGED") || msg.includes("NOT_SQUARE")) return { ok: false, error: "Balances just changed. Check the move-out again." };
    if (msg.includes("BILLS_CHANGED")) return { ok: false, error: "A bill changed just now. Check it and try again." };
    if (msg.includes("DEPOSIT_CHANGED")) return { ok: false, error: "The deposit changed just now. Check it and try again." };
    if (err instanceof DepositShownMoved) return { ok: false, error: depositShownChanged(leaver.name, err.amount, flat.currency) };
    if (msg.includes("DEPOSIT_RECIPIENT_GONE")) return { ok: false, error: `${name(depositTo)} has moved out, so they can’t take over the deposit. Pick someone else.` };
    throw err;
  }
  return { ok: true, payments: p.payments, eventId };
}

function depositShownChanged(who: string, amount: number | null, currency: string): string {
  return amount === null ? `${who}’s deposit changed since you opened this page, so nothing was saved.` : `${who}’s deposit changed to ${formatMoney(amount, currency)} since you opened this page, so nothing was saved.`;
}
class DepositShownMoved extends Error {
  constructor(public amount: number | null) {
    super("DEPOSIT_SHOWN_MOVED");
  }
}

export const LEAVER_DEPOSIT_ERROR = "That person has moved out, so their deposit can’t be changed here.";

// The moving-in date of someone in a flat (bills that month are shared from that day). "" clears it. Everything is checked here and
// again inside the write: a flat only, open, the person doing it and the person both still in it, a real date that isn't absurd.
// `undoing`: the date is put back as it was (the range check is skipped, as the old date was fine when it was saved).
export async function setMoveInFor(
  groupId: string,
  actorId: string,
  memberId: string,
  day: string,
  now = new Date(),
  opts: { mark?: UndoMark; undoing?: boolean; afterRead?: () => Promise<void> } = {}, // afterRead: tests only
): Promise<{ ok: true; eventId?: string } | Fail> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (group.type !== "home") return { ok: false, error: "Moving-in dates are only for flats." };
  if (group.closed) return { ok: false, error: "This group is closed. Reopen it first." };
  if (!group.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can do this." };
  const member = group.members.find((m) => m.id === memberId);
  if (!member) return { ok: false, error: "That person isn’t in the flat." };
  if (member.leftAt) return { ok: false, error: `${member.name} has left the flat, so their moving-in date can’t change.` };
  let date: Date | null = null;
  if (day !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "That date isn’t valid." };
    const parsed = new Date(`${day}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return { ok: false, error: "That date isn’t valid." };
    if (!opts.undoing) {
      const nextMonth = addMonths(dayKey(now, DEFAULT_TIME_ZONE).slice(0, 7), 1);
      if (day < "2000-01-01") return { ok: false, error: "That date isn’t valid." };
      if (day > `${nextMonth}-${String(daysInMonth(nextMonth)).padStart(2, "0")}`) return { ok: false, error: "The moving-in date can’t be later than the end of next month." };
    }
    date = parsed;
  }
  const same = (member.joinedFrom?.getTime() ?? null) === (date?.getTime() ?? null);
  if (same && !opts.undoing) return { ok: true };
  await opts.afterRead?.();
  const tag = opts.undoing ? " (undo)" : "";
  try {
    const eventId = await db.$transaction(async (tx) => {
      await guardGroup(tx, groupId, { currency: group.currency, actorId });
      await markUndone(tx, opts.mark);
      // Only if the person is still here with the date as it was read: two people changing it at once change it once.
      const claimed = await tx.member.updateMany({ where: { id: memberId, groupId, leftAt: null, joinedFrom: member.joinedFrom }, data: { joinedFrom: date } });
      if (claimed.count !== 1) throw new Error("MEMBER_CHANGED");
      return logEvent(tx, {
        groupId,
        actorId,
        kind: "bill_changed",
        text: date ? `noted ${member.name} moved in on ${niceDate(day)}${tag}` : `cleared ${member.name}’s moving-in date${tag}`,
        details: date ? ["Bills that month are shared from that day"] : [],
        undo: { type: "move_in_set", memberId, joinedFrom: member.joinedFrom ? member.joinedFrom.toISOString() : null },
        touches: [],
      });
    });
    return { ok: true, eventId };
  } catch (err) {
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    if (String((err as Error)?.message ?? err).includes("MEMBER_CHANGED")) return { ok: false, error: `${member.name} changed just now. Look again and try again.` };
    throw err;
  }
}

// The deposit: who put in what. Never part of balances.
// `versions` (the form's hidden v_<memberId>, see depositVersion) says what each box showed when the page was drawn: only a box the person
// changed is written, and only if that person's share is still exactly as shown; a box not in the form is never touched.
// `currency` is the one the page was drawn in: the write refuses if the group's currency changed (checked inside the write).
// Without `versions` (older callers) every posted box is written as typed.
// The key of the deposit form: it changes whenever the holder or any shown share changes, so the form is drawn again from what is stored.
export const depositFormKey = (heldBy: string, versions: string[]): string => [heldBy, ...versions].join("~");
export function depositVersion(share: { amount: number; updatedAt: Date } | undefined): string {
  return share ? `${share.updatedAt.toISOString()}|${share.amount}` : "";
}
export async function saveDepositFor(
  groupId: string,
  actorId: string,
  input: { heldBy: string; heldByWas?: string; amounts: Record<string, string>; versions?: Record<string, string>; currency?: string },
  opts: { afterRead?: () => Promise<void> } = {},
): Promise<{ ok: true } | Fail> {
  const flat = await loadFlat(groupId);
  if (!flat || flat.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (flat.type === "direct") return { ok: false, error: "This is just between two people, so it has none of these extras." };
  if (!flat.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can do this." };
  if (input.versions) {
    // A form from before the versions existed has none for its boxes: look again, once.
    for (const memberId of Object.keys(input.amounts)) if (flat.members.some((m) => m.id === memberId) && input.versions[memberId] === undefined) return { ok: false, error: FORM_OUT_OF_DATE };
  }
  type Box = { memberId: string; name: string; amount: number; shown: { iso: string; amount: number } | null };
  const boxes: Box[] = [];
  for (const [memberId, raw] of Object.entries(input.amounts)) {
    const who = flat.members.find((m) => m.id === memberId);
    if (!who) continue;
    const v = input.versions?.[memberId] ?? "";
    const [iso, amt] = v.split("|");
    const shown = v && iso && /^\d{1,12}$/.test(amt ?? "") ? { iso, amount: Number(amt) } : null;
    if (input.versions && v && !shown) return { ok: false, error: FORM_OUT_OF_DATE };
    let amount = 0; // blank or a typed zero: no share (and a cleared box removes a held one)
    if (raw.trim() && !typedZero(raw)) {
      const parsed = parseAmount(raw, flat.currency);
      if (parsed === null || parsed < 0) return { ok: false, error: "Enter each amount as a number, like 36000." };
      amount = parsed;
    }
    // A box that still says what it showed is not a change.
    if (input.versions && amount === (shown?.amount ?? 0)) continue;
    // Someone who moved out keeps their deposit on record, but nobody can change it from here.
    if (who.leftAt) {
      if (amount > 0) return { ok: false, error: LEAVER_DEPOSIT_ERROR };
      continue;
    }
    boxes.push({ memberId, name: who.name, amount, shown });
  }
  const cleanHolder = (v: string) => v.trim().slice(0, 40) || "Landlord";
  // "Who holds it" is written only when it was edited, and only if the stored name is still the one the page showed (`heldByWas`).
  if (input.versions && input.heldByWas === undefined) return { ok: false, error: FORM_OUT_OF_DATE };
  const heldByWas = input.heldByWas === undefined ? undefined : cleanHolder(input.heldByWas);
  const heldBy = cleanHolder(input.heldBy);
  const heldByEdited = heldByWas === undefined ? true : heldBy !== heldByWas;
  await opts.afterRead?.(); // tests only: runs after the reads, before the write begins
  const cur = (tx: Prisma.TransactionClient, depId: string, memberId: string) => tx.depositShare.findUnique({ where: { depositId_memberId: { depositId: depId, memberId } } });
  try {
    await db.$transaction(async (tx) => {
      // The first statement is a write (see money-guard.ts): the group is still in the currency the page showed, and this person still in it.
      await guardGroup(tx, groupId, { currency: input.currency ?? flat.currency, actorId, allowClosed: true }); // (a closed flat could always keep its deposit record up to date)
      const had = await tx.deposit.findUnique({ where: { groupId } });
      // A holder edit that is already stored (a resend of a save that went through) is done: nothing to write, not a conflict.
      const holderWrites = heldByEdited && !(had && had.heldBy === heldBy && heldByWas !== undefined);
      if (holderWrites && had && heldByWas !== undefined && had.heldBy !== heldByWas) throw new HolderMoved(had.heldBy);
      const dep = holderWrites || !had ? await tx.deposit.upsert({ where: { groupId }, create: { groupId, heldBy: heldByEdited ? heldBy : heldByWas ?? heldBy }, update: holderWrites ? { heldBy } : {} }) : had;
      const holder = holderWrites ? heldBy : dep.heldBy;
      // Checked again inside the write: someone may have moved out, or been removed, since the form was read.
      const adds = boxes.filter((b) => b.amount > 0);
      if (adds.length) {
        const ids = [...new Set(adds.map((r) => r.memberId))];
        if ((await tx.member.count({ where: { groupId, id: { in: ids }, leftAt: { not: null } } })) > 0) throw new Error("DEPOSIT_LEAVER");
        if ((await tx.member.count({ where: { groupId, id: { in: ids }, leftAt: null } })) !== ids.length) throw new Error("DEPOSIT_GONE");
      }
      const written: string[] = [];
      for (const b of boxes) {
        const now = await cur(tx, dep.id, b.memberId);
        // Only the shares still held can be edited; returned/transferred ones are history. A form opened before a
        // deposit was returned or handed on must not bring it back to life: it is refused instead.
        if (now && now.status !== "held") {
          if (b.amount === 0 && !input.versions) continue; // a blank box next to history is nothing to do
          throw new Error("DEPOSIT_CHANGED");
        }
        // Already as this box asks (a resend of a save that went through): nothing to write, not a conflict.
        if (input.versions && (b.amount === 0 ? now === null : now !== null && now.amount === b.amount)) continue;
        if (input.versions) {
          // The share must still be exactly as the page showed (nobody changed, added or removed it since).
          const same = b.shown ? now !== null && now.updatedAt.toISOString() === b.shown.iso && now.amount === b.shown.amount : now === null;
          if (!same) throw new DepositMoved(b.name, now?.amount ?? 0);
        }
        if (b.amount === 0) {
          // A cleared box removes only that person's held share, and only if they are still in the flat.
          if (!now) continue;
          if ((await tx.member.count({ where: { groupId, id: b.memberId, leftAt: null } })) !== 1) continue;
          const gone = await tx.depositShare.deleteMany({ where: { id: now.id, status: "held", updatedAt: now.updatedAt } });
          if (gone.count !== 1) throw new DepositMoved(b.name, now.amount);
        } else if (!now) {
          await tx.depositShare.create({ data: { depositId: dep.id, memberId: b.memberId, amount: b.amount } });
        } else {
          const done = await tx.depositShare.updateMany({ where: { id: now.id, status: "held", updatedAt: now.updatedAt }, data: { amount: b.amount, updatedAt: new Date() } });
          if (done.count !== 1) throw new DepositMoved(b.name, now.amount);
        }
        written.push(`${b.name}: ${b.amount ? formatMoney(b.amount, flat.currency) : "cleared"}`);
      }
      // Nothing was changed: no line in Activity (the holder's name may still have been updated above).
      if (input.versions && !written.length && !holderWrites) return;
      // The total still held after this save: everyone's held share, including a leaver's that stays on record.
      const stillHeld = (await tx.depositShare.aggregate({ where: { depositId: dep.id, status: "held" }, _sum: { amount: true } }))._sum.amount ?? 0;
      await logEvent(tx, {
        groupId,
        actorId,
        kind: "bill_changed",
        text: `updated the deposit with ${holder} (${formatMoney(stillHeld, flat.currency)})`,
        details: written, // only the shares this save actually wrote
      });
    });
  } catch (err) {
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    if (err instanceof HolderMoved) return { ok: false, error: `Who holds the deposit changed to ${err.now} since you opened this page, so nothing was saved. Look again and save once more.` };
    if (err instanceof DepositMoved) return { ok: false, error: `${err.who}’s deposit changed to ${formatMoney(err.now, flat.currency)} since you opened this page, so nothing was saved. Look again and save once more.` };
    if (String((err as Error)?.message ?? err).includes("DEPOSIT_LEAVER")) return { ok: false, error: LEAVER_DEPOSIT_ERROR };
    if (String((err as Error)?.message ?? err).includes("DEPOSIT_GONE")) return { ok: false, error: "Someone on this deposit was just removed from the flat. Open Deposit again to see who’s in." };
    if (String((err as Error)?.message ?? err).includes("DEPOSIT_CHANGED")) return { ok: false, error: "That deposit was already returned or handed on, so it can’t be changed here. Open Deposit again to see where it stands." };
    throw err;
  }
  return { ok: true };
}
class HolderMoved extends Error {
  constructor(public now: string) {
    super("HOLDER_MOVED");
  }
}
class DepositMoved extends Error {
  constructor(public who: string, public now: number) {
    super("DEPOSIT_MOVED");
  }
}

// Lease over: the deposit comes back, less deductions shared the group's way.
export async function returnDepositFor(groupId: string, actorId: string, deductionsText: string, opts: { currency?: string; afterRead?: () => Promise<void> } = {}): Promise<{ ok: true } | Fail> {
  const flat = await loadFlat(groupId);
  if (!flat || flat.deletedAt || !flat.deposit) return { ok: false, error: "There’s no deposit on record." };
  if (!flat.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can do this." };
  const deductions = deductionsText.trim() && !typedZero(deductionsText) ? parseAmount(deductionsText, flat.currency) : 0;
  if (deductions === null || deductions < 0) return { ok: false, error: "Enter the deductions as a number, like 8000." };
  const held = flat.deposit.shares.filter((s) => s.status === "held");
  if (!held.length) return { ok: false, error: "Nothing is held any more." };
  const heldTotal = held.reduce((x, h) => x + h.amount, 0);
  if (deductions > heldTotal) return { ok: false, error: `The deductions are more than the deposit held (${formatMoney(heldTotal, flat.currency)}). Check the amount.` };
  const weights = Object.fromEntries(flat.members.map((m) => [m.id, m.splitWeight]));
  const refunds = depositRefunds(held, deductions, weights);
  await opts.afterRead?.(); // tests only: runs after the reads, before the write begins
  try {
    await db.$transaction(async (tx) => {
      // First: the flat is still in the currency the deductions were typed in, and this person still in it.
      await guardGroup(tx, groupId, { currency: opts.currency ?? flat.currency, actorId, allowClosed: true });
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
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
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
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (period: string) => MONTH_NAMES[Number(period.slice(5, 7)) - 1] ?? period;
// Would a bill with this split have had this person in it? (A "some" list without them, or percentages or amounts with no entry for them, no.)
// (The flat's own split gives someone with a split weight of 0 no share either.)
function splitIncludes(splitJson: string, memberId: string, weight = 100): boolean {
  try {
    const v = JSON.parse(splitJson) as { mode?: string; ids?: unknown; pct?: Record<string, number>; amt?: Record<string, number> };
    if (v?.mode === "some") return Array.isArray(v.ids) && v.ids.includes(memberId);
    if (v?.mode === "percent") return (v.pct?.[memberId] ?? 0) > 0;
    if (v?.mode === "amounts") return (v.amt?.[memberId] ?? 0) > 0;
    if (v?.mode === "equal") return true;
  } catch {
    /* unreadable: treat as the flat's own split */
  }
  return weight > 0;
}

type Client = Prisma.TransactionClient;

async function checkMoveOut(client: Client, groupId: string, memberId: string, info: MoveOutUndo, since?: Date) {
  const touched = new Set<string>();
  const described = new Map<string, string>();
  const kept = new Set<string>(); // square-up payments already confirmed by the person paid: the undo leaves them counting
  const stop = (text: string, leaver = MOVE_OUT_LEAVER_FIXABLE): { block: MoveOutBlock; touched: Set<string>; described: Map<string, string>; kept: Set<string> } => ({ block: { text, leaver }, touched, described, kept });
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
      const pay = await client.payment.findUnique({ where: { id: x.id }, select: { fromId: true, toId: true, amount: true, deletedAt: true, okAt: true } });
      if (!pay || pay.deletedAt || pay.fromId !== x.fromId || pay.toId !== x.toId || pay.amount !== x.amount) return stop("The square-up payment was changed after the move-out, so this can’t be undone. Ask someone in the flat to undo that change first.");
      // A payment the person paid already confirmed is real money: the undo leaves it counting, so it moves nobody's balance.
      if (pay.okAt) {
        kept.add(x.id);
        continue;
      }
      touched.add(x.fromId);
      touched.add(x.toId);
    }
    // A payment someone said they made ("I've paid") was counted in the square-up: taking it off would count that money twice.
    if (mo.payments.length && (await client.paymentClaim.count({ where: { paymentId: { in: mo.payments.filter((x) => !kept.has(x.id)).map((x) => x.id) }, status: "covered" } })) > 0) {
      return stop("A payment someone said they made (“I’ve paid”) was counted in the move-out’s square-up, so it can’t be undone.", MOVE_OUT_GONE_FOR_GOOD);
    }
  }
  // The daily charges come off too: the person who paid them, and the leaver, change. Each must still be exactly what the move-out wrote
  // (alive, the amount the bill's note holds, and only the leaver's share): an edit, a delete or a swap since means taking it off would move other money.
  const chargeIds = (info.prepaid ?? []).map((x) => x.expenseId);
  const fixable = (what: string) => stop(`${what} was changed after the move-out, so this can’t be undone. Ask someone in the flat to undo that change first.`);
  for (const x of info.prepaid ?? []) {
    const e = await client.expense.findUnique({ where: { id: x.expenseId }, select: { groupId: true, description: true, amount: true, deletedAt: true, paidById: true, shares: { select: { memberId: true, amount: true } } } });
    const bill = await client.bill.findUnique({ where: { id: x.billId }, select: { prepaid: true } });
    const entry = bill ? (parsePrepaid(bill.prepaid)[x.period] ?? []).find((y) => y.e === x.expenseId) : undefined;
    if (!e || e.groupId !== groupId || e.deletedAt) return fixable(e?.description ?? "The daily charge");
    const a = entry?.a ?? e.amount;
    if (e.amount !== a || e.shares.length !== 1 || e.shares[0].memberId !== memberId || e.shares[0].amount !== a) return fixable(e.description);
    touched.add(e.paidById);
    touched.add(memberId);
  }
  // Charges handed to this month's payer at move-out: still alive and still paid by the person they were handed to.
  const chargePayers = info.chargePayers ?? [];
  for (const x of chargePayers) {
    const e = await client.expense.findUnique({ where: { id: x.expenseId }, select: { groupId: true, description: true, deletedAt: true, paidById: true, payers: true } });
    if (!e || e.groupId !== groupId || e.deletedAt || e.paidById !== x.after || e.payers) return fixable(e?.description ?? "The daily charge");
    // Once that month's bill was added (or is being added) it took the charge off its total and credited the month's payer:
    // handing the charge back would put the credit in two places. Lines saved before the month was kept: found from the bill's note.
    let where: { billId: string; period: string } | null = x.billId && x.period ? { billId: x.billId, period: x.period } : null;
    if (!where) {
      for (const b of await client.bill.findMany({ where: { groupId, prepaid: { contains: x.expenseId } }, select: { id: true, prepaid: true } })) {
        const period = Object.entries(parsePrepaid(b.prepaid)).find(([, list]) => list.some((y) => y.e === x.expenseId))?.[0];
        if (period) where = { billId: b.id, period };
      }
    }
    if (!where) return fixable(e.description);
    const run = await client.billRun.findUnique({ where: { billId_period: { billId: where.billId, period: where.period } }, select: { status: true } });
    if (run && run.status !== "waiting") {
      const billName = (await client.bill.findUnique({ where: { id: where.billId }, select: { name: true } }))?.name ?? "The bill";
      return stop(`${billName} for ${monthName(where.period)} was added after the move-out, so the move-out can’t be undone.`, MOVE_OUT_GONE_FOR_GOOD);
    }
    touched.add(x.before);
    touched.add(x.after);
  }
  // Someone who has left since must not have their balance moved by this: they left square, and only they can come back to change it.
  if (mo) {
    const gone = await leaverBalanceBreaks(client, groupId, [...touched].filter((id) => id !== memberId), (l) => ({
      expenses: l.expenses.filter((e) => !chargeIds.includes(e.id)).map((e) => {
        const x = mo.shares.find((y) => y.expenseId === e.id);
        const z = x ? { ...e, shares: x.before } : e;
        const h = chargePayers.find((y) => y.expenseId === e.id);
        return h ? { ...z, paidById: h.before, payers: "" } : z;
      }),
      payments: l.payments.filter((p) => kept.has(p.id) || !mo.payments.some((x) => x.id === p.id)),
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
      return { block: { text: `This month’s ${bill} was already added, so the move-out can’t be undone. Edit ${bill} instead.`, leaver: MOVE_OUT_LEAVER_FIXABLE }, touched, described, kept };
    }
  }
  // A monthly bill added after the move-out was worked out without them: taking the move-out back would leave that month wrong for them.
  const later = await billAddedSince(client, groupId, memberId, info, since);
  if (later) return stop(later.text, later.leaver);
  return { block: null as MoveOutBlock | null, touched, described, kept };
}

// A bill month added (or being added right now) after the move-out that the person would have been in, but isn't (they had left).
async function billAddedSince(client: Client, groupId: string, memberId: string, info: MoveOutUndo, since?: Date): Promise<MoveOutBlock | null> {
  const member = await client.member.findUnique({ where: { id: memberId }, select: { leftAt: true, splitWeight: true } });
  if (!member?.leftAt) return null;
  const from = since ?? member.leftAt;
  const runs = await client.billRun.findMany({
    where: { period: { gte: member.leftAt.toISOString().slice(0, 7) }, status: { in: ["added", "adding"] }, bill: { groupId } },
    select: { period: true, status: true, expenseId: true, claimedAt: true, bill: { select: { id: true, name: true, split: true } } },
    orderBy: [{ period: "asc" }, { id: "asc" }],
  });
  for (const r of runs) {
    // The move-out's own re-split of a bill, or a bill the person shares in, is not "added without them".
    if (r.expenseId && info.money?.shares.some((x) => x.expenseId === r.expenseId)) continue;
    // Their share was in the bill as it was before the move-out took them off a fixed list.
    const split = info.bills.find((b) => b.id === r.bill.id)?.before.split ?? r.bill.split;
    if (!splitIncludes(split, memberId, member.splitWeight)) continue;
    if (r.status === "added") {
      if (!r.expenseId) continue;
      const e = await client.expense.findUnique({ where: { id: r.expenseId }, select: { createdAt: true, deletedAt: true, shares: { select: { memberId: true } } } });
      if (!e || e.deletedAt || e.shares.some((x) => x.memberId === memberId) || e.createdAt.getTime() < from.getTime()) continue;
      return { text: `${r.bill.name} for ${monthName(r.period)} was added after the move-out, so the move-out can’t be undone.`, leaver: MOVE_OUT_GONE_FOR_GOOD };
    }
    if (r.claimedAt && r.claimedAt.getTime() >= from.getTime()) {
      return { text: `${r.bill.name} for ${monthName(r.period)} is being added right now. Try again in a minute.`, leaver: MOVE_OUT_GONE_FOR_GOOD };
    }
  }
  return null;
}

export async function moveOutUndoBlock(client: Client, groupId: string, memberId: string, info: MoveOutUndo, since?: Date): Promise<MoveOutBlock | null> {
  return (await checkMoveOut(client, groupId, memberId, info, since)).block;
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
      const { block, touched, described, kept } = await checkMoveOut(tx, groupId, memberId, info, opts.recordedAt);
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
      // Charges handed to this month's payer go back to the person who moved out (only while still paid by the one they were handed to).
      for (const x of info.chargePayers ?? []) {
        const handedBack = await tx.expense.updateMany({ where: { id: x.expenseId, paidById: x.after, deletedAt: null }, data: { paidById: x.before, payers: "" } });
        if (handedBack.count !== 1) throw new MoveOutBlocked({ text: "A daily charge changed just now. Look again.", leaver: MOVE_OUT_LEAVER_FIXABLE });
      }
      let billsKept = 0;
      for (const b of info.bills) {
        const now = await tx.bill.findUnique({ where: { id: b.id }, select: { payer: true, rotation: true, split: true, deletedAt: true } });
        if (!now || now.deletedAt) continue;
        if (now.payer !== b.after.payer || now.rotation !== b.after.rotation || now.split !== b.after.split) {
          billsKept++;
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
        // A payment the person paid already confirmed is real money: it stays and keeps counting (and its line stays as it was).
        // Payments nobody has confirmed come off. Only payments still unconfirmed are written, as read in the same step.
        const gone = mo.payments.filter((x) => !kept.has(x.id));
        await tx.payment.updateMany({ where: { id: { in: gone.map((x) => x.id) }, deletedAt: null, okAt: null }, data: { deletedAt: at, deletedById: actorId } });
        for (const x of gone) lines.push(`Taken off: ${nameOf(x.fromId)} paid ${nameOf(x.toId)} ${money(x.amount)}`);
        for (const x of mo.payments.filter((y) => kept.has(y.id))) lines.push(`Kept, already confirmed: ${nameOf(x.fromId)} paid ${nameOf(x.toId)} ${money(x.amount)}`);
        if (gone.length) lines.push("If any of these payments really happened, record it again.");
        const keptLines = kept.size ? (await tx.groupEvent.findMany({ where: { id: { in: mo.eventIds }, paymentId: { in: [...kept] } }, select: { id: true } })).map((e) => e.id) : [];
        await tx.groupEvent.updateMany({ where: { id: { in: mo.eventIds.filter((id) => !keptLines.includes(id)) }, undoneAt: null }, data: { undoneAt: at, undoneById: actorId } });
      }
      return logEvent(tx, {
        groupId,
        actorId,
        kind: "member_rejoined",
        text: `${memberId === actorId ? "moved back in" : `brought ${m.name} back into the flat`} (undo)`,
        details: [
          ...(info.bills.length - billsKept > 0 ? ["Bills they paid or took turns on are back as they were"] : []),
          ...(billsKept ? [`${billsKept} bill${billsKept === 1 ? "" : "s"} changed since kept the newer settings`] : []),
          ...(info.deposit ? ["Their deposit is back with them"] : []),
          ...((info.prepaid ?? []).length ? ["Their share of the daily bills was taken off again"] : []),
          ...lines,
          memberMark(memberId), // not shown: names who came back, for the history of who was in the group when (see membershipPeriods)
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
