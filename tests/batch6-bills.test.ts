import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { billCommand } from "@/lib/home/bill-setup";
import { billStatuses, runBillsForGroup } from "@/lib/home/bills-db";
import { monthInsights } from "@/lib/home/insights-db";
import { checkBooks } from "./helpers/money-invariants";

// Batch 6 of the outside-review fixes: bills.
// G40/L09 Skip names and skips exactly one month. G14/L20 an automatic bill posts only what the bill says now, never at a market rate.
// L08/G13 stuck or older months become visible. G39 the next date of an every-other-month bill. G42 "Next month, about".
// Throwaway database. Money is in minor units (paise / cents), worked out by hand in each test.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
let n = 0;
afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await eraseGroups(groupIds);
});

const at = (day: string) => new Date(`${day}T06:00:00Z`); // 11:30 in India that day
async function flat() {
  const g = await db.group.create({
    data: { name: `B6 ${++n} ${stamp}`, type: "home", currency: "INR", inviteCode: `b6-${n}-${stamp}`, members: { create: [{ name: "Asha", createdAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2) }] } },
    include: { members: true },
  });
  groupIds.push(g.id);
  const asha = g.members.find((m) => m.name === "Asha")!.id;
  const ravi = g.members.find((m) => m.name === "Ravi")!.id;
  return { id: g.id, asha, ravi, weights: { [asha]: 100, [ravi]: 100 } as Record<string, number> };
}
type Flat = Awaited<ReturnType<typeof flat>>;
const equal = JSON.stringify({ mode: "equal", ids: [] });
const mk = (f: Flat, over: Record<string, unknown> = {}) =>
  db.bill.create({ data: { groupId: f.id, name: "Rent", nature: "fixed", amount: 1000000, day: 1, startMonth: "2026-11", payer: f.asha, split: equal, ...over } as Parameters<typeof db.bill.create>[0]["data"] });
const run = (billId: string, period: string, status: string, extra: Record<string, unknown> = {}) =>
  db.billRun.create({ data: { billId, period, status, ...extra } as Parameters<typeof db.billRun.create>[0]["data"] });
const runOf = (billId: string, period: string) => db.billRun.findUnique({ where: { billId_period: { billId, period } } });
const expensesOf = (gid: string, name: string) => db.expense.findMany({ where: { groupId: gid, description: name, deletedAt: null }, include: { shares: true } });
const skippedLines = (gid: string) => db.groupEvent.count({ where: { groupId: gid, kind: "bill_changed", text: { contains: "skipped" } } });

