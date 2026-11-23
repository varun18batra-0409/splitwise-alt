import { db } from "../db";
import { getRate } from "../rate-cache";
import { saveExpense, type Attach, type SaveExpenseInput } from "../save-expense";
import { sendPushTo } from "../push";
import { askBill } from "./bill-asks";
import { toInputAmount, formatMoney } from "../money";
import { dailyTotal, dayRangeLabel, monthSoFar, monthsBetween, payerFor, periodsDue, nextDueDay, ordinalDay } from "./bills";
import { allocateByWeights } from "../split";
import { addMonths, daysInMonth, dueKey } from "./month";
import { noteReplaced } from "./bill-run-link";
import { addPrepaid, joinWeights, lastPartDay, parsePrepaid, type Prepaid } from "./moving";
import { niceDate } from "../format";
import { dayKey, DEFAULT_TIME_ZONE } from "../dates";
import { previousResult } from "../once";
import { logEvent, touchedByExpense } from "../events";
import { REPEAT_BILL_MARK } from "../membership";
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
  if (closed) return "group closed";
  if (!payer) return "payer left";
  const problem = splitProblem(bill.split, activeIds);
  if (problem) return problem;
  if (bill.nature === "fixed" && bill.amount <= 0) return "no amount";
  return saved && !RECOMPUTABLE_HOLDS.includes(saved) ? saved : "";
}

// How an automatic expense is shared: the group's own split, equally, only
// some, by percentage or by fixed amounts.
// `range`: only the days from..to of the month are being added (a part charge, or the days after one); someone who moved in
// part-way is weighted by the exact days they were there, as amounts (shares allow at most 20, a month has up to 31 days).
export type DayRange = { from: number; to: number; amount: number };
export function splitFields(splitJson: string, members: Member[], period?: string, currency = "INR", range?: DayRange): Pick<SaveExpenseInput, "forMode" | "selected" | "splitType" | "shares"> & Partial<Pick<SaveExpenseInput, "percent" | "exact">> {
  const active = members.filter((m) => !m.leftAt);
  const split = parseSplit(splitJson);
  if (split.mode === "percent") {
    const ids = Object.keys(split.pct);
    return { forMode: "selected", selected: ids, splitType: "percent", percent: Object.fromEntries(ids.map((id) => [id, String(split.pct[id] / 100)])), exact: {} };
  }
  if (split.mode === "amounts") {
    const ids = Object.keys(split.amt);
    return { forMode: "selected", selected: ids, splitType: "exact", exact: Object.fromEntries(ids.map((id) => [id, toInputAmount(split.amt[id], currency)])), percent: {} };
  }
  const some = split.mode === "some" ? active.filter((m) => split.ids.includes(m.id)).map((m) => m.id) : [];
  if (range && period && split.mode !== "some") {
    const base = (m: Member) => (split.mode === "group" ? m.splitWeight : 100);
    const w = joinWeights(active.map((m) => ({ id: m.id, splitWeight: base(m), joinedFrom: m.joinedFrom ?? null })), period, range);
    // Always the days of the range (never the whole month's weights): someone who moved in on the 15th and a range of 20-30 Nov is weighted for 11 days, as the others are.
    const parts = allocateByWeights(range.amount, active.map((m) => ({ memberId: m.id, weight: w[m.id] })));
    if (parts.length) {
      return { forMode: "selected", selected: parts.map((p) => p.memberId), splitType: "exact", exact: Object.fromEntries(parts.map((p) => [p.memberId, toInputAmount(p.amount, currency)])), percent: {} };
    }
  }
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
export function billExpenseInput(bill: BillRow, groupId: string, currency: string, period: string, amount: number, payerId: string, members: Member[], range?: DayRange): SaveExpenseInput {
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
    ...splitFields(bill.split, members, period, currency, range),
    paymentMethod: "cash",
    markupChoice: "group",
    markupCustom: "",
    rateMode: "auto",
    manualRate: "",
    date: day,
    notes: bill.nature === "daily" ? "" : undefined,
  };
}

