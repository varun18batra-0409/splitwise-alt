import { db } from "../db";
import type { RateAnswer } from "../rate-cache";
import { GroupChanged, isGroupChangedText } from "../money-guard";
import { saveExpense, type Attach, type SaveExpenseInput } from "../save-expense";
import { sendPushTo } from "../push";
import { askBill } from "./bill-asks";
import { toInputAmount, formatMoney, parseAmount } from "../money";
import { STUCK_HOLD, dailyTotal, longMonth, missedDays, isStopped, payerFor, periodsDue, nextDueDay, nextDueAfter, ordinalDay, stopDone, stopLines, type StopWords } from "./bills";
import { daysInMonth, dueKey } from "./month";
import { noteReplaced } from "./bill-run-link";
import { dailyMonthShares, joinWeights, parsePrepaid, type Prepaid } from "./moving";
import { niceDate } from "../format";
import { dayKey, DEFAULT_TIME_ZONE } from "../dates";
import { previousResult } from "../once";
import { logEvent, touchedByExpense } from "../events";
import { REPEAT_BILL_MARK } from "../membership";
import { settlingIn } from "../settling-db";
import { withSettlingLeft, type Settling } from "../settling";
import type { Prisma } from "@prisma/client";

// Recurring bills, database side. The daily job calls runAllBills(); each
// (bill, month) gets one BillRun row — its unique key is what makes adding a
// bill twice impossible, even if the job runs twice at the same moment.

type BillRow = Awaited<ReturnType<typeof db.bill.findMany>>[number];
type Member = { id: string; name: string; leftAt: Date | null; splitWeight: number; joinedFrom?: Date | null };

export type BillSplit = {
  mode: "group" | "equal" | "some" | "percent" | "amounts";
  ids: string[]; // "some": who shares it
  pct: Record<string, number>; // "percent": basis points per person (5000 = 50%)
  amt: Record<string, number>; // "amounts": minor units per person
};

const numbers = (v: unknown): Record<string, number> =>
  v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, n]) => Number.isInteger(n) && (n as number) > 0) as [string, number][])
    : {};

export function parseSplit(json: string): BillSplit {
  try {
    const v = JSON.parse(json);
    const mode = ["equal", "some", "percent", "amounts"].includes(v?.mode) ? v.mode : "group";
    return { mode, ids: Array.isArray(v?.ids) ? v.ids.filter((x: unknown) => typeof x === "string") : [], pct: numbers(v?.pct), amt: numbers(v?.amt) };
  } catch {
    return { mode: "group", ids: [], pct: {}, amt: {} };
  }
}

// Why a bill can't be added as it's set up (someone in a fixed split has left), or "".
export function splitProblem(splitJson: string, activeIds: string[]): string {
  const split = parseSplit(splitJson);
  if (split.mode === "some" && !split.ids.some((id) => activeIds.includes(id))) return "nobody left to share it";
  const fixed = split.mode === "percent" ? split.pct : split.mode === "amounts" ? split.amt : null;
  if (fixed && (!Object.keys(fixed).length || Object.keys(fixed).some((id) => !activeIds.includes(id)))) return "someone in the split has left";
  return "";
}

// Why a waiting bill can't just be added, worked out from how things are NOW (so a problem that has been
// fixed stops showing): "" = nothing is wrong. A varies bill with "" is waiting for its amount; others can be added.
// The reasons the code can work out again. Any other reason saved with the held month (an error from trying to save
// the expense) is kept as it was, so a form that won't save never shows "Add it".
export const RECOMPUTABLE_HOLDS = ["deleted", "group closed", "payer left", "nobody left to share it", "someone in the split has left", "no amount"];

export function holdReasonNow(bill: { split: string; nature: string; amount: number }, activeIds: string[], closed: boolean, payer: string | null, saved = ""): string {
  if (saved === STUCK_HOLD) return STUCK_HOLD; // first: a month that may already have been added is never offered for adding
  if (closed) return "group closed";
  if (!payer) return "payer left";
  const problem = splitProblem(bill.split, activeIds);
  if (problem) return problem;
  if (bill.nature === "fixed" && bill.amount <= 0) return "no amount";
  return saved && !RECOMPUTABLE_HOLDS.includes(saved) ? saved : "";
}

// What a daily bill's month-end split needs to know (see dailyMonthShares): the month's amount to share (the total less move-out charges)
// and the move-out charges written on the bill for that month: `entries` still count, `gone` had their expense deleted.
export type DailyContext = { amount: number; entries: Prepaid[]; gone: Prepaid[] };

// How an automatic expense is shared: the group's own split, equally, only
// some, by percentage or by fixed amounts.
export function splitFields(splitJson: string, members: Member[], period?: string, currency = "INR", daily?: DailyContext & { bill: BillRow }): Pick<SaveExpenseInput, "forMode" | "selected" | "splitType" | "shares"> & Partial<Pick<SaveExpenseInput, "percent" | "exact">> {
  const active = members.filter((m) => !m.leftAt);
  const split = parseSplit(splitJson);
  // A daily bill's month where someone moved in, or someone moved out and paid at move-out: shared day by day (the amounts are written out). First of all, so a percentage split can't charge a brought-back leaver twice.
  if (period && daily) {
    const parts = dailyMonthShares({
      bill: daily.bill,
      period,
      members: members.map((m) => ({ id: m.id, splitWeight: m.splitWeight, joinedFrom: m.joinedFrom ?? null, leftAt: m.leftAt })),
      live: daily.entries,
      gone: daily.gone,
      amount: daily.amount,
    });
    if (parts) {
      return { forMode: "selected", selected: parts.map((p) => p.memberId), splitType: "exact", exact: Object.fromEntries(parts.map((p) => [p.memberId, toInputAmount(p.amount, currency)])), percent: {} };
    }
  }
  if (split.mode === "percent") {
    const ids = Object.keys(split.pct);
    return { forMode: "selected", selected: ids, splitType: "percent", percent: Object.fromEntries(ids.map((id) => [id, String(split.pct[id] / 100)])), exact: {} };
  }
  if (split.mode === "amounts") {
    const ids = Object.keys(split.amt);
    return { forMode: "selected", selected: ids, splitType: "exact", exact: Object.fromEntries(ids.map((id) => [id, toInputAmount(split.amt[id], currency)])), percent: {} };
  }
  const some = split.mode === "some" ? active.filter((m) => split.ids.includes(m.id)).map((m) => m.id) : [];
  // Someone moved in this month: they share only for the days they're there.
  if (period && split.mode !== "some" && active.some((m) => m.joinedFrom && m.joinedFrom.toISOString().slice(0, 7) >= period)) {
    const days = daysInMonth(period);
    const base = (m: Member) => (split.mode === "group" ? m.splitWeight : 100);
    const w = joinWeights(active.map((m) => ({ id: m.id, splitWeight: base(m), joinedFrom: m.joinedFrom ?? null })), period);
    return {
      forMode: "everyone",
      selected: [],
      splitType: "shares",
      shares: Object.fromEntries(active.map((m) => [m.id, String(Math.round(w[m.id] / days) / 100)])),
    };
  }
  const groupSplit = split.mode === "group" && active.some((m) => m.splitWeight !== active[0].splitWeight);
  return {
    forMode: some.length ? "selected" : "everyone",
    selected: some,
    splitType: groupSplit ? "shares" : "equal",
    shares: groupSplit ? Object.fromEntries(active.map((m) => [m.id, String(m.splitWeight / 100)])) : undefined,
  };
}