describe("G40 and L09: Skip names its month and skips only that month", () => {
  it("October and November both waiting: the Bills tab shows October (the oldest); skipping October leaves November waiting", async () => {
    const f = await flat();
    const bill = await mk(f, { startMonth: "2026-10" });
    await run(bill.id, "2026-10", "waiting", { reason: "" });
    await run(bill.id, "2026-11", "waiting", { reason: "" });
    const shown = (await billStatuses(f.id, at("2026-11-20"))).find((s) => s.bill.id === bill.id)!;
    expect([shown.status, shown.period]).toEqual(["waiting", "2026-10"]);
    const r = await billCommand(f.id, f.ravi, bill.id, "skip", at("2026-11-20"), { period: "2026-10" });
    expect(r).toEqual({ ok: true, id: bill.id });
    expect((await runOf(bill.id, "2026-10"))?.status).toBe("skipped");
    expect((await runOf(bill.id, "2026-11"))?.status).toBe("waiting");
    // Now November is the oldest waiting month.
    const next = (await billStatuses(f.id, at("2026-11-20"))).find((s) => s.bill.id === bill.id)!;
    expect([next.status, next.period]).toEqual(["waiting", "2026-11"]);
    expect(await skippedLines(f.id)).toBe(1);
  });

  it("a form that names November skips November, not the older October", async () => {
    const f = await flat();
    const bill = await mk(f, { startMonth: "2026-10" });
    await run(bill.id, "2026-10", "waiting", { reason: "" });
    await run(bill.id, "2026-11", "waiting", { reason: "" });
    expect((await billCommand(f.id, f.ravi, bill.id, "skip", at("2026-11-20"), { period: "2026-11" })).ok).toBe(true);
    expect((await runOf(bill.id, "2026-10"))?.status).toBe("waiting");
    expect((await runOf(bill.id, "2026-11"))?.status).toBe("skipped");
  });

  it("no waiting month, December next: Skip makes December a skipped month; the job then adds nothing for it", async () => {
    const f = await flat();
    const bill = await mk(f);
    await run(bill.id, "2026-11", "added", { expenseId: "gone" });
    expect((await billCommand(f.id, f.ravi, bill.id, "skip", at("2026-11-20"), { period: "2026-12" })).ok).toBe(true);
    expect((await runOf(bill.id, "2026-12"))?.status).toBe("skipped");
    await runBillsForGroup(f.id, at("2026-12-02"));
    expect(await expensesOf(f.id, "Rent")).toHaveLength(0);
  });

  it("the daily job claims December in the gap: Skip is refused, December stays as the job left it, and no 'skipped' line is written", async () => {
    const f = await flat();
    const bill = await mk(f);
    await run(bill.id, "2026-11", "added", { expenseId: "gone" });
    const r = await billCommand(f.id, f.ravi, bill.id, "skip", at("2026-11-20"), {
      period: "2026-12",
      afterRead: async () => void (await run(bill.id, "2026-12", "adding", { claimedAt: new Date() })),
    });
    expect(r).toEqual({ ok: false, error: "Rent was just added, so it wasn’t skipped. You’ll find it in Activity." });
    expect((await runOf(bill.id, "2026-12"))?.status).toBe("adding");
    expect(await skippedLines(f.id)).toBe(0);
  });

  it("a month that was added in the gap, or one that is not coming at all, is refused and nothing is written", async () => {
    const f = await flat();
    const bill = await mk(f);
    await run(bill.id, "2026-11", "added", { expenseId: "gone" });
    // Already added: refused.
    expect((await billCommand(f.id, f.ravi, bill.id, "skip", at("2026-11-20"), { period: "2026-11" })).ok).toBe(false);
    expect((await runOf(bill.id, "2026-11"))?.status).toBe("added");
    // A month in the past with no row, and a blank month: "no coming month", no row made.
    for (const period of ["2026-09", ""]) {
      expect(await billCommand(f.id, f.ravi, bill.id, "skip", at("2026-11-20"), { period })).toEqual({ ok: false, error: "There’s no coming month to skip." });
    }
    expect(await runOf(bill.id, "2026-09")).toBeNull();
    expect(await skippedLines(f.id)).toBe(0);
  });

  it("skipping October twice (a double tap or a resend) is fine: one 'skipped' line, October skipped, November untouched", async () => {
    const f = await flat();
    const bill = await mk(f, { startMonth: "2026-10" });
    await run(bill.id, "2026-10", "waiting", { reason: "" });
    await run(bill.id, "2026-11", "waiting", { reason: "" });
    expect((await billCommand(f.id, f.ravi, bill.id, "skip", at("2026-11-20"), { period: "2026-10" })).ok).toBe(true);
    expect(await billCommand(f.id, f.ravi, bill.id, "skip", at("2026-11-20"), { period: "2026-10" })).toEqual({ ok: true, id: bill.id });
    expect(await skippedLines(f.id)).toBe(1);
    expect((await runOf(bill.id, "2026-10"))?.status).toBe("skipped");
    expect((await runOf(bill.id, "2026-11"))?.status).toBe("waiting");
  });

  it("without a month (older callers) it still skips the oldest waiting month", async () => {
    const f = await flat();
    const bill = await mk(f, { startMonth: "2026-10" });
    await run(bill.id, "2026-10", "waiting", { reason: "" });
    await run(bill.id, "2026-11", "waiting", { reason: "" });
    expect((await billCommand(f.id, f.ravi, bill.id, "skip", at("2026-11-20"))).ok).toBe(true);
    expect([(await runOf(bill.id, "2026-10"))?.status, (await runOf(bill.id, "2026-11"))?.status]).toEqual(["skipped", "waiting"]);
  });

  it("the page posts the month it means (the button itself looks as before); the action refuses an old form with no month", () => {
    const page = readFileSync("src/app/groups/[id]/bills/[billId]/page.tsx", "utf8");
    expect(page).toContain('name="period" value={skipPeriod}');
    expect(page).not.toContain("It won’t be added for that month."); // a confirm question is a look change: waits for the founder
    const action = readFileSync("src/app/bill-actions.ts", "utf8");
    expect(action).toContain('command === "skip" && period === null');
    expect(action).toContain("FORM_OUT_OF_DATE");
  });
});