const sameCurrencyRate = async (from: string, to: string) =>
  from === to ? { ok: true as const, rate: "1", date: new Date().toISOString().slice(0, 10) } : getRate(from, to);

// What a leaver already paid for a daily bill's month at move-out (their share of the days they were
// there). Each charge counts for what it is NOW (edited since: the new amount) and only while its expense
// exists and isn't deleted; the month-end bill takes that off, so nobody pays twice.
export async function prepaidFor(bill: { prepaid: string }, period: string): Promise<{ total: number; entries: Prepaid[] }> {
  const list = parsePrepaid(bill.prepaid)[period] ?? [];
  if (!list.length) return { total: 0, entries: [] };
  const now = new Map((await db.expense.findMany({ where: { id: { in: list.map((x) => x.e) }, deletedAt: null }, select: { id: true, amount: true } })).map((e) => [e.id, e.amount]));
  const entries = list.filter((x) => now.has(x.e)).map((x) => ({ ...x, a: now.get(x.e)! }));
  return { total: entries.reduce((n, x) => n + x.a, 0), entries };
}

// The month-end daily bill is paid by that month's payer, so the move-out charge (which only the leaver shares)
// is credited to that same person: the payer ends up credited for the whole month. Shares don't change.
// A short line goes in the history for each charge that changes payer ("Asha now paid Milk · 1–14 Nov"), so nothing moves silently.
export async function syncChargePayer(tx: Prisma.TransactionClient, groupId: string, allEntries: Prepaid[], payer: string): Promise<void> {
  // A pause or stop charge is locked: it stays paid by whoever paid it. Only move-out charges follow the month's payer.
  const entries = allEntries.filter((x) => x.k !== "part");
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

// Turn one due (bill, month) into an expense, once.
async function runOne(bill: BillRow, group: { id: string; currency: string; closed: boolean; members: Member[] }, period: string, now: Date) {
  // Claim the month first. If someone else already did, there's nothing to do.
  const run = await claimRun(bill.id, period, now);
  if (!run) return "already";
  const key = run.requestKey || `bill-${run.id}`;
  // Taking over a crashed run: if its expense was saved after all, just finish.
  const active = group.members.filter((m) => !m.leftAt).map((m) => m.id);
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
    await db.billRun.update({ where: { id: run.id }, data: { status: "waiting", reason, requestKey: "" } });
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
  let range: DayRange | undefined;
  if (bill.nature === "daily") {
    const d = dailyTotal(bill, period);
    if (d.days <= 0 || bill.amount <= 0) {
      await db.billRun.update({ where: { id: run.id }, data: { status: "skipped", reason: "no days" } });
      return "skipped";
    }
    // Someone who moved out part-way through this month already paid their share of the days they were there.
    const pre = await prepaidFor(bill, period);
    charges = pre.entries;
    amount = d.amount - pre.total;
    if (pre.total > 0 && amount <= 0) {
      await db.billRun.update({ where: { id: run.id }, data: { status: "skipped", reason: "covered" } });
      return "skipped";
    }
    note = `${d.days} days × ${formatMoney(bill.amount, group.currency)}`;
    // After a part charge (a pause or stop earlier this month) only the days after it are being added: weight people by those days.
    const covered = lastPartDay(pre.entries);
    if (covered > 0) range = { from: covered + 1, to: daysInMonth(period), amount };
    let partEnd = 0;
    for (const x of pre.entries) {
      if (x.k === "part") {
        const end = Number((x.d ?? "").slice(8, 10)) || 1;
        note += `, less ${formatMoney(x.a, group.currency)} already added for ${dayRangeLabel(period, partEnd + 1, end)}`; // from the day after the part charge before it
        partEnd = end;
        continue;
      }
      note += `, less ${formatMoney(x.a, group.currency)} ${group.members.find((m) => m.id === x.m)?.name ?? "someone"}’s share${x.d ? ` (moved out ${niceDate(x.d)})` : ""}`;
    }
  }
  if (amount <= 0) return wait("no amount");

  const input = billExpenseInput(bill, group.id, group.currency, period, amount, payer, group.members, range);
  if (note) input.notes = note;
  const r = await saveExpense(input, payer, sameCurrencyRate, { now, requestKey: key, eventText: `paid ${bill.name} (${formatMoney(amount, group.currency)}) ${REPEAT_BILL_MARK}` });
  if (!r.ok) return wait(r.error.slice(0, 120));
  // Added, and in the same step the move-out charge is credited to this month's payer.
  await db.$transaction(async (tx) => {
    await tx.billRun.update({ where: { id: run.id }, data: { status: "added", expenseId: r.id } });
    await syncChargePayer(tx, group.id, charges, payer);
  });
  return "added";
}

// Every bill of one group that's due now.
export async function runBillsForGroup(groupId: string, now = new Date()) {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, splitWeight: true, joinedFrom: true } } },
  });
  const counts = { added: 0, waiting: 0, skipped: 0, failed: 0 };
  if (!group || group.deletedAt) return counts;
  const bills = await db.bill.findMany({ where: { groupId, deletedAt: null, paused: false } });
  for (const bill of bills) {
    for (const period of periodsDue(bill, now)) {
      // One bill failing (a dropped connection) mustn't stop the others; its
      // claim goes stale and the next run finishes it.
      const r = await runOne(bill, group, period, now).catch((err) => {
        console.error("bill run failed", bill.id, period, String(err).slice(0, 200));
        return "failed" as const;
      });
      if (r === "failed") counts.failed++;
      else if (r === "added") counts.added++;
      else if (r === "waiting") counts.waiting++;
      else if (r === "skipped") counts.skipped++;
    }
  }
  return counts;
}

