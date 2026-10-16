import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { BILL_TEMPLATES, dailyTotal, payerFor, periodsDue } from "@/lib/home/bills";
import { addWaitingBill, runBillsForGroup } from "@/lib/home/bills-db";
import { billCommand, saveBillFor } from "@/lib/home/bill-setup";
import type { SaveExpenseInput } from "@/lib/save-expense";
import { loadGroup } from "@/lib/group-data";
import { undoEvent } from "@/lib/undo";

// Recurring bills: added on the day (fixed), the payer asked for the amount
// (varies), or tallied daily and added at month end. Never twice.

const tz = "Asia/Kolkata";
const base = { day: 1, every: 1, startMonth: "2026-09", endMonth: "", paused: false, tz, nature: "fixed", missed: "{}" };

describe("which periods are due", () => {
  it("a bill due on the 1st is due from the 1st in India time", () => {
    expect(periodsDue({ ...base, startMonth: "2026-10" }, new Date("2026-10-31T17:00:00Z"))).toEqual(["2026-10"]); // 31 Oct 22:30 IST
    expect(periodsDue({ ...base, startMonth: "2026-10" }, new Date("2026-10-31T19:00:00Z"))).toEqual(["2026-10", "2026-11"]); // 1 Nov 00:30 IST
  });
  it("only this month and last (a job that was down catches up one month)", () => {
    expect(periodsDue({ ...base, startMonth: "2026-01" }, new Date("2026-10-16T06:00:00Z"))).toEqual(["2026-09", "2026-10"]);
  });
  it("respects start, end, pause and every N months", () => {
    expect(periodsDue({ ...base, startMonth: "2026-10" }, new Date("2026-10-16T06:00:00Z"))).toEqual(["2026-10"]);
    expect(periodsDue({ ...base, endMonth: "2026-09" }, new Date("2026-10-16T06:00:00Z"))).toEqual(["2026-09"]);
    expect(periodsDue({ ...base, paused: true }, new Date("2026-10-16T06:00:00Z"))).toEqual([]);
    expect(periodsDue({ ...base, every: 2 }, new Date("2026-10-16T06:00:00Z"))).toEqual(["2026-09"]); // Sep, Nov, Jan…
  });
  it("a bill due on the 20th isn't due on the 16th", () => {
    expect(periodsDue({ ...base, day: 20, startMonth: "2026-10" }, new Date("2026-10-16T06:00:00Z"))).toEqual([]);
  });
  it("a daily bill is due once its month is over", () => {
    expect(periodsDue({ ...base, nature: "daily", startMonth: "2026-10" }, new Date("2026-10-31T17:00:00Z"))).toEqual([]);
    expect(periodsDue({ ...base, nature: "daily", startMonth: "2026-10" }, new Date("2026-10-31T19:00:00Z"))).toEqual(["2026-10"]);
  });
});

describe("who pays and how much", () => {
  it("a fixed payer, or nobody if they left", () => {
    expect(payerFor({ payer: "a", rotation: "[]", startMonth: "2026-09", every: 1 }, "2026-10", ["a", "b"])).toBe("a");
    expect(payerFor({ payer: "a", rotation: "[]", startMonth: "2026-09", every: 1 }, "2026-10", ["b"])).toBeNull();
  });
  it("taking turns goes round the people still here", () => {
    const b = { payer: "", rotation: JSON.stringify(["a", "b", "c"]), startMonth: "2026-09", every: 1 };
    expect(["2026-09", "2026-10", "2026-11", "2026-12"].map((p) => payerFor(b, p, ["a", "b", "c"]))).toEqual(["a", "b", "c", "a"]);
    expect(payerFor(b, "2026-10", ["a", "c"])).toBe("c"); // b left: the turn moves on
  });
  it("milk: ₹60 a day, minus the days it didn't come", () => {
    expect(dailyTotal({ amount: 6000, missed: JSON.stringify({ "2026-10": [4, 12, 12, 40] }) }, "2026-10")).toEqual({ days: 29, amount: 174000 });
  });
  it("has the 12 tiles from the design", () => {
    expect(BILL_TEMPLATES.map((t) => t.name)).toEqual(["Rent", "Society", "Electricity", "Wi-Fi", "House help", "Cook", "Milk", "Water cans", "Gas", "Streaming", "Mobile", "Other"]);
  });
});