describe("G14 and L20: an automatic bill posts only what the bill says now, never at a market rate", () => {
  it("Rent 1,000,000 INR; in the gap the group switches to USD (the bill becomes 10,000 cents): nothing is posted, the run is removed; the next run posts 10,000 = 5,000 + 5,000, never 12,000", async () => {
    const f = await flat();
    const bill = await mk(f);
    const first = await runBillsForGroup(f.id, at("2026-11-02"), {
      afterRead: async () => {
        await db.group.update({ where: { id: f.id }, data: { currency: "USD" } });
        await db.bill.update({ where: { id: bill.id }, data: { amount: 10000 } });
      },
    });
    expect(first.failed).toBe(1);
    expect(await expensesOf(f.id, "Rent")).toHaveLength(0);
    expect(await runOf(bill.id, "2026-11")).toBeNull();
    expect(await db.groupEvent.count({ where: { groupId: f.id, kind: "expense_added" } })).toBe(0);

    const second = await runBillsForGroup(f.id, at("2026-11-02"));
    expect(second.added).toBe(1);
    const rows = await expensesOf(f.id, "Rent");
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(10000);
    expect(rows[0].shares.map((s) => s.amount).sort((a, b) => a - b)).toEqual([5000, 5000]);
    expect(rows[0].exchangeRate).toBe("1"); // no market rate was used
    expect((await runOf(bill.id, "2026-11"))?.status).toBe("added");
    // Asha paid 10,000 and owes 5,000: +5,000. Ravi owes 5,000: -5,000. The books add up to 0.
    expect(await checkBooks(f.id)).toEqual({ [f.asha]: 5000, [f.ravi]: -5000 });
  });

  it("Rent is edited to 1,200,000 in the gap: nothing is posted; the next run posts 1,200,000 = 600,000 + 600,000", async () => {
    const f = await flat();
    const bill = await mk(f);
    const first = await runBillsForGroup(f.id, at("2026-11-02"), { afterRead: async () => void (await db.bill.update({ where: { id: bill.id }, data: { amount: 1200000 } })) });
    expect(first.failed).toBe(1);
    expect(await expensesOf(f.id, "Rent")).toHaveLength(0);
    expect(await runOf(bill.id, "2026-11")).toBeNull();
    const second = await runBillsForGroup(f.id, at("2026-11-02"));
    expect(second.added).toBe(1);
    const rows = await expensesOf(f.id, "Rent");
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(1200000);
    expect(rows[0].shares.map((s) => s.amount)).toEqual([600000, 600000]);
    expect(await checkBooks(f.id)).toEqual({ [f.asha]: 600000, [f.ravi]: -600000 });
  });

  it("the payer is changed in the gap: nothing is posted for the old payer; the next run is paid by the new one", async () => {
    const f = await flat();
    const bill = await mk(f);
    await runBillsForGroup(f.id, at("2026-11-02"), { afterRead: async () => void (await db.bill.update({ where: { id: bill.id }, data: { payer: f.ravi } })) });
    expect(await expensesOf(f.id, "Rent")).toHaveLength(0);
    await runBillsForGroup(f.id, at("2026-11-02"));
    const rows = await expensesOf(f.id, "Rent");
    expect(rows.map((e) => [e.paidById, e.amount])).toEqual([[f.ravi, 1000000]]);
    expect(await checkBooks(f.id)).toEqual({ [f.asha]: -500000, [f.ravi]: 500000 });
  });

  it("a quiet run changes nothing: one month, one expense, even when the job runs twice", async () => {
    const f = await flat();
    const bill = await mk(f);
    await runBillsForGroup(f.id, at("2026-11-02"));
    await runBillsForGroup(f.id, at("2026-11-02"));
    expect(await expensesOf(f.id, "Rent")).toHaveLength(1);
    expect((await runOf(bill.id, "2026-11"))?.status).toBe("added");
  });

  it("the bill's rate lookup refuses any other currency (source check)", () => {
    const src = readFileSync("src/lib/home/bills-db.ts", "utf8");
    expect(src).not.toContain('getRate(from, to)');
    expect(src).toContain("BILL_CURRENCY_CHANGED");
  });
});