// The expense a bill becomes (also used to prefill "Enter amount").
// `charges` (a daily bill only): the move-out charges for the month, so the month-end split can be worked out day by day. Left out, the usual way is used.
export function billExpenseInput(bill: BillRow, groupId: string, currency: string, period: string, amount: number, payerId: string, members: Member[], charges?: { entries: Prepaid[]; gone: Prepaid[] }): SaveExpenseInput {
  const day = bill.nature === "daily" ? dueKey(period, "last") : dueKey(period, bill.day >= 31 ? "last" : bill.day);
  return {
    groupId,
    name: bill.name,
    category: bill.category,
    amount: toInputAmount(amount, currency),
    currency,
    paidById: payerId,
    onePersonId: "",
    exact: {},
    percent: {},
    ...splitFields(bill.split, members, period, currency, bill.nature === "daily" && charges ? { bill, amount, ...charges } : undefined),
    paymentMethod: "cash",
    markupChoice: "group",
    markupCustom: "",
    rateMode: "auto",
    manualRate: "",
    date: day,
    notes: bill.nature === "daily" ? "" : undefined,
  };
}

// A bill is always in the group's own currency, so its run never asks for a market rate: if the two currencies differ (the group's
// currency was changed after the bill was worked out), the run is refused and tried again with fresh numbers.
export const BILL_CURRENCY_CHANGED = "The group’s currency changed, so this bill wasn’t added yet. It will be tried again.";
const sameCurrencyRate = async (from: string, to: string): Promise<RateAnswer> =>
  from === to ? { ok: true, rate: "1", date: new Date().toISOString().slice(0, 10) } : { ok: false, reason: "unavailable", message: BILL_CURRENCY_CHANGED };

// Thrown inside the expense's transaction when the bill is not as it was when the amount was worked out.
class BillMoved extends Error {}
// The same, for a daily month whose people or move-out charges changed so that the split worked out again is not the one being saved.
// (Not the bill itself: the month is simply worked out again by the next run while it is still due.)
class PeopleMoved extends BillMoved {}

// A split as one comparable text: the amount and who shares it, how.
const splitOf = (x: SaveExpenseInput) => JSON.stringify([x.amount, x.forMode, [...x.selected].sort(), x.splitType, x.exact ?? {}, x.percent ?? {}, x.shares ?? null]);