describe("the daily job", () => {
  let groupId = "", you = "", asha = "", rohan = "";
  const now = new Date("2026-10-16T06:00:00Z");
  beforeAll(async () => {
    const g = await db.group.create({
      data: {
        name: "Flat 402", type: "home", currency: "INR", inviteCode: `bills-${Date.now()}`,
        members: { create: [{ name: "You", splitWeight: 120 }, { name: "Asha" }, { name: "Rohan" }] },
      },
      include: { members: true },
    });
    groupId = g.id;
    const id = (n: string) => g.members.find((m) => m.name === n)!.id;
    [you, asha, rohan] = [id("You"), id("Asha"), id("Rohan")];
  });
  afterAll(async () => {
    await db.group.delete({ where: { id: groupId } }).catch(() => {});
  });
  const bill = (over: object) =>
    db.bill.create({ data: { groupId, name: "Rent", category: "bills", nature: "fixed", amount: 3600000, day: 1, startMonth: "2026-10", payer: you, tz, ...over } });

  it("adds rent once, by the group's split, even when run twice at the same moment", async () => {
    const b = await bill({});
    await Promise.all([runBillsForGroup(groupId, now), runBillsForGroup(groupId, now)]);
    const runs = await db.billRun.findMany({ where: { billId: b.id } });
    expect(runs.map((r) => [r.period, r.status])).toEqual([["2026-10", "added"]]);
    const e = await db.expense.findUniqueOrThrow({ where: { id: runs[0].expenseId }, include: { shares: true } });
    expect(e.amount).toBe(3600000);
    expect(e.paidById).toBe(you);
    expect(e.shares.find((s) => s.memberId === you)?.amount).toBe(1350000); // 1.2 of 3.2 shares
    expect((await loadGroup(groupId))!.net[you]).toBe(2250000);
  });

  it("undoing an added bill doesn't bring it back tomorrow", async () => {
    const run = await db.billRun.findFirstOrThrow({ where: { bill: { groupId, name: "Rent" } } });
    const ev = await db.groupEvent.findFirstOrThrow({ where: { expenseId: run.expenseId, kind: "expense_added" } });
    expect((await undoEvent(ev.id, you)).ok).toBe(true);
    await runBillsForGroup(groupId, new Date("2026-10-17T06:00:00Z"));
    expect(await db.expense.count({ where: { groupId, description: "Rent" } })).toBe(1);
  });

  it("a varying bill waits for its amount", async () => {
    const b = await bill({ name: "Electricity", nature: "varies", amount: 242000, day: 5, payer: rohan });
    await runBillsForGroup(groupId, now);
    const run = await db.billRun.findFirstOrThrow({ where: { billId: b.id } });
    expect(run.status).toBe("waiting");
    expect(await db.expense.count({ where: { groupId, description: "Electricity" } })).toBe(0);
  });

  it("a bill whose payer left waits with a reason", async () => {
    const b = await bill({ name: "Cook", amount: 600000, payer: asha });
    await db.member.update({ where: { id: asha }, data: { leftAt: new Date() } });
    await runBillsForGroup(groupId, now);
    const run = await db.billRun.findFirstOrThrow({ where: { billId: b.id } });
    expect([run.status, run.reason]).toEqual(["waiting", "payer left"]);
    await db.member.update({ where: { id: asha }, data: { leftAt: null } });
  });

  it("milk is added once at month end, for the days it came", async () => {
    const b = await bill({ name: "Milk", nature: "daily", amount: 6000, payer: rohan, missed: JSON.stringify({ "2026-10": [4, 12] }) });
    await runBillsForGroup(groupId, new Date("2026-10-31T17:00:00Z"));
    expect(await db.billRun.count({ where: { billId: b.id } })).toBe(0);
    await runBillsForGroup(groupId, new Date("2026-10-31T19:00:00Z"));
    const run = await db.billRun.findFirstOrThrow({ where: { billId: b.id } });
    const e = await db.expense.findUniqueOrThrow({ where: { id: run.expenseId } });
    expect(e.amount).toBe(174000);
    expect(e.spentAt?.toISOString()).toBe("2026-10-31T12:00:00.000Z");
  });
});