describe("L08 and G13: stuck or older months become visible", () => {
  it("October waiting behind four added months: the Bills tab still shows October as waiting", async () => {
    const f = await flat();
    const bill = await mk(f, { startMonth: "2026-09" });
    await run(bill.id, "2026-10", "waiting", { reason: "" });
    for (const p of ["2026-11", "2026-12", "2027-01", "2027-02"]) await run(bill.id, p, "added", { expenseId: "gone" });
    const s = (await billStatuses(f.id, at("2027-02-10"))).find((x) => x.bill.id === bill.id)!;
    expect([s.status, s.period]).toEqual(["waiting", "2026-10"]);
    // The bill page asks for waiting months separately (it only loads the latest 6 runs).
    const page = readFileSync("src/app/groups/[id]/bills/[billId]/page.tsx", "utf8");
    expect(page).toContain('status: "waiting"');
    expect(page).toContain("waitingOlder");
  });

  it("a September 'adding' claimed 20 days ago becomes a waiting month and shows; nothing is charged for it", async () => {
    const f = await flat();
    const bill = await mk(f, { startMonth: "2026-09" });
    const now = at("2026-11-20");
    await run(bill.id, "2026-09", "adding", { claimedAt: new Date(now.getTime() - 20 * 86_400_000) });
    await runBillsForGroup(f.id, now);
    const sep = await runOf(bill.id, "2026-09");
    expect([sep?.status, sep?.reason]).toEqual(["waiting", ""]);
    // October and November (the two months the job looks at) were added as usual; September was not.
    expect((await expensesOf(f.id, "Rent")).length).toBe(2);
    const s = (await billStatuses(f.id, now)).find((x) => x.bill.id === bill.id)!;
    expect([s.status, s.period]).toEqual(["waiting", "2026-09"]);
  });

  it("the same, but its expense was saved after all (its key has a result): it becomes added, not waiting", async () => {
    const f = await flat();
    const bill = await mk(f, { startMonth: "2026-09" });
    const now = at("2026-11-20");
    const key = `b6-saved-${stamp}`;
    await db.requestKey.create({ data: { key, result: "saved-expense" } });
    await run(bill.id, "2026-09", "adding", { claimedAt: new Date(now.getTime() - 20 * 86_400_000), requestKey: key });
    await runBillsForGroup(f.id, now);
    const sep = await runOf(bill.id, "2026-09");
    expect([sep?.status, sep?.expenseId]).toEqual(["added", "saved-expense"]);
  });

  it("a claim only minutes old is left alone", async () => {
    const f = await flat();
    const bill = await mk(f, { startMonth: "2026-09" });
    const now = at("2026-11-20");
    await run(bill.id, "2026-09", "adding", { claimedAt: new Date(now.getTime() - 2 * 60_000) });
    await runBillsForGroup(f.id, now);
    expect((await runOf(bill.id, "2026-09"))?.status).toBe("adding");
  });
});