// A short fingerprint of what an "Add it" page was filled in from: the month's total and the move-out charges standing (expense, amount).
// The page sends it back; if it is not the same now, the page is out of date. (A tiny FNV hash: it only has to notice a change.)
export function billFormFingerprint(monthTotal: number, entries: Prepaid[]): string {
  const text = `${monthTotal}|${entries.map((e) => `${e.e}:${e.a}`).sort().join(",")}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

// The fields an automatic month depends on, as one comparable text.
// Days marked "didn't come" and move-out charges are compared only for the month being run (a tick on next month's calendar changes nothing here).
const billMoney = (b: BillRow, period: string) =>
  JSON.stringify([b.amount, b.nature, b.split, b.payer, b.rotation, b.paused, b.pausedAt?.getTime() ?? 0, b.deletedAt?.getTime() ?? 0, missedDays(b.missed, period), parsePrepaid(b.prepaid)[period] ?? [], b.every, b.startMonth, b.endMonth, b.day]);

// What a leaver already paid for a daily bill's month at move-out (their share of the days they were
// there). Each charge counts for what it is NOW (edited since: the new amount) and only while its expense
// exists and isn't deleted; the month-end bill takes that off, so nobody pays twice.
// `gone` = the charges whose expense was deleted (they take nothing off the month, but say who was charged and up to which day).
export async function prepaidFor(bill: { prepaid: string }, period: string): Promise<{ total: number; entries: Prepaid[]; gone: Prepaid[] }> {
  const list = parsePrepaid(bill.prepaid)[period] ?? [];
  if (!list.length) return { total: 0, entries: [], gone: [] };
  const now = new Map((await db.expense.findMany({ where: { id: { in: list.map((x) => x.e) }, deletedAt: null }, select: { id: true, amount: true } })).map((e) => [e.id, e.amount]));
  const entries = list.filter((x) => now.has(x.e)).map((x) => ({ ...x, a: now.get(x.e)! }));
  return { total: entries.reduce((n, x) => n + x.a, 0), entries, gone: list.filter((x) => !now.has(x.e)) };
}

// The month-end daily bill is paid by that month's payer, so the move-out charge (which only the leaver shares)
// is credited to that same person: the payer ends up credited for the whole month. Shares don't change.
// A short line goes in the history for each charge that changes payer ("Asha now paid Milk · 1–14 Nov"), so nothing moves silently.
export async function syncChargePayer(tx: Prisma.TransactionClient, groupId: string, entries: Prepaid[], payer: string): Promise<void> {
  if (!payer || !entries.length) return;
  // A charge whose current payer has left stays theirs: moving the credit would move a balance that has to stay exactly 0 (the move-out
  // hands such a charge on while the person is still here; this is the backstop for anything older).
  const all = await tx.expense.findMany({ where: { id: { in: entries.map((x) => x.e) }, paidById: { not: payer } }, include: { shares: true, paidBy: { select: { leftAt: true, removedAt: true } } } });
  const rows = all.filter((x) => !x.paidBy.leftAt && !x.paidBy.removedAt);
  if (!rows.length) return;
  const name = (await tx.member.findUnique({ where: { id: payer }, select: { name: true } }))?.name ?? "Someone";
  for (const x of rows) {
    await tx.expense.update({ where: { id: x.id }, data: { paidById: payer, payers: "" } });
    await logEvent(tx, {
      groupId,
      actorId: payer,
      kind: "expense_edited",
      text: `${name} now paid ${x.description}`,
      details: [`Paid by ${name}`],
      expenseId: x.id,
      touches: touchedByExpense(x, { paidById: payer, amount: x.amount, payers: "", kind: x.kind, shares: x.shares }),
    });
  }
}

// A claim older than this is from a run that crashed part-way; it's taken over.
const STALE_MS = 10 * 60_000;

// Claim (bill, month) for adding. The unique (bill, month) row means only one
// caller ever gets it — unless it's a stale "adding" left by a crash.
async function claimRun(billId: string, period: string, now: Date) {
  try {
    return await db.billRun.create({ data: { billId, period, status: "adding", claimedAt: now } });
  } catch {
    const old = await db.billRun.findUnique({ where: { billId_period: { billId, period } } });
    if (!old || old.status !== "adding") return null;
    if (old.claimedAt && now.getTime() - old.claimedAt.getTime() < STALE_MS) return null;
    const took = await db.billRun.updateMany({ where: { id: old.id, status: "adding", claimedAt: old.claimedAt }, data: { claimedAt: now } });
    return took.count === 1 ? { ...old, claimedAt: now } : null;
  }
}

// `afterRead` is for tests only: it runs after the group has been read for the save and before the write begins; `afterSave` runs after the
// expense is saved and before the month is marked.
type RunHooks = { afterRead?: () => Promise<void>; afterSave?: () => Promise<void> };

// Turn one due (bill, month) into an expense, once.
async function runOne(first: BillRow, group: { id: string; currency: string; closed: boolean; members: Member[]; settling: ReadonlyMap<string, Settling> }, period: string, now: Date, opts: RunHooks = {}) {
  // Claim the month first. If someone else already did, there's nothing to do.
  const run = await claimRun(first.id, period, now);
  if (!run) return "already";
  // A daily bill is read again once the month is claimed: a pause, a start again or a day marked meanwhile changes what the month comes to.
  let bill = first;
  if (first.nature === "daily") {
    const fresh = await db.bill.findUnique({ where: { id: first.id } });
    if (!fresh || fresh.deletedAt) {
      await db.billRun.update({ where: { id: run.id }, data: { status: "skipped", reason: "bill gone" } });
      return "skipped";
    }
    bill = fresh;
  }
  const key = run.requestKey || `bill-${run.id}`;
  // Taking over a crashed run: if its expense was saved after all, just finish.
  // Someone settling up only counts as moved out from their original last day: never a payer, never in the split. (A daily bill's month in their own
  // move-out month keeps the rule it had: `shareMembers`.)
  const payMembers = withSettlingLeft(group.members, group.settling);
  const shareMembers = bill.nature === "daily" ? withSettlingLeft(group.members, group.settling, { dailyMonth: period }) : payMembers;
  const active = payMembers.filter((m) => !m.leftAt).map((m) => m.id);
  const payer = payerFor(bill, period, active);
  const saved = await previousResult(key);
  if (saved) {
    const charges = bill.nature === "daily" && payer ? (await prepaidFor(bill, period)).entries : [];
    await db.$transaction(async (tx) => {
      await tx.billRun.update({ where: { id: run.id }, data: { status: "added", expenseId: saved, reason: "" } });
      await noteReplaced(tx, run.expenseId, saved); // a deleted month being added again when it crashed: the old expense can't come back
      await syncChargePayer(tx, group.id, charges, payer ?? "");
    });
    return "added";
  }
  const wait = async (reason: string) => {
    // (A deleted month being added again that crashed keeps its "deleted" mark: its old expense is still on the run.)
    await db.billRun.update({ where: { id: run.id }, data: { status: "waiting", reason: reason === "" && run.expenseId ? "deleted" : reason, requestKey: "" } });
    return "waiting";
  };
  // An "Enter amount" that never finished: ask for it again.
  if (run.requestKey) return wait("");
  if (group.closed) return wait("group closed");
  if (!payer) {
    // Tell the flat once (this month is claimed just this once): someone needs to pick a payer.
    await sendPushTo(active, {
      title: `🧾 ${bill.name} needs a payer`,
      body: `${bill.name} is due, but whoever paid it has left. Tap to pick who pays.`,
      url: `/groups/${group.id}/bills/${bill.id}`,
      tag: `bill-${bill.id}-${period}`,
    }, "reminders.bills").catch(() => 0);
    return wait("payer left");
  }
  const problem = splitProblem(bill.split, active);
  if (problem) return wait(problem);
  if (bill.nature === "varies") {
    // Ask whoever pays for this month's amount, in their daytime (at night the month just waits: sendBillAsks asks later).
    await askBill(run.id, payer, { name: bill.name, billId: bill.id, groupId: group.id, period }, now);
    return wait("");
  }

  let amount = bill.amount;
  let note = "";
  let charges: Prepaid[] = [];
  let gone: Prepaid[] = [];
  if (bill.nature === "daily") {
    const d = dailyTotal(bill, period);
    if (d.days <= 0 || bill.amount <= 0) {
      await db.billRun.update({ where: { id: run.id }, data: { status: "skipped", reason: "no days" } });
      return "skipped";
    }
    // Someone who moved out part-way through this month already paid their share of the days they were there.
    const pre = await prepaidFor(bill, period);
    charges = pre.entries;
    gone = pre.gone;
    amount = d.amount - pre.total;
    if (pre.total > 0 && amount <= 0) {
      await db.billRun.update({ where: { id: run.id }, data: { status: "skipped", reason: "covered" } });
      return "skipped";
    }
    note = `${d.days} days × ${formatMoney(bill.amount, group.currency)}`;
    for (const x of pre.entries) {
      note += `, less ${formatMoney(x.a, group.currency)} ${group.members.find((m) => m.id === x.m)?.name ?? "someone"}’s share${x.d ? ` (moved out ${niceDate(x.d)})` : ""}`;
    }
  }
  if (amount <= 0) return wait("no amount");

  const input = billExpenseInput(bill, group.id, group.currency, period, amount, payer, shareMembers, bill.nature === "daily" ? { entries: charges, gone } : undefined);
  if (note) input.notes = note;
  // The month is refused (and its claim removed, so the next run starts again from fresh numbers) when the group or the bill changed
  // while this was being worked out. Removed only if the claim is still this run's own.
  // Only this month's row is removed (the next run, today or tonight, takes it again). An older month is outside the job's window and would
  // be lost, so it becomes a waiting month a person can see and add.
  const retryLater = async () => {
    const thisMonth = dayKey(now, bill.tz || DEFAULT_TIME_ZONE).slice(0, 7);
    if (period === thisMonth) await db.billRun.deleteMany({ where: { id: run.id, status: "adding", claimedAt: run.claimedAt } });
    else await db.billRun.updateMany({ where: { id: run.id, status: "adding", claimedAt: run.claimedAt }, data: { status: "waiting", reason: run.expenseId ? "deleted" : "", requestKey: "" } });
    return "failed" as const;
  };
  // When only the people or the move-out charges changed in the gap and the month is still due, the claim is just removed: the next run works it out again.
  const releaseOrRetry = async () => {
    // Released only if the month is still due at tomorrow's run too; on the last day of the job's window it becomes a waiting month a person
    // can see and add, or it would be lost without anyone noticing.
    if (run.expenseId || !periodsDue(bill, now).includes(period) || !periodsDue(bill, new Date(now.getTime() + 86_400_000)).includes(period)) return retryLater();
    await db.billRun.deleteMany({ where: { id: run.id, status: "adding", claimedAt: run.claimedAt } });
    return "failed" as const;
  };
  const worked = billMoney(bill, period);
  let r: Awaited<ReturnType<typeof saveExpense>>;
  try {
    r = await saveExpense(input, payer, sameCurrencyRate, {
      now,
      requestKey: key,
      eventText: `paid ${bill.name} (${formatMoney(amount, group.currency)}) ${REPEAT_BILL_MARK}`,
      settlingMayShare: shareMembers.filter((m) => group.settling.has(m.id) && !m.leftAt).map((m) => m.id),
      afterRead: opts.afterRead,
      // In the same step as the expense: the bill is still exactly as it was when the amount was worked out, and the month is marked added.
      alsoInTx: async (tx, expenseId) => {
        const now2 = await tx.bill.findUnique({ where: { id: bill.id } });
        if (!now2 || billMoney(now2, period) !== worked) throw new BillMoved();
        if (bill.nature === "daily") {
          // A daily month depends on who is in the flat and which move-out charges still stand: worked out again here with the people and charges
          // as they are now. Only if that is not the amount and split being saved is the month refused (a weight edit, someone unrelated joining,
          // or "Not received" bringing back a leaver whose charge stands all give the same split, so they don't hold it up).
          // (Who is settling up only is read again here too: "Not received" may have landed since.)
          const members = withSettlingLeft(
            await tx.member.findMany({ where: { groupId: group.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, splitWeight: true, joinedFrom: true } }),
            await settlingIn(tx, group.id),
            { dailyMonth: period },
          );
          const written = parsePrepaid(now2.prepaid)[period] ?? [];
          const standing = new Map((await tx.expense.findMany({ where: { id: { in: written.map((x) => x.e) }, deletedAt: null }, select: { id: true, amount: true } })).map((e) => [e.id, e.amount]));
          const entries = written.filter((x) => standing.has(x.e)).map((x) => ({ ...x, a: standing.get(x.e)! }));
          const total = dailyTotal(now2, period).amount - entries.reduce((n, x) => n + x.a, 0);
          const again = billExpenseInput(now2, group.id, group.currency, period, total, payer, members, { entries, gone: written.filter((x) => !standing.has(x.e)) });
          if (splitOf(again) !== splitOf(input)) throw new PeopleMoved();
        }
        await tx.billRun.update({ where: { id: run.id }, data: { status: "added", expenseId, reason: "" } });
        await syncChargePayer(tx, group.id, charges, payer);
      },
    });
  } catch (err) {
    if (err instanceof PeopleMoved) return releaseOrRetry();
    if (err instanceof BillMoved || err instanceof GroupChanged) return retryLater();
    throw err;
  }
  if (!r.ok) {
    if (r.error === BILL_CURRENCY_CHANGED || isGroupChangedText(r.error)) return retryLater();
    return wait(r.error.slice(0, 120));
  }
  // Added (a repeat of an answer already given comes back here too): the month is marked and the move-out charge credited, once.
  const addedId = r.id;
  await opts.afterSave?.();
  // Only a month still "adding" is marked: if it was marked already (the step above) or the expense was deleted in the meantime, it stays as it is.
  await db.$transaction(async (tx) => {
    const marked = await tx.billRun.updateMany({ where: { id: run.id, status: "adding" }, data: { status: "added", expenseId: addedId, reason: "" } });
    if (marked.count === 1) await syncChargePayer(tx, group.id, charges, payer);
  });
  return "added";
}

// Every bill of one group that's due now.
export async function runBillsForGroup(groupId: string, now = new Date(), opts: RunHooks = {}) {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, splitWeight: true, joinedFrom: true } } },
  });
  const counts = { added: 0, waiting: 0, skipped: 0, failed: 0 };
  if (!group || group.deletedAt) return counts;
  const ctx = { id: group.id, currency: group.currency, closed: group.closed, members: group.members, settling: await settlingIn(db, group.id) };
  // (A paused daily bill still has the month it was paused in: periodsDue says which months are due.)
  const bills = await db.bill.findMany({ where: { groupId, deletedAt: null } });
  for (const bill of bills) {
    for (const period of periodsDue(bill, now)) {
      // One bill failing (a dropped connection) mustn't stop the others; its
      // claim goes stale and the next run finishes it.
      const r = await runOne(bill, ctx, period, now, opts).catch((err) => {
        console.error("bill run failed", bill.id, period, String(err).slice(0, 200));
        return "failed" as const;
      });
      if (r === "failed") counts.failed++;
      else if (r === "added") counts.added++;
      else if (r === "waiting") counts.waiting++;
      else if (r === "skipped") counts.skipped++;
    }
    await settleStuckRuns(bill, ctx, periodsDue(bill, now), now).catch((err) => console.error("bill stuck check failed", bill.id, String(err).slice(0, 200)));
    await finishStoppedBill(bill.id, now).catch(() => false); // a stopped bill with nothing left to add is finished
  }
  return counts;
}

// What a person sees on a month that may already have been added (an old claim with nothing to prove either way): "On hold · Fix it".
// It is never "Add it": adding it by hand could charge the month twice.
export { STUCK_HOLD };
const KEY_KEEP_MS = 29 * 86_400_000; // a retry key is cleaned away after 30 days, so it proves nothing after that

// The expense a bill's month became, found from its own history line (an automatic month is written as "paid <bill> (…) · repeat bill") and
// its due day. Only when exactly one expense fits: one already linked from any month's run (another bill with the same name and day), or the
// old expense this run was replacing, is not a candidate. null = none or not sure. A deleted one is still returned (the month then shows
// "Deleted · Add it again", never added again by itself).
async function findBillExpense(bill: BillRow, groupId: string, period: string, replacing: string): Promise<{ id: string; deletedAt: Date | null } | null> {
  const events = await db.groupEvent.findMany({
    where: { groupId, kind: "expense_added", expenseId: { not: null }, AND: [{ text: { startsWith: `paid ${bill.name} (` } }, { text: { contains: REPEAT_BILL_MARK } }] },
    select: { expenseId: true },
  });
  const ids = events.map((e) => e.expenseId).filter((x): x is string => Boolean(x) && x !== replacing);
  if (!ids.length) return null;
  const taken = new Set((await db.billRun.findMany({ where: { expenseId: { in: ids } }, select: { expenseId: true } })).map((r) => r.expenseId));
  const day = bill.nature === "daily" ? dueKey(period, "last") : dueKey(period, bill.day >= 31 ? "last" : bill.day);
  const hits = await db.expense.findMany({ where: { id: { in: ids.filter((id) => !taken.has(id)) }, groupId, description: bill.name, spentAt: new Date(`${day}T12:00:00.000Z`) }, select: { id: true, deletedAt: true } });
  return hits.length === 1 ? hits[0] : null;
}

// A month left "adding" by a run that crashed, in a period the daily run no longer looks at (older than last month), would never be
// finished or shown. After 10 minutes the run is looked at again, and never charged automatically (the amount may be out of date by now):
//  - its expense exists (by its saved key, or found in the history by bill and day): the month is marked added (or "Deleted" if that expense was deleted);
//  - no expense, and the claim is under 29 days old with its key still there: the key would have shown it, so it is waiting for a person (add it);
//  - otherwise there is no proof either way: it is put on hold ("Fix it"), never "Add it".
async function settleStuckRuns(bill: BillRow, group: { id: string; members: Member[]; settling: ReadonlyMap<string, Settling> }, due: string[], now: Date): Promise<void> {
  const old = new Date(now.getTime() - STALE_MS);
  const stuck = await db.billRun.findMany({ where: { billId: bill.id, status: "adding", period: { notIn: due }, OR: [{ claimedAt: null }, { claimedAt: { lt: old } }] } });
  const active = withSettlingLeft(group.members, group.settling).filter((m) => !m.leftAt).map((m) => m.id);
  for (const run of stuck) {
    const mine = { id: run.id, status: "adding", claimedAt: run.claimedAt };
    const proof = await previousResult(run.requestKey || `bill-${run.id}`);
    const found = proof ? await db.expense.findUnique({ where: { id: proof }, select: { id: true, deletedAt: true } }) : await findBillExpense(bill, group.id, run.period, run.expenseId);
    const expenseId = proof ?? found?.id ?? "";
    if (proof || found) {
      if (found?.deletedAt) {
        await db.billRun.updateMany({ where: mine, data: { status: "waiting", reason: "deleted", expenseId, requestKey: "" } });
        continue;
      }
      const payer = payerFor(bill, run.period, active);
      const charges = bill.nature === "daily" && payer ? (await prepaidFor(bill, run.period)).entries : [];
      await db.$transaction(async (tx) => {
        const c = await tx.billRun.updateMany({ where: mine, data: { status: "added", expenseId, reason: "" } });
        if (c.count !== 1) return;
        await noteReplaced(tx, run.expenseId, expenseId);
        await syncChargePayer(tx, group.id, charges, payer ?? "");
      });
      continue;
    }
    const young = run.claimedAt !== null && now.getTime() - run.claimedAt.getTime() < KEY_KEEP_MS && run.requestKey !== "";
    await db.billRun.updateMany({ where: mine, data: young ? { status: "waiting", reason: run.expenseId ? "deleted" : "", requestKey: "" } : { status: "waiting", reason: STUCK_HOLD, requestKey: "" } });
  }
}

// The daily job: every group that has bills.
export async function runAllBills(now = new Date(), stop: () => boolean = () => false, opts: { onlyGroups?: string[] } = {}) {
  const groups = await db.bill.findMany({ where: { deletedAt: null, group: { deletedAt: null }, ...(opts.onlyGroups ? { groupId: { in: opts.onlyGroups } } : {}) }, select: { groupId: true }, distinct: ["groupId"] });
  const total = { groups: groups.length, added: 0, waiting: 0, skipped: 0, failed: 0, deferred: false };
  for (const g of groups) {
    // Out of time: the rest wait for the next run (each bill month is added at most once, so repeating is safe).
    if (stop()) { total.deferred = true; break; }
    const c = await runBillsForGroup(g.groupId, now);
    total.added += c.added;
    total.waiting += c.waiting;
    total.skipped += c.skipped;
    total.failed += c.failed;
  }
  return total;
}

// The "Coming up" list and the Bills tab: each bill, what's happening with it now.
export type BillStatus = {
  bill: BillRow;
  status: "waiting" | "added" | "upcoming" | "paused";
  period: string;
  due: string; // "2026-11-01"
  usual: number | null; // varies: the average of recent months
  payerId: string | null;
  reason: string;
  recordedThisMonth: boolean; // this month's is already added (in the bill's own time zone)
};

export async function billStatuses(groupId: string, now = new Date()): Promise<BillStatus[]> {
  const [bills, members, grp] = await Promise.all([
    db.bill.findMany({ where: { groupId, deletedAt: null }, include: { runs: { orderBy: { period: "desc" }, take: 4 } }, orderBy: { createdAt: "asc" } }),
    db.member.findMany({ where: { groupId, leftAt: null }, select: { id: true, leftAt: true } }),
    db.group.findUnique({ where: { id: groupId }, select: { closed: true } }),
  ]);
  // Someone settling up only is not a payer or in a split (settling.ts).
  const settling = await settlingIn(db, groupId);
  // Every month still waiting, however old (the latest few runs alone could hide an older waiting month behind newer added ones).
  const waitingRuns = await db.billRun.findMany({ where: { billId: { in: bills.map((b) => b.id) }, status: "waiting" }, orderBy: { period: "asc" } });
  for (const bill of bills) {
    const mine = waitingRuns.filter((r) => r.billId === bill.id && !bill.runs.some((x) => x.id === r.id));
    bill.runs = [...bill.runs, ...mine].sort((x, y) => y.period.localeCompare(x.period));
  }
  const closed = Boolean(grp?.closed);
  const active = withSettlingLeft(members, settling).filter((m) => !m.leftAt).map((m) => m.id);
  const runExpenseIds = bills.flatMap((b) => b.runs.map((r) => r.expenseId)).filter(Boolean);
  const amounts = new Map(
    (await db.expense.findMany({ where: { id: { in: runExpenseIds }, deletedAt: null }, select: { id: true, amount: true } })).map((e) => [e.id, e.amount]),
  );
  return bills.filter((bill) => !stopDone(bill, bill.runs, now)).map((bill) => {
    const { runs, ...b } = bill;
    const thisMonth = dayKey(now, bill.tz || DEFAULT_TIME_ZONE).slice(0, 7);
    const recordedThisMonth = runs.some((r) => r.period === thisMonth && r.status === "added");
    // The OLDEST month still waiting (the same one "Enter amount" and Skip point at). A deleted month shows only on the bill page ("Deleted · Add it again").
    const waiting = [...runs].reverse().find((r) => r.status === "waiting" && r.reason !== "deleted");
    const past = runs.filter((r) => r.status === "added" && amounts.has(r.expenseId)).map((r) => amounts.get(r.expenseId)!);
    const usual = bill.nature === "varies" && past.length ? Math.round(past.slice(0, 3).reduce((s, a) => s + a, 0) / Math.min(3, past.length)) : null;
    if (waiting) {
      const due = bill.nature === "daily" ? dueKey(waiting.period, "last") : dueKey(waiting.period, bill.day >= 31 ? "last" : bill.day);
      // The reason saved when the month was held can be out of date (the split was fixed since): work it out again.
      const payerId = payerFor(bill, waiting.period, active);
      return { bill: b as BillRow, status: "waiting", period: waiting.period, due, usual, payerId, reason: holdReasonNow(bill, active, closed, payerId, waiting.reason), recordedThisMonth };
    }
    const next = nextDueDay(bill, now);
    if (bill.paused || !next) return { bill: b as BillRow, status: "paused", period: "", due: "", usual, payerId: null, reason: "", recordedThisMonth };
    const period = next.slice(0, 7);
    const done = runs.find((r) => r.period === period && (r.status === "added" || r.status === "skipped"));
    // This month's already added → show the next one.
    if (done) {
      const after = nextDueAfter(bill, period); // (the start month stays the anchor, so an every-other-month bill keeps its own months)
      if (after) return { bill: b as BillRow, status: "upcoming", period: after.slice(0, 7), due: after, usual, payerId: payerFor(bill, after.slice(0, 7), active), reason: "", recordedThisMonth };
    }
    return { bill: b as BillRow, status: "upcoming", period, due: next, usual, payerId: payerFor(bill, period, active), reason: "", recordedThisMonth };
  });
}

// The words used wherever a bill was changed while someone was working on it (the same as the pause, stop and skip buttons use).
const CHANGED_NOW = (bill: string) => `${bill} changed just now. Check it and try again.`;

// What is said when an "Add it" page would charge someone whose move-out charge stands on the bill (new words: no existing sentence says this).
const CHARGED_ALREADY = (who: string, bill: string) => `${who} already paid their part of ${bill} for this month when they moved out, so they can’t be in this split. Take them out and try again.`;

// An "Add it" page left open: a daily month with move-out charges is looked at again now, after the month is claimed.
//  - The page sent a fingerprint of what it was filled in from (the month's total and the charges standing): if it is not the same now, a charge was
//    added, changed or deleted since, and the page is out of date. A page without one (an older page) is out of date only if its total is not what the
//    month comes to now.
//  - A form that would charge someone whose move-out charge stands is refused.
//  - Someone who changed the total on purpose (a different milk bill) is let through, with the new total shared by the same day-by-day units
//    when the amounts typed no longer add up to it.
// Returns the words of a refusal, or the form to save.
async function checkDailyForm(bill: BillRow, input: SaveExpenseInput, period: string, fp: string | undefined): Promise<{ error: string } | { input: SaveExpenseInput }> {
  const pre = await prepaidFor(bill, period);
  if (!pre.entries.length && !pre.gone.length) return { input }; // no move-out charge this month: nothing here can have changed under the form
  const posted = parseAmount(input.amount, input.currency);
  if (posted === null) return { input }; // (the save says what is wrong with it)
  const monthTotal = dailyTotal(bill, period).amount;
  const worked = Math.max(0, monthTotal - pre.total);
  if (fp === undefined ? posted !== worked : fp !== billFormFingerprint(monthTotal, pre.entries)) return { error: CHANGED_NOW(bill.name) };
  const members = withSettlingLeft(
    await db.member.findMany({ where: { groupId: input.groupId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, splitWeight: true, joinedFrom: true } }),
    await settlingIn(db, input.groupId),
    { dailyMonth: period },
  );
  for (const e of pre.entries) {
    const m = members.find((x) => x.id === e.m);
    if (!m) continue;
    const included =
      input.forMode === "everyone"
        ? !m.leftAt
        : input.forMode === "one"
          ? input.onePersonId === e.m
          : input.forMode === "selected" && input.selected.includes(e.m) && (input.splitType !== "exact" || (parseAmount(input.exact?.[e.m] ?? "", input.currency) ?? 0) > 0);
    if (included) return { error: CHARGED_ALREADY(m.name, bill.name) };
  }
  if (posted !== worked && posted > 0 && input.splitType === "exact") {
    const typed = input.selected.reduce((n, id) => n + (parseAmount(input.exact?.[id] ?? "", input.currency) ?? 0), 0);
    if (typed !== posted) {
      const again = billExpenseInput(bill, input.groupId, input.currency, period, posted, input.paidById, members, { entries: pre.entries, gone: pre.gone });
      if (again.splitType === "exact") return { input: { ...input, forMode: again.forMode, selected: again.selected, splitType: again.splitType, exact: again.exact ?? {}, percent: again.percent ?? {} } };
    }
  }
  return { input };
}

// Why a month of an ended bill can't be added again by hand.
const billEnded = (name: string, period: string) => `${name} has ended, so ${longMonth(period)} can’t be added again here. To count it again, tap Restore on the deleted expense in Activity.`;

// "Enter amount" for a waiting bill month. The month is claimed before the
// expense is saved, so two people entering it at once (or an old tab) can't
// add it twice. A retry of the same form returns what it saved the first time.
export async function addWaitingBill(
  input: SaveExpenseInput,
  actorId: string | undefined,
  lookupRate: Parameters<typeof saveExpense>[2],
  billRun: { billId: string; period: string; fp?: string },
  requestKey: string | undefined,
  attach?: Attach,
): Promise<Awaited<ReturnType<typeof saveExpense>>> {
  const done = await previousResult(requestKey);
  if (done !== null) return { ok: true, id: done };
  // A bill that has ended (stopped and finished, or deleted) can't have a month added again here: the way back is Restore on the deleted expense.
  const bill = await db.bill.findFirst({ where: { id: String(billRun.billId), groupId: input.groupId, deletedAt: null } });
  if (!bill) {
    const ended = await db.bill.findFirst({ where: { id: String(billRun.billId), groupId: input.groupId }, select: { name: true } });
    return { ok: false, error: ended ? billEnded(ended.name, String(billRun.period)) : "That bill no longer exists." };
  }
  const where = { billId: bill.id, period: String(billRun.period) };
  // A month that was deleted and is being added again: the expense it replaces (kept on the month row), written down below in the same step.
  const replaced = (await db.billRun.findFirst({ where: { ...where, status: "waiting", reason: "deleted" }, select: { expenseId: true } }))?.expenseId ?? "";
  // (A month held because it may already have been added is never claimed here: the way out is Skip.)
  // (The bill must still be running at the moment of the claim too: it may have ended since it was read.)
  const claimed = await db.billRun.updateMany({ where: { ...where, status: "waiting", reason: { not: STUCK_HOLD }, bill: { deletedAt: null } }, data: { status: "adding", claimedAt: new Date(), requestKey: requestKey ?? "" } });
  if (claimed.count !== 1) {
    const again = await previousResult(requestKey);
    if (again !== null) return { ok: true, id: again };
    if (await db.bill.findFirst({ where: { id: bill.id, deletedAt: { not: null } }, select: { id: true } })) return { ok: false, error: billEnded(bill.name, where.period) };
    const held = await db.billRun.findFirst({ where: { ...where, status: "waiting", reason: STUCK_HOLD }, select: { id: true } });
    if (held) return { ok: false, error: `${bill.name} for this month is on hold: it may already have been added. Check Activity, then skip it if it was.` };
    return { ok: false, error: `${bill.name} for this month has already been added. You’ll find it in Activity.` };
  }
  const release = () => db.billRun.updateMany({ where: { ...where, status: "adding" }, data: { status: "waiting", requestKey: "" } });
  // A daily month is checked once it is claimed (a charge can't be deleted or added to this month from now on), and the claim is given back if refused.
  if (bill.nature === "daily") {
    const checked = await checkDailyForm(bill, input, where.period, typeof billRun.fp === "string" ? billRun.fp : undefined).catch(async (err) => {
      await release().catch(() => undefined);
      throw err;
    });
    if ("error" in checked) {
      await release();
      return { ok: false, error: checked.error };
    }
    input = checked.input;
  }
  let r: Awaited<ReturnType<typeof saveExpense>>;
  try {
    // A daily month may still name someone settling up only in their own move-out month (the bill's own rule, see runOne); nobody else.
    const mayShare = bill.nature === "daily" ? [...(await settlingIn(db, input.groupId))].filter(([, s]) => s.leftAt.toISOString().slice(0, 7) === where.period).map(([id]) => id) : [];
    r = await saveExpense(input, actorId, lookupRate, { ignoreDoubleTap: true, requestKey, checkDuplicate: true, attach, settlingMayShare: mayShare, alsoInTx: async (tx, id) => noteReplaced(tx, replaced, id) });
  } catch (err) {
    await release().catch(() => undefined);
    throw err;
  }
  if (!r.ok) {
    await release();
    return r;
  }
  // A daily bill added by hand: the move-out charge is credited to whoever paid it, like the automatic one.
  const charges = bill.nature === "daily" && input.paidById ? (await prepaidFor(bill, where.period)).entries : [];
  await db.$transaction(async (tx) => {
    await tx.billRun.updateMany({ where: { ...where, status: "adding" }, data: { status: "added", expenseId: r.id, reason: "", requestKey: "" } });
    await noteReplaced(tx, replaced, r.id);
    await syncChargePayer(tx, input.groupId, charges, input.paidById);
  });
  if (bill.nature === "varies") {
    const e = await db.expense.findUnique({ where: { id: r.id }, select: { amount: true } });
    if (e) await db.bill.update({ where: { id: bill.id }, data: { amount: e.amount } });
  }
  await finishStoppedBill(bill.id).catch(() => false); // the last month of a stopped bill was just added
  return r;
}

// ---------- Stopping a bill ----------
//
// A stop is a pause with an end month (the month it was stopped in). Nothing is charged at the moment of the stop: the days used so far are
// added with the normal monthly bill on the 1st (a paused daily bill still gets that one month, see periodsDue). Once nothing is left to
// add, the stopped bill is finished (deletedAt), exactly like a stopped bill always was.

// Finish a stopped bill that has nothing left to add. Only if it is still exactly as it was read (two people at once change it once).
export async function finishStoppedBill(billId: string, now = new Date()): Promise<boolean> {
  const bill = await db.bill.findUnique({ where: { id: billId }, include: { runs: { select: { period: true, status: true, reason: true } } } });
  if (!bill || bill.deletedAt || !stopDone(bill, bill.runs, now)) return false;
  const done = await db.bill.updateMany({ where: { id: billId, deletedAt: null, paused: true, endMonth: bill.endMonth, pausedAt: bill.pausedAt }, data: { deletedAt: now } });
  return done.count === 1;
}

// A Date that falls on this day in the bill's time zone (the start of a cut that has to begin on a given day).
function dateOnDay(day: string, tz: string, fallback: Date): Date {
  for (const h of [12, 0, 23, 6, 18]) {
    const d = new Date(`${day}T${String(h).padStart(2, "0")}:00:00Z`);
    if (dayKey(d, tz) === day) return d;
  }
  return fallback;
}

// When a pause or stop of a running daily bill starts to cut days: today, unless someone's last day (a move-out charge for "add it now")
// is today or later in this month: that day was charged to them, so the cut starts the day after it and the month end still counts it.
// The cut is never more than one day after today in the bill's own time zone (a last day recorded from a zone ahead cannot push it further).
// (If the move-out is undone after the pause, the cut stays where it was: the days up to it are simply added with the month. Accepted.)
export async function cutAt(bill: { nature: string; tz: string; prepaid: string }, now: Date): Promise<Date> {
  if (bill.nature !== "daily") return now;
  const tz = bill.tz || DEFAULT_TIME_ZONE;
  const today = dayKey(now, tz);
  const list = parsePrepaid(bill.prepaid)[today.slice(0, 7)] ?? [];
  if (!list.length) return now;
  const alive = new Set((await db.expense.findMany({ where: { id: { in: list.map((x) => x.e) }, deletedAt: null }, select: { id: true } })).map((e) => e.id));
  const last = list.filter((x) => alive.has(x.e) && x.d).map((x) => x.d as string).sort().pop();
  if (!last || last < today) return now;
  const dayAfter = (day: string) => new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  const next = [dayAfter(last), dayAfter(today)].sort()[0];
  return dateOnDay(next, tz, now);
}

// The words for pausing or stopping a bill right now (the confirm, and the note on the bill page once it is paused or stopped).
export async function stopWordsFor(billId: string, now = new Date()): Promise<{ words: ReturnType<typeof stopLines>; ended: boolean } | null> {
  const bill = await db.bill.findFirst({ where: { id: billId, deletedAt: null }, include: { group: { include: { members: true } }, runs: { select: { period: true, status: true, reason: true } } } });
  if (!bill) return null;
  const tz = bill.tz || DEFAULT_TIME_ZONE;
  const cur = bill.group.currency;
  // Paused or stopped: the day it was; running: the day the cut would start (today, or the day after a last day already charged).
  const cutDate = bill.paused && bill.pausedAt ? bill.pausedAt : await cutAt(bill, now);
  const day = dayKey(cutDate, tz);
  const month = day.slice(0, 7);
  const cut = { ...bill, paused: true, pausedAt: cutDate };
  // (A month that already has its answer, added or skipped, has nothing more to add.)
  const monthDone = bill.runs.some((r) => r.period === month);
  const days = bill.nature === "daily" && !monthDone ? dailyTotal(cut, month) : { days: 0, amount: 0 };
  const pre = bill.nature === "daily" ? await prepaidFor(bill, month) : { total: 0, entries: [] as Prepaid[] };
  const named = (id: string) => bill.group.members.find((m) => m.id === id)?.name ?? "Someone";
  const less = pre.entries.map((x) => ({ who: named(x.m), money: formatMoney(x.a, cur) }));
  // The month before the cut, if it is due and not added yet (a daily bill only).
  // (It also shows when the cut falls in a later month than today, and for a bill paused or stopped early on the 1st: the month that has just
  // ended is still to come, the job having not run yet.) A bill already paused is looked at as of now, a running one as of the cut.
  let lastMonth: StopWords["lastMonth"] = null;
  if (bill.nature === "daily") {
    const asOf = !bill.paused || month > dayKey(now, tz).slice(0, 7) ? cutDate : now;
    for (const p of periodsDue(bill, asOf)) {
      if (p >= month || bill.runs.some((r) => r.period === p)) continue;
      const lastPre = await prepaidFor(bill, p);
      const amount = Math.max(0, dailyTotal(bill, p).amount - lastPre.total);
      if (amount > 0) lastMonth = { period: p, money: formatMoney(amount, cur) };
    }
  }
  const open = bill.runs.filter((r) => r.status === "waiting" && r.reason !== "deleted").sort((x, y) => x.period.localeCompare(y.period))[0];
  const words = stopLines({
    name: bill.name,
    nature: bill.nature,
    month,
    day: Number(day.slice(8, 10)),
    days: days.days,
    money: formatMoney(days.amount, cur),
    less: pre.total > 0 && days.days > 0 ? less : [],
    lastMonth,
    waiting: open ? { period: open.period, varies: bill.nature === "varies" } : null,
  });
  return { words, ended: isStopped(bill) };
}

export { ordinalDay };
