import { db } from "../db";
import { logEvent, expenseState } from "../events";
import { netBalances } from "../balances";
import { formatMoney, parseAmount } from "../money";
import { claimKey, isDuplicateKey, previousResult } from "../once";
import { niceDate } from "../format";
import { addMonths, daysInMonth } from "./month";
import { DEFAULT_TIME_ZONE, dayKey } from "../dates";
import { depositRefunds, leaverPayments, proRataShares } from "./moving";
import type { Transfer } from "../settle";

// Moving out, the deposit — database side.

type Fail = { ok: false; error: string };

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

function plan(flat: Flat, leaverId: string, lastDay: string, bills: BillExpense[]) {
  const month = lastDay.slice(0, 7);
  const monthDays = daysInMonth(month);
  const daysStayed = Number(lastDay.slice(8, 10));
  const resplit = bills.map(({ e, period }) => {
    const days = period === month ? daysStayed : 0;
    // What's freed goes to the others the way this expense was already shared.
    const weights = Object.fromEntries(e.shares.map((x) => [x.memberId, x.amount]));
    return { e, period, days, monthDays: daysInMonth(period), shares: proRataShares(e.shares, leaverId, days, daysInMonth(period), weights) };
  });
  const credit = resplit.reduce(
    (s, r) => s + (r.e.shares.find((x) => x.memberId === leaverId)?.amount ?? 0) - (r.shares.find((x) => x.memberId === leaverId)?.amount ?? 0),
    0,
  );
  const ids = flat.members.map((m) => m.id);
  const before = netBalances(ids, flat.expenses, flat.payments);
  const after = netBalances(
    ids,
    flat.expenses.map((e) => resplit.find((r) => r.e.id === e.id) ? { ...e, shares: resplit.find((r) => r.e.id === e.id)!.shares } : e),
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

export async function moveOutPreview(groupId: string, leaverId: string, lastDay: string, now = new Date()) {
  const flat = await loadFlat(groupId);
  if (!flat || flat.deletedAt) return { ok: false, error: "This group no longer exists." } as Fail;
  if (!flat.members.some((m) => m.id === leaverId && !m.leftAt)) return { ok: false, error: "That person isn’t in the flat." } as Fail;
  const bad = checkDay(lastDay, now);
  if (bad) return { ok: false, error: bad } as Fail;
  const bills = await billExpensesFor(flat, leaverId, lastDay.slice(0, 7));
  const p = plan(flat, leaverId, lastDay, bills);
  const dep = flat.deposit?.shares.find((s) => s.memberId === leaverId && s.status === "held") ?? null;
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
    daysStayed: p.daysStayed,
    monthDays: p.monthDays,
    deposit: dep ? { amount: dep.amount, heldBy: flat.deposit!.heldBy } : null,
  };
}

export async function moveOut(
  groupId: string,
  actorId: string,
  input: { leaverId: string; lastDay: string; depositTo?: string; requestKey: string },
  now = new Date(),
): Promise<{ ok: true; payments: Transfer[] } | Fail> {
  if ((await previousResult(input.requestKey)) !== null) return { ok: true, payments: [] };
  const flat = await loadFlat(groupId);
  if (!flat || flat.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!flat.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can do this." };
  const leaver = flat.members.find((m) => m.id === input.leaverId && !m.leftAt);
  if (!leaver) return { ok: false, error: "That person isn’t in the flat." };
  const bad = checkDay(input.lastDay, now);
  if (bad) return { ok: false, error: bad };
  const others = flat.members.filter((m) => !m.leftAt && m.id !== leaver.id);
  if (!others.length) return { ok: false, error: "Someone has to stay in the flat." };
  const depositTo = input.depositTo && others.some((m) => m.id === input.depositTo) ? input.depositTo : "";

  const bills = await billExpensesFor(flat, leaver.id, input.lastDay.slice(0, 7));
  const p = plan(flat, leaver.id, input.lastDay, bills);
  const name = (id: string) => flat.members.find((m) => m.id === id)?.name ?? "Someone";
  const money = (n: number) => formatMoney(n, flat.currency);
  const heir = others.find((m) => m.id === actorId)?.id ?? others[0].id;

  try {
    await db.$transaction(async (tx) => {
      await claimKey(tx, input.requestKey, "moved");
      // 1. Bills: their share only for the days they stayed (none for later months).
      for (const r of p.resplit) {
        await tx.expenseShare.deleteMany({ where: { expenseId: r.e.id } });
        await tx.expense.update({ where: { id: r.e.id }, data: { splitType: "exact", forMode: "selected", editedAt: new Date(), shares: { create: r.shares } } });
        await logEvent(tx, {
          groupId,
          actorId,
          kind: "expense_edited",
          text: `changed ${r.e.description}`,
          details: [`${leaver.name}’s share: ${money(r.e.shares.find((s) => s.memberId === leaver.id)?.amount ?? 0)} → ${money(r.shares.find((s) => s.memberId === leaver.id)?.amount ?? 0)} (moved out ${niceDate(input.lastDay)})`],
          expenseId: r.e.id,
          undo: { type: "expense_revert", expenseId: r.e.id, before: expenseState(r.e) },
        });
      }
      // 2. Square up.
      for (const t of p.payments) {
        const pay = await tx.payment.create({ data: { groupId, fromId: t.from, toId: t.to, amount: t.amount, createdById: actorId } });
        await logEvent(tx, {
          groupId,
          actorId,
          kind: "payment_recorded",
          text: `recorded ${name(t.from)} paid ${name(t.to)} ${money(t.amount)}`,
          paymentId: pay.id,
          undo: { type: "payment_delete", paymentId: pay.id },
        });
      }
      // 3. Their deposit: handed to whoever moves in, or kept on record until the lease ends.
      const dep = flat.deposit?.shares.find((s) => s.memberId === leaver.id && s.status === "held");
      if (dep && depositTo) {
        await tx.depositShare.update({ where: { id: dep.id }, data: { status: "transferred", toMemberId: depositTo, updatedAt: new Date() } });
        const existing = flat.deposit!.shares.find((s) => s.memberId === depositTo);
        if (existing) await tx.depositShare.update({ where: { id: existing.id }, data: { amount: existing.status === "held" ? existing.amount + dep.amount : dep.amount, status: "held", updatedAt: new Date() } });
        else await tx.depositShare.create({ data: { depositId: flat.deposit!.id, memberId: depositTo, amount: dep.amount } });
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
        if (Object.keys(data).length) await tx.bill.update({ where: { id: b.id }, data });
      }
      // 5. Moved out.
      await tx.member.update({ where: { id: leaver.id }, data: { leftAt: new Date(`${input.lastDay}T12:00:00Z`) } });
      await logEvent(tx, {
        groupId,
        actorId,
        kind: "member_left",
        text: actorId === leaver.id ? `moved out (last day ${niceDate(input.lastDay)})` : `marked ${leaver.name} as moved out (last day ${niceDate(input.lastDay)})`,
        details: [
          ...(p.credit ? [`${money(p.credit)} of bills after they left moved to the others`] : []),
          ...p.payments.map((t) => `${name(t.from)} paid ${name(t.to)} ${money(t.amount)}`),
          ...(dep && depositTo ? [`Deposit ${money(dep.amount)} taken over by ${name(depositTo)}`] : []),
        ],
        undo: { type: "member_set", memberId: leaver.id, data: { leftAt: null } },
      });
    });
  } catch (err) {
    if (isDuplicateKey(err)) return { ok: true, payments: [] };
    throw err;
  }
  return { ok: true, payments: p.payments };
}

// The deposit: who put in what. Never part of balances.
export async function saveDepositFor(groupId: string, actorId: string, input: { heldBy: string; amounts: Record<string, string> }): Promise<{ ok: true } | Fail> {
  const flat = await loadFlat(groupId);
  if (!flat || flat.deletedAt) return { ok: false, error: "This group no longer exists." };
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
  await db.$transaction(async (tx) => {
    const dep = await tx.deposit.upsert({ where: { groupId }, create: { groupId, heldBy }, update: { heldBy } });
    // Only the shares still held can be edited; returned/transferred ones are history.
    await tx.depositShare.deleteMany({ where: { depositId: dep.id, status: "held", memberId: { notIn: rows.map((r) => r.memberId) } } });
    for (const r of rows) {
      await tx.depositShare.upsert({
        where: { depositId_memberId: { depositId: dep.id, memberId: r.memberId } },
        create: { depositId: dep.id, memberId: r.memberId, amount: r.amount },
        update: { amount: r.amount, status: "held", toMemberId: "", updatedAt: new Date() },
      });
    }
    await logEvent(tx, {
      groupId,
      actorId,
      kind: "bill_changed",
      text: `updated the deposit with ${heldBy} (${formatMoney(rows.reduce((s, r) => s + r.amount, 0), flat.currency)})`,
      details: rows.map((r) => `${flat.members.find((m) => m.id === r.memberId)?.name}: ${formatMoney(r.amount, flat.currency)}`),
    });
  });
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
  const weights = Object.fromEntries(flat.members.map((m) => [m.id, m.splitWeight]));
  const refunds = depositRefunds(held, deductions, weights);
  await db.$transaction(async (tx) => {
    for (const h of held) {
      const back = refunds.find((r) => r.memberId === h.memberId)?.refund ?? 0;
      await tx.depositShare.update({ where: { id: h.id }, data: { status: "returned", returnedAmount: back, updatedAt: new Date() } });
    }
    await logEvent(tx, {
      groupId,
      actorId,
      kind: "bill_changed",
      text: `marked the deposit as returned${deductions ? ` (${formatMoney(deductions, flat.currency)} deducted)` : ""}`,
      details: refunds.map((r) => `${flat.members.find((m) => m.id === r.memberId)?.name} gets back ${formatMoney(r.refund, flat.currency)}`),
    });
  });
  return { ok: true };
}
