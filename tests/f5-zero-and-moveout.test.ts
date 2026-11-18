import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { typedZero } from "@/lib/zero-amount";
import { parseAmount } from "@/lib/money";
import { checkDay, returnDepositFor, saveDepositFor } from "@/lib/home/moving-db";
import { saveBudgetsFor } from "@/lib/home/budgets-db";
import { runBillsForGroup } from "@/lib/home/bills-db";
import { saveBillFor, type BillInput } from "@/lib/home/bill-setup";

// FB-13: a typed zero means "nothing" (the same as a blank box) and never creates a 0 row.
// FB-10: the move-out "today" is the person's own day, not India's.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
let counter = 0;

async function flat(names: string[]) {
  const n = ++counter;
  const g = await db.group.create({
    data: { name: `F5 ${n} ${stamp}`, type: "home", currency: "INR", inviteCode: `f5z-${n}-${stamp}`, members: { create: names.map((name) => ({ name })) } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, ids: Object.fromEntries(g.members.map((m) => [m.name, m.id])) as Record<string, string> };
}
const shares = async (groupId: string) => (await db.depositShare.findMany({ where: { deposit: { groupId } } })).map((s) => ({ memberId: s.memberId, amount: s.amount, status: s.status, returned: s.returnedAmount }));

afterAll(async () => {
  await db.groupEvent.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("typedZero", () => {
  it("is true for any way of typing nothing", () => {
    for (const z of ["0", "0.00", "₹0", " 0 ", "00", "0,00", ".0", "₹ 0.0", "$0"]) expect(typedZero(z), z).toBe(true);
  });
  it("is false for blanks, real amounts and rubbish", () => {
    for (const x of ["", "  ", "0.01", "0.5", "10", "1,000", "abc", "₹", ".", "-0", "0x"]) expect(typedZero(x), x).toBe(false);
  });
  it("parseAmount still refuses 0 as an amount (a zero is handled before it)", () => {
    expect(parseAmount("0")).toBeNull();
  });
});

describe("FB-13: deposit", () => {
  it("{A: 36000, B: 0} is accepted: A holds 3600000 paise, B has no row, total held 3600000", async () => {
    const g = await flat(["A", "B"]);
    const r = await saveDepositFor(g.id, g.ids.A, { heldBy: "Landlord", amounts: { [g.ids.A]: "36000", [g.ids.B]: "0" } });
    expect(r).toEqual({ ok: true });
    const s = await shares(g.id);
    expect(s).toEqual([{ memberId: g.ids.A, amount: 3_600_000, status: "held", returned: 0 }]);
    expect(s.reduce((t, x) => t + x.amount, 0)).toBe(3_600_000);
  });
  it("a typed zero over a held share removes it, like a blank box does", async () => {
    const g = await flat(["A", "B"]);
    await saveDepositFor(g.id, g.ids.A, { heldBy: "Landlord", amounts: { [g.ids.A]: "36000", [g.ids.B]: "36000" } });
    expect((await saveDepositFor(g.id, g.ids.A, { heldBy: "Landlord", amounts: { [g.ids.A]: "₹36,000", [g.ids.B]: "0.00" } })).ok).toBe(true);
    expect((await shares(g.id)).map((x) => [x.memberId, x.amount])).toEqual([[g.ids.A, 3_600_000]]);
  });
  it("a real mistake is still refused", async () => {
    const g = await flat(["A", "B"]);
    const r = await saveDepositFor(g.id, g.ids.A, { heldBy: "Landlord", amounts: { [g.ids.A]: "abc" } });
    expect(r.ok).toBe(false);
  });
});

describe("FB-13: deposit return with deductions 0", () => {
  it("A 3600000 and B 3600000, deductions '0': each gets 3600000 back, total 7200000 = held 7200000 minus 0", async () => {
    const g = await flat(["A", "B"]);
    await saveDepositFor(g.id, g.ids.A, { heldBy: "Landlord", amounts: { [g.ids.A]: "36000", [g.ids.B]: "36000" } });
    expect(await returnDepositFor(g.id, g.ids.A, "0")).toEqual({ ok: true });
    const s = await shares(g.id);
    expect(s.map((x) => [x.status, x.returned])).toEqual([["returned", 3_600_000], ["returned", 3_600_000]]);
    expect(s.reduce((t, x) => t + x.returned, 0)).toBe(7_200_000);
  });
  it("deductions '₹0.00' are the same as blank", async () => {
    const g = await flat(["A", "B"]);
    await saveDepositFor(g.id, g.ids.A, { heldBy: "Landlord", amounts: { [g.ids.A]: "100", [g.ids.B]: "100" } });
    expect(await returnDepositFor(g.id, g.ids.A, "₹0.00")).toEqual({ ok: true });
    expect((await shares(g.id)).reduce((t, x) => t + x.returned, 0)).toBe(20_000);
  });
});

describe("FB-13: budget", () => {
  it("groceries '0' removes the saved 1000000 budget; food '5000' is kept (500000)", async () => {
    const g = await flat(["A", "B"]);
    await saveBudgetsFor(g.id, g.ids.A, { groceries: "10000" });
    expect((await db.budget.findMany({ where: { groupId: g.id } })).map((b) => b.amount)).toEqual([1_000_000]);
    expect((await saveBudgetsFor(g.id, g.ids.A, { groceries: "0", food: "5000" })).ok).toBe(true);
    expect((await db.budget.findMany({ where: { groupId: g.id } })).map((b) => [b.category, b.amount])).toEqual([["food", 500_000]]);
    expect(await db.budget.count({ where: { groupId: g.id, amount: { lte: 0 } } })).toBe(0);
  });
});

describe("FB-13: bill split by amounts", () => {
  const input = (g: Awaited<ReturnType<typeof flat>>, amt: Record<string, string>): BillInput => ({ template: "rent", name: "Rent", nature: "fixed", amount: "24000", day: "1", payer: g.ids.A, split: "amounts", ids: [], pct: {}, amt });
  const ranShares = async (billId: string) => {
    const run = await db.billRun.findFirstOrThrow({ where: { billId } });
    expect(run.status).toBe("added");
    const e = await db.expense.findUniqueOrThrow({ where: { id: run.expenseId }, include: { shares: true } });
    expect(e.shares.reduce((t, s) => t + s.amount, 0)).toBe(e.amount); // shares add up to the bill
    return { amount: e.amount, shares: Object.fromEntries(e.shares.map((s) => [s.memberId, s.amount])) };
  };
  const setup = new Date("2026-09-20T06:00:00Z");
  const runAt = new Date("2026-10-16T06:00:00Z");

  it("rent 2400000: A '24000', B '0', C '' -> A 2400000 only; the expense's shares add up to 2400000", async () => {
    const g = await flat(["A", "B", "C"]);
    const r = await saveBillFor(g.id, g.ids.A, input(g, { [g.ids.A]: "24000", [g.ids.B]: "0", [g.ids.C]: "" }), setup);
    expect(r.ok).toBe(true);
    await runBillsForGroup(g.id, runAt);
    expect(await ranShares(r.ok ? r.id : "")).toEqual({ amount: 2_400_000, shares: { [g.ids.A]: 2_400_000 } });
  });
  it("A '12000.50', B '11999.50', C '0' -> 1200050 + 1199950 = 2400000", async () => {
    const g = await flat(["A", "B", "C"]);
    const r = await saveBillFor(g.id, g.ids.A, input(g, { [g.ids.A]: "12000.50", [g.ids.B]: "11999.50", [g.ids.C]: "0" }), setup);
    expect(r.ok).toBe(true);
    await runBillsForGroup(g.id, runAt);
    expect(await ranShares(r.ok ? r.id : "")).toEqual({ amount: 2_400_000, shares: { [g.ids.A]: 1_200_050, [g.ids.B]: 1_199_950 } });
  });
  it("a zero does not hide a wrong total: A '20000', B '0' is refused (20000 is not 24000)", async () => {
    const g = await flat(["A", "B"]);
    const r = await saveBillFor(g.id, g.ids.A, input(g, { [g.ids.A]: "20000", [g.ids.B]: "0" }));
    expect(r.ok).toBe(false);
  });
});

describe("FB-10: move-out 'today' is the person's own day", () => {
  // 2026-11-30 15:30Z = 02:30 on 1 Dec in Sydney (UTC+11), and 21:00 on 30 Nov in India (UTC+5:30).
  const now = new Date("2026-11-30T15:30:00Z");
  it("1 Dec: fine in Sydney (it is 1 Dec there), 'in the future' in India", () => {
    expect(checkDay("2026-12-01", now, "Australia/Sydney")).toBeNull();
    expect(checkDay("2026-12-01", now, "Asia/Kolkata")).toMatch(/can’t be in the future/);
  });
  it("31 Oct: too old in Sydney (this month or last = Nov or Dec), fine in India (Oct or Nov)", () => {
    expect(checkDay("2026-10-31", now, "Australia/Sydney")).toBe("Pick a last day this month or last month.");
    expect(checkDay("2026-10-31", now, "Asia/Kolkata")).toBeNull();
  });
  it("with no zone given it is India time, as before; a made-up zone falls back to India too", () => {
    expect(checkDay("2026-12-01", now)).toMatch(/future/);
    expect(checkDay("2026-12-01", now, "Not/AZone")).toMatch(/future/);
  });
  it("a tampered zone can only move 'today' by a day: two days ahead is refused in every zone", () => {
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kolkata", "UTC"]) expect(checkDay("2026-12-03", now, tz), tz).toMatch(/future/);
  });
  it("garbage is still refused", () => {
    expect(checkDay("tomorrow", now, "Australia/Sydney")).toBe("Pick the last day in the flat.");
  });
});