describe("G39: the next date of an every-other-month bill", () => {
  const nextOf = async (f: Flat, billId: string, day: string) => (await billStatuses(f.id, at(day))).find((s) => s.bill.id === billId)!;

  it("every 2 months from Nov 2026: Nov posted, next is 1 Jan 2027; once Jan is posted, 1 Mar 2027", async () => {
    const f = await flat();
    const bill = await mk(f, { every: 2 });
    await run(bill.id, "2026-11", "added", { expenseId: "gone" });
    const a = await nextOf(f, bill.id, "2026-11-01");
    expect([a.status, a.due]).toEqual(["upcoming", "2027-01-01"]);
    await run(bill.id, "2027-01", "added", { expenseId: "gone" });
    const b = await nextOf(f, bill.id, "2027-01-01");
    expect([b.status, b.due]).toEqual(["upcoming", "2027-03-01"]);
  });

  it("monthly: Nov posted, next is 1 Dec", async () => {
    const f = await flat();
    const bill = await mk(f);
    await run(bill.id, "2026-11", "added", { expenseId: "gone" });
    expect((await nextOf(f, bill.id, "2026-11-01")).due).toBe("2026-12-01");
  });

  it("every 3 months from Nov 2026: Nov posted, next is 1 Feb 2027", async () => {
    const f = await flat();
    const bill = await mk(f, { every: 3 });
    await run(bill.id, "2026-11", "added", { expenseId: "gone" });
    expect((await nextOf(f, bill.id, "2026-11-01")).due).toBe("2027-02-01");
  });
});

describe("G42: 'Next month, about' counts only bills due next month", () => {
  const insights = (f: Flat, who: string, day: string) => monthInsights(f.id, [], who, f.weights, "INR", "Asia/Kolkata", at(day));

  it("Gas fixed 400,000 every 2 from Nov and Rent 800,000 monthly: Nov view (Dec) is 800,000 / mine 400,000; Dec view (Jan) is 1,200,000 / mine 600,000", async () => {
    const f = await flat();
    await mk(f, { name: "Gas", amount: 400000, every: 2 });
    await mk(f, { name: "Rent", amount: 800000 });
    // Dec: Gas is not due (only Nov, Jan, Mar…), so only Rent: 800,000, shared 400,000 each.
    expect((await insights(f, f.asha, "2026-11-12")).forecast).toEqual({ total: 800000, mine: 400000 });
    // Jan: Gas is due, and counts in full (not 400,000 / 2): 400,000 + 800,000 = 1,200,000; Asha's half is 200,000 + 400,000 = 600,000.
    const jan = await insights(f, f.asha, "2026-12-12");
    expect(jan.forecast).toEqual({ total: 1200000, mine: 600000 });
    const ravi = await insights(f, f.ravi, "2026-12-12");
    expect((jan.forecast?.mine ?? 0) + (ravi.forecast?.mine ?? 0)).toBe(1200000);
  });

  it("a month already skipped is left out", async () => {
    const f = await flat();
    const rent = await mk(f, { name: "Rent", amount: 800000 });
    await run(rent.id, "2026-12", "skipped", { reason: "skipped" });
    expect((await insights(f, f.asha, "2026-11-12")).forecast).toBeNull();
  });

  it("a varying Gas every 2 months with past amounts 380,000 and 420,000 adds their average 400,000 only in January", async () => {
    const f = await flat();
    const gas = await mk(f, { name: "Gas", nature: "varies", amount: 0, every: 2, startMonth: "2026-07" });
    for (const [period, amount] of [["2026-07", 380000], ["2026-09", 420000]] as const) {
      const e = await db.expense.create({
        data: { groupId: f.id, description: "Gas", amount, splitType: "equal", paidById: f.asha, createdById: f.asha, shares: { create: [{ memberId: f.asha, amount: amount / 2 }, { memberId: f.ravi, amount: amount / 2 }] } },
      });
      await run(gas.id, period, "added", { expenseId: e.id });
    }
    // December is not on Gas's cycle (Jul, Sep, Nov, Jan…): nothing to forecast.
    expect((await insights(f, f.asha, "2026-11-12")).forecast).toBeNull();
    // January is: (380,000 + 420,000) / 2 = 400,000; Asha's half is 200,000.
    expect((await insights(f, f.asha, "2026-12-12")).forecast).toEqual({ total: 400000, mine: 200000 });
  });
});
