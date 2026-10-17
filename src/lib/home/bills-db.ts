import { db } from "../db";
import { getRate } from "../rate-cache";
import { saveExpense, type SaveExpenseInput } from "../save-expense";
import { sendPushTo } from "../push";
import { toInputAmount, formatMoney } from "../money";
import { dailyTotal, payerFor, periodsDue, nextDueDay, ordinalDay } from "./bills";
import { addMonths, daysInMonth, dueKey } from "./month";
import { joinWeights } from "./moving";
import { previousResult } from "../once";

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

// How an automatic expense is shared: the group's own split, equally, only
// some, by percentage or by fixed amounts.
export function splitFields(splitJson: string, members: Member[], period?: string, currency = "INR"): Pick<SaveExpenseInput, "forMode" | "selected" | "splitType" | "shares"> & Partial<Pick<SaveExpenseInput, "percent" | "exact">> {
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
export function billExpenseInput(bill: BillRow, groupId: string, currency: string, period: string, amount: number, payerId: string, members: Member[]): SaveExpenseInput {
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
    ...splitFields(bill.split, members, period, currency),
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
  const saved = await previousResult(key);
  if (saved) {
    await db.billRun.update({ where: { id: run.id }, data: { status: "added", expenseId: saved, reason: "" } });
    return "added";
  }
  const active = group.members.filter((m) => !m.leftAt).map((m) => m.id);
  const payer = payerFor(bill, period, active);
  const wait = async (reason: string) => {
    await db.billRun.update({ where: { id: run.id }, data: { status: "waiting", reason, requestKey: "" } });
    return "waiting";
  };
  // An "Enter amount" that never finished: ask for it again.
  if (run.requestKey) return wait("");
  if (group.closed) return wait("group closed");
  if (!payer) return wait("payer left");
  const problem = splitProblem(bill.split, active);
  if (problem) return wait(problem);
  if (bill.nature === "varies") {
    // Ask whoever pays for this month's amount.
    await sendPushTo([payer], {
      title: `🧾 ${bill.name}`,
      body: `${bill.name} is due. Enter the amount when you have the bill.`,
      url: `/groups/${group.id}/add?bill=${bill.id}&period=${period}`,
      tag: `bill-${bill.id}-${period}`,
    });
    return wait("");
  }

  let amount = bill.amount;
  let note = "";
  if (bill.nature === "daily") {
    const d = dailyTotal(bill, period);
    if (d.days <= 0 || bill.amount <= 0) {
      await db.billRun.update({ where: { id: run.id }, data: { status: "skipped", reason: "no days" } });
      return "skipped";
    }
    amount = d.amount;
    note = `${d.days} days × ${formatMoney(bill.amount, group.currency)}`;
  }
  if (amount <= 0) return wait("no amount");

  const input = billExpenseInput(bill, group.id, group.currency, period, amount, payer, group.members);
  if (note) input.notes = note;
  const r = await saveExpense(input, payer, sameCurrencyRate, { now, requestKey: key, eventText: `added ${bill.name} automatically (${formatMoney(amount, group.currency)})` });
  if (!r.ok) return wait(r.error.slice(0, 120));
  await db.billRun.update({ where: { id: run.id }, data: { status: "added", expenseId: r.id } });
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
export async function runAllBills(now = new Date()) {
  const groups = await db.bill.findMany({ where: { deletedAt: null, paused: false, group: { deletedAt: null } }, select: { groupId: true }, distinct: ["groupId"] });
  const total = { groups: groups.length, added: 0, waiting: 0, skipped: 0, failed: 0 };
  for (const g of groups) {
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
};

export async function billStatuses(groupId: string, now = new Date()): Promise<BillStatus[]> {
  const [bills, members] = await Promise.all([
    db.bill.findMany({ where: { groupId, deletedAt: null }, include: { runs: { orderBy: { period: "desc" }, take: 4 } }, orderBy: { createdAt: "asc" } }),
    db.member.findMany({ where: { groupId, leftAt: null }, select: { id: true } }),
  ]);
  const active = members.map((m) => m.id);
  const runExpenseIds = bills.flatMap((b) => b.runs.map((r) => r.expenseId)).filter(Boolean);
  const amounts = new Map(
    (await db.expense.findMany({ where: { id: { in: runExpenseIds }, deletedAt: null }, select: { id: true, amount: true } })).map((e) => [e.id, e.amount]),
  );
  return bills.map((bill) => {
    const { runs, ...b } = bill;
    const waiting = runs.find((r) => r.status === "waiting");
    const past = runs.filter((r) => r.status === "added" && amounts.has(r.expenseId)).map((r) => amounts.get(r.expenseId)!);
    const usual = bill.nature === "varies" && past.length ? Math.round(past.slice(0, 3).reduce((s, a) => s + a, 0) / Math.min(3, past.length)) : null;
    if (waiting) {
      const due = bill.nature === "daily" ? dueKey(waiting.period, "last") : dueKey(waiting.period, bill.day >= 31 ? "last" : bill.day);
      return { bill: b as BillRow, status: "waiting", period: waiting.period, due, usual, payerId: payerFor(bill, waiting.period, active), reason: waiting.reason };
    }
    const next = nextDueDay(bill, now);
    if (bill.paused || !next) return { bill: b as BillRow, status: "paused", period: "", due: "", usual, payerId: null, reason: "" };
    const period = next.slice(0, 7);
    const done = runs.find((r) => r.period === period && (r.status === "added" || r.status === "skipped"));
    // This month's already added → show the next one.
    if (done) {
      const after = nextDueDay({ ...bill, startMonth: bill.startMonth > addMonths(period, 1) ? bill.startMonth : addMonths(period, 1) }, now);
      if (after) return { bill: b as BillRow, status: "upcoming", period: after.slice(0, 7), due: after, usual, payerId: payerFor(bill, after.slice(0, 7), active), reason: "" };
    }
    return { bill: b as BillRow, status: "upcoming", period, due: next, usual, payerId: payerFor(bill, period, active), reason: "" };
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
): Promise<Awaited<ReturnType<typeof saveExpense>>> {
  const done = await previousResult(requestKey);
  if (done !== null) return { ok: true, id: done };
  const bill = await db.bill.findFirst({ where: { id: String(billRun.billId), groupId: input.groupId } });
  if (!bill) return { ok: false, error: "That bill no longer exists." };
  const where = { billId: bill.id, period: String(billRun.period) };
  const claimed = await db.billRun.updateMany({ where: { ...where, status: "waiting" }, data: { status: "adding", claimedAt: new Date(), requestKey: requestKey ?? "" } });
  if (claimed.count !== 1) {
    const again = await previousResult(requestKey);
    if (again !== null) return { ok: true, id: again };
    return { ok: false, error: `${bill.name} for this month has already been added. You’ll find it in Activity.` };
  }
  const release = () => db.billRun.updateMany({ where: { ...where, status: "adding" }, data: { status: "waiting", requestKey: "" } });
  let r: Awaited<ReturnType<typeof saveExpense>>;
  try {
    r = await saveExpense(input, actorId, lookupRate, { ignoreDoubleTap: true, requestKey, checkDuplicate: true });
  } catch (err) {
    await release().catch(() => undefined);
    throw err;
  }
  if (!r.ok) {
    await release();
    return r;
  }
  await db.billRun.updateMany({ where: { ...where, status: "adding" }, data: { status: "added", expenseId: r.id, reason: "", requestKey: "" } });
  if (bill.nature === "varies") {
    const e = await db.expense.findUnique({ where: { id: r.id }, select: { amount: true } });
    if (e) await db.bill.update({ where: { id: bill.id }, data: { amount: e.amount } });
  }
  return r;
}

export { ordinalDay };
