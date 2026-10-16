import { db } from "../db";
import { getRate } from "../rate-cache";
import { saveExpense, type SaveExpenseInput } from "../save-expense";
import { toInputAmount, formatMoney } from "../money";
import { dailyTotal, payerFor, periodsDue, nextDueDay, ordinalDay } from "./bills";
import { addMonths, dueKey } from "./month";

// Recurring bills, database side. The daily job calls runAllBills(); each
// (bill, month) gets one BillRun row — its unique key is what makes adding a
// bill twice impossible, even if the job runs twice at the same moment.

type BillRow = Awaited<ReturnType<typeof db.bill.findMany>>[number];
type Member = { id: string; name: string; leftAt: Date | null; splitWeight: number };

export function parseSplit(json: string): { mode: "group" | "equal" | "some"; ids: string[] } {
  try {
    const v = JSON.parse(json);
    const mode = v?.mode === "equal" || v?.mode === "some" ? v.mode : "group";
    return { mode, ids: Array.isArray(v?.ids) ? v.ids.filter((x: unknown) => typeof x === "string") : [] };
  } catch {
    return { mode: "group", ids: [] };
  }
}

// The expense a bill becomes (also used to prefill "Enter amount").
export function billExpenseInput(bill: BillRow, groupId: string, currency: string, period: string, amount: number, payerId: string, members: Member[]): SaveExpenseInput {
  const active = members.filter((m) => !m.leftAt);
  const split = parseSplit(bill.split);
  const some = split.mode === "some" ? active.filter((m) => split.ids.includes(m.id)).map((m) => m.id) : [];
  const groupSplit = split.mode === "group" && active.some((m) => m.splitWeight !== active[0].splitWeight);
  const day = bill.nature === "daily" ? dueKey(period, "last") : dueKey(period, bill.day >= 31 ? "last" : bill.day);
  return {
    groupId,
    name: bill.name,
    category: bill.category,
    amount: toInputAmount(amount, currency),
    currency,
    paidById: payerId,
    forMode: some.length ? "selected" : "everyone",
    selected: some,
    onePersonId: "",
    splitType: groupSplit ? "shares" : "equal",
    shares: groupSplit ? Object.fromEntries(active.map((m) => [m.id, String(m.splitWeight / 100)])) : undefined,
    exact: {},
    percent: {},
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

// Turn one due (bill, month) into an expense, once.
async function runOne(bill: BillRow, group: { id: string; currency: string; closed: boolean; members: Member[] }, period: string, now: Date) {
  // Claim the month first. If someone else already did, there's nothing to do.
  let run;
  try {
    run = await db.billRun.create({ data: { billId: bill.id, period, status: "adding" } });
  } catch {
    return "already";
  }
  const active = group.members.filter((m) => !m.leftAt).map((m) => m.id);
  const payer = payerFor(bill, period, active);
  const wait = async (reason: string) => {
    await db.billRun.update({ where: { id: run.id }, data: { status: "waiting", reason } });
    return "waiting";
  };
  if (group.closed) return wait("group closed");
  if (!payer) return wait("payer left");
  if (bill.nature === "varies") return wait("");

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
  const r = await saveExpense(input, payer, sameCurrencyRate, { now, requestKey: `bill-${run.id}`, eventText: `added ${bill.name} automatically (${formatMoney(amount, group.currency)})` });
  if (!r.ok) return wait(r.error.slice(0, 120));
  await db.billRun.update({ where: { id: run.id }, data: { status: "added", expenseId: r.id } });
  return "added";
}

// Every bill of one group that's due now.
export async function runBillsForGroup(groupId: string, now = new Date()) {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, splitWeight: true } } },
  });
  const counts = { added: 0, waiting: 0, skipped: 0 };
  if (!group || group.deletedAt) return counts;
  const bills = await db.bill.findMany({ where: { groupId, deletedAt: null, paused: false } });
  for (const bill of bills) {
    for (const period of periodsDue(bill, now)) {
      const r = await runOne(bill, group, period, now);
      if (r === "added") counts.added++;
      else if (r === "waiting") counts.waiting++;
      else if (r === "skipped") counts.skipped++;
    }
  }
  return counts;
}

// The daily job: every group that has bills.
export async function runAllBills(now = new Date()) {
  const groups = await db.bill.findMany({ where: { deletedAt: null, paused: false, group: { deletedAt: null } }, select: { groupId: true }, distinct: ["groupId"] });
  const total = { groups: groups.length, added: 0, waiting: 0, skipped: 0 };
  for (const g of groups) {
    const c = await runBillsForGroup(g.groupId, now);
    total.added += c.added;
    total.waiting += c.waiting;
    total.skipped += c.skipped;
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
    const done = runs.find((r) => r.period === period && r.status === "added");
    // This month's already added → show the next one.
    if (done) {
      const after = nextDueDay({ ...bill, startMonth: bill.startMonth > addMonths(period, 1) ? bill.startMonth : addMonths(period, 1) }, now);
      if (after) return { bill: b as BillRow, status: "upcoming", period: after.slice(0, 7), due: after, usual, payerId: payerFor(bill, after.slice(0, 7), active), reason: "" };
    }
    return { bill: b as BillRow, status: "upcoming", period, due: next, usual, payerId: payerFor(bill, period, active), reason: "" };
  });
}

// "Enter amount" saved: the waiting month becomes added.
export async function markRunAdded(billId: string, period: string, expenseId: string) {
  await db.billRun.updateMany({ where: { billId, period, status: "waiting" }, data: { status: "added", expenseId, reason: "" } });
  await db.bill.updateMany({ where: { id: billId, nature: "varies" }, data: { amount: (await db.expense.findUnique({ where: { id: expenseId }, select: { amount: true } }))?.amount ?? 0 } });
}

export { ordinalDay };