// The daily job: every group that has bills.
export async function runAllBills(now = new Date(), stop: () => boolean = () => false) {
  const groups = await db.bill.findMany({ where: { deletedAt: null, paused: false, group: { deletedAt: null } }, select: { groupId: true }, distinct: ["groupId"] });
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
    db.member.findMany({ where: { groupId, leftAt: null }, select: { id: true } }),
    db.group.findUnique({ where: { id: groupId }, select: { closed: true } }),
  ]);
  const closed = Boolean(grp?.closed);
  const active = members.map((m) => m.id);
  const runExpenseIds = bills.flatMap((b) => b.runs.map((r) => r.expenseId)).filter(Boolean);
  const amounts = new Map(
    (await db.expense.findMany({ where: { id: { in: runExpenseIds }, deletedAt: null }, select: { id: true, amount: true } })).map((e) => [e.id, e.amount]),
  );
  return bills.map((bill) => {
    const { runs, ...b } = bill;
    const thisMonth = dayKey(now, bill.tz || DEFAULT_TIME_ZONE).slice(0, 7);
    const recordedThisMonth = runs.some((r) => r.period === thisMonth && r.status === "added");
    const waiting = runs.find((r) => r.status === "waiting" && r.reason !== "deleted"); // a deleted month shows only on the bill page ("Deleted · Add it again")
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
      const after = nextDueDay({ ...bill, startMonth: bill.startMonth > addMonths(period, 1) ? bill.startMonth : addMonths(period, 1) }, now);
      if (after) return { bill: b as BillRow, status: "upcoming", period: after.slice(0, 7), due: after, usual, payerId: payerFor(bill, after.slice(0, 7), active), reason: "", recordedThisMonth };
    }
    return { bill: b as BillRow, status: "upcoming", period, due: next, usual, payerId: payerFor(bill, period, active), reason: "", recordedThisMonth };
  });
}