// Found in review: these must hold too.
describe("bills: edge cases from review", () => {
  let groupId = "", you = "", asha = "";
  beforeAll(async () => {
    const g = await db.group.create({
      data: { name: "Flat 9", type: "home", currency: "INR", inviteCode: `bills2-${Date.now()}`, members: { create: [{ name: "You" }, { name: "Asha" }] } },
      include: { members: true },
    });
    groupId = g.id;
    [you, asha] = [g.members.find((m) => m.name === "You")!.id, g.members.find((m) => m.name === "Asha")!.id];
  });
  afterAll(async () => {
    await db.group.delete({ where: { id: groupId } }).catch(() => {});
  });
  const bill = (over: object) =>
    db.bill.create({ data: { groupId, name: "Rent", category: "bills", nature: "fixed", amount: 2000000, day: 1, startMonth: "2026-10", payer: you, tz, ...over } });
  const rate = async () => ({ ok: true as const, rate: "1", date: "2026-10-16" });
  const entry = (name: string, amount: string, payer: string): SaveExpenseInput => ({
    groupId, name, category: "bills", amount, currency: "INR", paidById: payer, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal",
    exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", date: "2026-10-05",
  });

  it("“Enter amount” from two phones at once adds the bill once", async () => {
    const b = await bill({ name: "Electricity", nature: "varies", amount: 0, day: 5, payer: asha });
    await runBillsForGroup(groupId, new Date("2026-10-16T06:00:00Z"));
    const run = { billId: b.id, period: "2026-10" };
    const [r1, r2] = await Promise.all([
      addWaitingBill(entry("Electricity", "2400", asha), asha, rate, run, "enter-amount-key-aaaa1"),
      addWaitingBill(entry("Electricity", "2400", asha), you, rate, run, "enter-amount-key-bbbb2"),
    ]);
    expect([r1.ok, r2.ok].sort()).toEqual([false, true]);
    expect(await db.expense.count({ where: { groupId, description: "Electricity", deletedAt: null } })).toBe(1);
    const after = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: b.id, period: "2026-10" } } });
    expect(after.status).toBe("added");
    // The same phone sending it again (a retry) is fine and adds nothing.
    const ok = r1.ok ? r1 : r2;
    const again = await addWaitingBill(entry("Electricity", "2400", asha), asha, rate, run, r1.ok ? "enter-amount-key-aaaa1" : "enter-amount-key-bbbb2");
    expect(again).toEqual({ ok: true, id: ok.ok ? ok.id : "" });
    expect((await db.bill.findUniqueOrThrow({ where: { id: b.id } })).amount).toBe(240000);
  });

  it("resuming a paused bill doesn't charge the months it was paused", async () => {
    const b = await bill({ name: "Cook", amount: 500000, startMonth: "2026-08" });
    await runBillsForGroup(groupId, new Date("2026-08-02T06:00:00Z"));
    expect((await billCommand(groupId, you, b.id, "pause", new Date("2026-08-20T06:00:00Z"))).ok).toBe(true);
    expect((await billCommand(groupId, you, b.id, "resume", new Date("2026-10-16T06:00:00Z"))).ok).toBe(true);
    await runBillsForGroup(groupId, new Date("2026-10-16T07:00:00Z"));
    expect(await db.expense.count({ where: { groupId, description: "Cook" } })).toBe(1); // August only
    await runBillsForGroup(groupId, new Date("2026-11-01T07:00:00Z"));
    expect(await db.expense.count({ where: { groupId, description: "Cook" } })).toBe(2); // and November again
  });

  it("a run that crashed part-way is finished later; one still in progress is left alone", async () => {
    const b = await bill({ name: "Wi-Fi", amount: 99900 });
    const now = new Date("2026-10-16T06:00:00Z");
    await db.billRun.create({ data: { billId: b.id, period: "2026-10", status: "adding", claimedAt: new Date(now.getTime() - 60 * 60_000) } });
    const b2 = await bill({ name: "Gas", amount: 90000 });
    await db.billRun.create({ data: { billId: b2.id, period: "2026-10", status: "adding", claimedAt: new Date(now.getTime() - 60_000) } });
    await runBillsForGroup(groupId, now);
    const run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: b.id, period: "2026-10" } } });
    expect(run.status).toBe("added");
    expect(await db.expense.count({ where: { groupId, description: "Wi-Fi" } })).toBe(1);
    expect((await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: b2.id, period: "2026-10" } } })).status).toBe("adding");
  });

  it("milk set up on the 20th is charged from the 20th, not the whole month", async () => {
    const r = await saveBillFor(groupId, you, { template: "milk", name: "Milk", nature: "daily", amount: "60", day: "31", payer: you, split: "group", ids: [] }, new Date("2026-10-20T06:00:00Z"));
    expect(r.ok).toBe(true);
    await runBillsForGroup(groupId, new Date("2026-11-01T06:00:00Z"));
    const e = await db.expense.findFirstOrThrow({ where: { groupId, description: "Milk" } });
    expect(e.amount).toBe(12 * 6000); // 20th–31st
  });

  it("milk paused on the 20th and back on the 25th isn't charged for those 5 days", async () => {
    const b = await bill({ name: "Water cans", nature: "daily", amount: 5000, day: 31, startMonth: "2026-10" });
    await billCommand(groupId, you, b.id, "pause", new Date("2026-10-20T06:00:00Z"));
    await billCommand(groupId, you, b.id, "resume", new Date("2026-10-25T06:00:00Z"));
    await runBillsForGroup(groupId, new Date("2026-11-01T06:00:00Z"));
    const e = await db.expense.findFirstOrThrow({ where: { groupId, description: "Water cans" } });
    expect(e.amount).toBe(26 * 5000);
  });

  it("a bill shared by only some people waits when they've all left", async () => {
    const b = await bill({ name: "Netflix", amount: 64900, split: JSON.stringify({ mode: "some", ids: [] }) });
    await runBillsForGroup(groupId, new Date("2026-10-16T06:00:00Z"));
    const run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: b.id, period: "2026-10" } } });
    expect(run.status).toBe("waiting");
  });
});
