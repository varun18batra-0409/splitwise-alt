import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { BILL_TEMPLATES, dailyTotal, payerFor, periodsDue } from "@/lib/home/bills";
import { runBillsForGroup } from "@/lib/home/bills-db";
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