// "Enter amount" for a waiting bill month. The month is claimed before the
// expense is saved, so two people entering it at once (or an old tab) can't
// add it twice. A retry of the same form returns what it saved the first time.
export async function addWaitingBill(
  input: SaveExpenseInput,
  actorId: string | undefined,
  lookupRate: Parameters<typeof saveExpense>[2],
  billRun: { billId: string; period: string },
  requestKey: string | undefined,
  attach?: Attach,
): Promise<Awaited<ReturnType<typeof saveExpense>>> {
  const done = await previousResult(requestKey);
  if (done !== null) return { ok: true, id: done };
  const bill = await db.bill.findFirst({ where: { id: String(billRun.billId), groupId: input.groupId } });
  if (!bill) return { ok: false, error: "That bill no longer exists." };
  const where = { billId: bill.id, period: String(billRun.period) };
  // A month that was deleted and is being added again: the expense it replaces (kept on the month row), written down below in the same step.
  const replaced = (await db.billRun.findFirst({ where: { ...where, status: "waiting", reason: "deleted" }, select: { expenseId: true } }))?.expenseId ?? "";
  const claimed = await db.billRun.updateMany({ where: { ...where, status: "waiting" }, data: { status: "adding", claimedAt: new Date(), requestKey: requestKey ?? "" } });
  if (claimed.count !== 1) {
    const again = await previousResult(requestKey);
    if (again !== null) return { ok: true, id: again };
    return { ok: false, error: `${bill.name} for this month has already been added. You’ll find it in Activity.` };
  }
  const release = () => db.billRun.updateMany({ where: { ...where, status: "adding" }, data: { status: "waiting", requestKey: "" } });
  let r: Awaited<ReturnType<typeof saveExpense>>;
  try {
    r = await saveExpense(input, actorId, lookupRate, { ignoreDoubleTap: true, requestKey, checkDuplicate: true, attach, alsoInTx: async (tx, id) => noteReplaced(tx, replaced, id) });
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
  return r;
}

// ---------- Pausing or stopping a daily bill: the month so far is added first ----------
//
// Milk at ₹60 a day, stopped on 20 Nov: 1–19 Nov (19 × 6,000 = 114,000) is added now as one expense, shared like the bill
// is shared, so the days that came are never lost. It is written down on the bill as a "part" charge (the same record a
// move-out charge uses), so the month-end bill takes it off, and the days it covers can't change any more.

type GroupForBill = { id: string; currency: string; closed: boolean; members: Member[] };
class PartChanged extends Error {}
class PartRefused extends Error {}

// A pause or stop charge and a move-out charge never share a month: while anyone's move-out (their last day) falls in this month,
// a daily bill can't be paused or stopped (the days it didn't come are marked instead). Moving out is refused the other way round.
export const MOVED_OUT_THIS_MONTH = (bill: string) => `Someone moved out this month, so ${bill} can’t be paused or stopped until next month. Mark the days it didn’t come instead.`;
export async function movedOutIn(client: Pick<Prisma.TransactionClient, "member">, groupId: string, period: string): Promise<boolean> {
  const from = new Date(`${period}-01T00:00:00Z`);
  const to = new Date(`${addMonths(period, 1)}-01T00:00:00Z`);
  return (await client.member.count({ where: { groupId, leftAt: { gte: from, lt: to } } })) > 0;
}

export const monthLongName = (period: string) => new Date(`${period}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
const money = (n: number, currency: string) => formatMoney(n, currency);

export const partChangedText = (bill: string, amount: number, currency: string) => `${bill} changed since you opened this. It now adds ${money(amount, currency)}. Check and try again.`;

// What the month so far comes to for this bill right now (the same numbers the confirm shows and the server uses).
export async function monthSoFarOf(bill: BillRow, period: string, until: string) {
  const pre = await prepaidFor(bill, period);
  return { pre, m: monthSoFar(bill, period, until, pre.entries) };
}

// Before a pause or stop: last month's bill, if it is due and not added yet, is added the normal way first. Returns a refusal
// text if it can't be (the person is told what to fix), else "".
export async function catchUpLastMonth(bill: BillRow, group: GroupForBill, now: Date, verb: string): Promise<string> {
  for (const period of periodsDue(bill, now)) await runOne(bill, group, period, now);
  const waiting = await db.billRun.findFirst({ where: { billId: bill.id, status: "waiting", reason: { not: "deleted" } }, orderBy: { period: "asc" } });
  if (!waiting) return "";
  return `${bill.name} for ${monthLongName(waiting.period)} is waiting to be added, so it can’t be ${verb} yet. Open it in the Bills tab, sort that out, then try again.`;
}

// This month already has its own answer (skipped, added, being added...): a pause or stop then adds nothing for it. Only a month
// that waits because its expense was deleted may still get the days so far.
export async function monthSettled(client: Pick<typeof db, "billRun">, billId: string, period: string): Promise<boolean> {
  const run = await client.billRun.findUnique({ where: { billId_period: { billId, period } }, select: { status: true, reason: true } });
  return Boolean(run) && !(run!.status === "waiting" && run!.reason === "deleted");
}

// A daily bill paused before part charges existed, in a month before this one, whose days before the pause were never added.
// (Resume and Stop add them first.) `from` = the day it was paused.
// `kept` is false when the pause month is older than the months the app keeps working with (KEPT_MONTHS, like the 36-month sweep that
// closes old months on Start again): its days are then not added automatically, and the confirm says so.
export const KEPT_MONTHS = 36;
export const notAddedText = (period: string) => `Days before the pause in ${monthLongName(period)} aren’t added automatically.`;
export async function legacyPauseMonth(bill: BillRow, now: Date, upTo: "last-1" | "this"): Promise<{ period: string; from: string; kept: boolean } | null> {
  if (bill.nature !== "daily" || !bill.paused || !bill.pausedAt) return null;
  const tz = bill.tz || DEFAULT_TIME_ZONE;
  const from = dayKey(bill.pausedAt, tz);
  const pm = from.slice(0, 7);
  const thisMonth = dayKey(now, tz).slice(0, 7);
  const limit = upTo === "this" ? thisMonth : addMonths(thisMonth, -1);
  if (!(pm < limit) || pm < bill.startMonth) return null;
  if (await db.billRun.findUnique({ where: { billId_period: { billId: bill.id, period: pm } } })) return null;
  if ((parsePrepaid(bill.prepaid)[pm] ?? []).some((x) => x.k === "part")) return null;
  return { period: pm, from, kept: monthsBetween(pm, thisMonth) <= KEPT_MONTHS };
}

type PartResult = { ok: true; amount: number; added: boolean } | { ok: false; error: string };

// Adds the month so far (if there is any) and, in the very same transaction, runs `finish` (pause / stop / resume the bill).
// Nothing is written if anything is wrong: no payer, a split that can't work, a closed group, or the bill changed since it was read.
export async function addMonthSoFar(
  bill: BillRow,
  group: GroupForBill,
  o: { period: string; until: string; verb: string; actorId: string; now: Date; expect?: number | null; finish: (tx: Prisma.TransactionClient) => Promise<void>; refuse?: (tx: Prisma.TransactionClient) => Promise<string | null> },
): Promise<PartResult> {
  // This month was skipped or already added: nothing is added for it, the bill is only paused or stopped.
  if (await monthSettled(db, bill.id, o.period)) {
    if (o.expect != null && o.expect !== 0) return { ok: false, error: partChangedText(bill.name, 0, group.currency) };
    await db.$transaction((tx) => o.finish(tx));
    return { ok: true, amount: 0, added: false };
  }
  const { pre, m } = await monthSoFarOf(bill, o.period, o.until);
  if (o.expect != null && o.expect !== m.amount) return { ok: false, error: partChangedText(bill.name, m.amount, group.currency) };
  if (m.amount <= 0) {
    await db.$transaction((tx) => o.finish(tx));
    return { ok: true, amount: 0, added: false };
  }
  const label = dayRangeLabel(o.period, m.fromDay, m.lastDay);
  const active = group.members.filter((m2) => !m2.leftAt).map((m2) => m2.id);
  const payer = payerFor(bill, o.period, active);
  if (!payer) return { ok: false, error: `${bill.name} needs a payer before it can be ${o.verb}, so ${label} can be added. Pick who pays below.` };
  if (group.closed) return { ok: false, error: `${bill.name} can’t be ${o.verb} while the group is closed, because ${label} still has to be added.` };
  const problem = splitProblem(bill.split, active);
  if (problem) return { ok: false, error: `${bill.name}’s split needs fixing (${problem}) before it can be ${o.verb}, so ${label} can be added. Fix it below.` };

  const input = billExpenseInput(bill, group.id, group.currency, o.period, m.amount, payer, group.members, { from: lastPartDay(pre.entries) + 1, to: m.toDay, amount: m.amount } /* the same person-days rule as the month-end bill (joinWeights) */);
  input.name = `${bill.name} · ${label}`;
  input.date = `${o.period}-${String(m.toDay).padStart(2, "0")}`;
  let note = `${m.days} days × ${money(bill.amount, group.currency)}`;
  const after = pre.entries.slice(pre.entries.map((x) => x.k).lastIndexOf("part") + 1).filter((x) => x.k !== "part");
  for (const x of after) note += `, less ${money(x.a, group.currency)} already charged when ${group.members.find((m2) => m2.id === x.m)?.name ?? "someone"} moved out`;
  input.notes = note;
  let wrote = false;
  let r: Awaited<ReturnType<typeof saveExpense>>;
  // The same request again (a double tap, two phones) finds its expense by this key. Part charges can never be deleted, so it is never stale.
  const key = `bill-part-${bill.id}-${o.period}-${m.toDay}`;
  try {
    r = await saveExpense(input, payer, sameCurrencyRate, {
      now: o.now,
      requestKey: key,
      eventText: `paid ${bill.name} for ${label} (${money(m.amount, group.currency)}) ${REPEAT_BILL_MARK}`,
      alsoInTx: async (tx, expenseId) => {
        // Read again here, in the write: if the days that didn't come, the charges, the price, the split or the pause changed, nothing is added.
        const why = await o.refuse?.(tx); // (someone moved out in the gap)
        if (why) throw new PartRefused(why);
        const cur = await tx.bill.findUnique({ where: { id: bill.id } });
        if (await monthSettled(tx as unknown as typeof db, bill.id, o.period)) throw new PartChanged(); // skipped or added in the gap
        if (!cur || cur.deletedAt || cur.missed !== bill.missed || cur.prepaid !== bill.prepaid || cur.amount !== bill.amount || cur.split !== bill.split || cur.paused !== bill.paused) throw new PartChanged();
        await tx.bill.update({ where: { id: bill.id }, data: { prepaid: addPrepaid(cur.prepaid, o.period, { m: "", a: m.amount, e: expenseId, d: input.date, k: "part" }) } });
        await o.finish(tx);
        wrote = true;
      },
    });
  } catch (err) {
    if (err instanceof PartRefused) return { ok: false, error: err.message };
    if (err instanceof PartChanged) return { ok: false, error: `${bill.name} changed since you opened this. Check and try again.` };
    throw err;
  }
  if (!r.ok) return { ok: false, error: r.error };
  // The same request again (a double tap, or two phones at once): the expense is already there, so only finish (it can run twice safely).
  if (!wrote) await db.$transaction((tx) => o.finish(tx));
  return { ok: true, amount: m.amount, added: wrote };
}

// The one line the confirm shows before a pause, stop or start-again of a daily bill ("This adds Milk for 1–19 Nov, ₹1,140."),
// and the amount the server must still work out the same (`expect`). null = nothing would be added.
export type AddsLine = { amount: number; line: string };
export async function billChangeLines(billId: string, now = new Date()): Promise<{ stop: AddsLine | null; resume: AddsLine | null; refused: string | null } | null> {
  const bill = await db.bill.findFirst({ where: { id: billId, deletedAt: null }, include: { group: { include: { members: true } } } });
  if (!bill || bill.nature !== "daily") return null;
  const tz = bill.tz || DEFAULT_TIME_ZONE;
  const cur = bill.group.currency;
  const today = dayKey(now, tz);
  const period = today.slice(0, 7);
  const pausedDay = bill.paused && bill.pausedAt ? dayKey(bill.pausedAt, tz) : "";
  const named = (id: string) => bill.group.members.find((x) => x.id === id)?.name ?? "someone";
  const item = (p: string, m: ReturnType<typeof monthSoFar>, entries: Prepaid[]) => {
    const after = entries.slice(entries.map((x) => x.k).lastIndexOf("part") + 1).filter((x) => x.k !== "part");
    const less = after.length === 0 ? "" : `, after ${money(m.less, cur)} already charged ${after.length === 1 ? `when ${named(after[0].m)} moved out` : "at move-out"}`;
    return `${bill.name} for ${dayRangeLabel(p, m.fromDay, m.lastDay)}, ${money(m.amount, cur)}${less}`;
  };
  // Stop (or pause): last month first if it is due and not added yet, then the month so far.
  const items: string[] = [];
  if (!bill.paused) {
    for (const p of periodsDue(bill, now)) {
      if (await db.billRun.findUnique({ where: { billId_period: { billId: bill.id, period: p } } })) continue;
      const pre = await prepaidFor(bill, p);
      const amount = Math.max(0, dailyTotal(bill, p).amount - pre.total);
      if (amount > 0) items.push(`${bill.name} for ${monthLongName(p)}, ${money(amount, cur)}`);
    }
  }
  // A month that was skipped or already added gets nothing for the month so far (only the pause or stop happens).
  const { pre, m } = await monthSoFarOf(bill, period, pausedDay && pausedDay < today ? pausedDay : today);
  const settled = await monthSettled(db, bill.id, period);
  let stop: AddsLine | null = null;
  let stopAmount = 0;
  // A bill paused before this release, in an earlier month: its days before the pause are added first (Stop does it, like Start again).
  const legacy = await legacyPauseMonth(bill, now, "this");
  let note = "";
  if (legacy && !legacy.kept) {
    note = ` ${notAddedText(legacy.period)}`;
  } else if (legacy) {
    const l = await monthSoFarOf(bill, legacy.period, legacy.from);
    if (l.m.amount > 0) {
      items.push(`${item(legacy.period, l.m, l.pre.entries)} (from before it was paused)`);
      stopAmount = l.m.amount;
    }
  } else if (!settled && m.amount > 0) {
    items.push(item(period, m, pre.entries));
    stopAmount = m.amount;
  }
  if (items.length || note) stop = { amount: stopAmount, line: `${items.length ? `This adds ${items.join(", then ")}.` : ""}${note}`.trim() };
  // Start again: a bill paused before part charges existed gets the days before its pause now.
  let resume: AddsLine | null = null;
  if (bill.paused && pausedDay) {
    const old = await legacyPauseMonth(bill, now, "last-1");
    if (old && !old.kept) resume = { amount: 0, line: notAddedText(old.period) };
    else if (old) {
      const r = await monthSoFarOf(bill, old.period, old.from);
      if (r.m.amount > 0) resume = { amount: r.m.amount, line: `Starting again adds ${item(old.period, r.m, r.pre.entries)} (from before it was paused).` };
    }
  }
  // Someone moved out this month: a running bill can't be paused or stopped now (the confirm and the page say so, the server refuses).
  const refused = !bill.paused && (await movedOutIn(db, bill.groupId, period)) ? MOVED_OUT_THIS_MONTH(bill.name) : null;
  if (refused) stop = { amount: 0, line: refused };
  return { stop, resume, refused };
}

export { ordinalDay };
