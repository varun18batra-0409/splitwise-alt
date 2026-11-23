import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dayRangeLabel, monthSoFar, nextBillLabel } from "@/lib/home/bills";
import { addWaitingBill, billChangeLines, billExpenseInput, billStatuses, runBillsForGroup } from "@/lib/home/bills-db";
import { billCommand, saveBillFor, toggleMissedDayFor } from "@/lib/home/bill-setup";
import { moveOut } from "@/lib/home/moving-db";
import { joinWeights, lastPartDay, dailyPrecharge } from "@/lib/home/moving";
import { setExpenseDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { checkBooks } from "./helpers/money-invariants";

// Pausing or stopping a daily bill adds the month so far first. Milk at 60 rupees a day = 6,000 paise; flatmates A, B, C share equally and A pays.
// Every database test ends with the three checks (shares add up to each expense, balances add up to 0, nobody who left is off 0).

const groupIds: string[] = [];
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});
const at = (day: string) => new Date(`${day}T06:00:00Z`); // 11:30 in India that day
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

async function flat(label: string, o: { startMonth?: string; missed?: string; nature?: string; extra?: boolean } = {}) {
  const g = await db.group.create({
    data: {
      name: `Flat ${label}`, type: "home", currency: "INR", inviteCode: `bps-${label}-${Date.now()}`,
      members: { create: [{ name: "A" }, { name: "B" }, { name: "C" }, ...(o.extra ? [{ name: "D", joinedFrom: new Date("2026-11-15T12:00:00Z") }] : [])] },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  const bill = await db.bill.create({
    data: { groupId: g.id, name: "Milk", category: "groceries", nature: o.nature ?? "daily", amount: 6000, startMonth: o.startMonth ?? "2026-11", payer: id("A"), split: JSON.stringify({ mode: "equal" }), missed: o.missed ?? "{}", tz: "Asia/Kolkata" },
  });
  return { groupId: g.id, a: id("A"), b: id("B"), c: id("C"), d: o.extra ? id("D") : "", billId: bill.id };
}
const shareMap = (e: { shares: { memberId: string; amount: number }[] }) => Object.fromEntries(e.shares.map((s) => [s.memberId, s.amount]));
const expensesOf = (groupId: string) => db.expense.findMany({ where: { groupId, deletedAt: null }, include: { shares: true }, orderBy: { createdAt: "asc" } });
const pay = (groupId: string, fromId: string, toId: string, amount: number) => db.payment.create({ data: { groupId, fromId, toId, amount, createdById: fromId } });

describe("the month so far (pure, hand-worked)", () => {
  it("1–19 Nov at 6,000 a day: 19 × 6,000 = 114,000; two missed days: 17 × 6,000 = 102,000", () => {
    expect(monthSoFar({ amount: 6000, missed: "{}" }, "2026-11", "2026-11-20", [])).toEqual({ fromDay: 1, toDay: 19, lastDay: 19, days: 19, gross: 114000, less: 0, amount: 114000 });
    expect(monthSoFar({ amount: 6000, missed: JSON.stringify({ "2026-11": [5, 6] }) }, "2026-11", "2026-11-20", [])).toMatchObject({ days: 17, gross: 102000, amount: 102000 });
  });
  it("a move-out charge of 16,000 comes off: 102,000 − 16,000 = 86,000", () => {
    expect(monthSoFar({ amount: 6000, missed: JSON.stringify({ "2026-11": [5, 6] }) }, "2026-11", "2026-11-20", [{ a: 16000, d: "2026-11-10" }])).toMatchObject({ gross: 102000, less: 16000, amount: 86000 });
  });
  it("after a part charge covering 1–19, only later days count (20–24 = 5 × 6,000 = 30,000); a charge that came before the part charge is not taken off twice", () => {
    const entries = [{ a: 16000, d: "2026-11-10" }, { a: 86000, k: "part", d: "2026-11-19" }];
    expect(monthSoFar({ amount: 6000, missed: "{}" }, "2026-11", "2026-11-25", entries)).toMatchObject({ fromDay: 20, toDay: 24, days: 5, gross: 30000, less: 0, amount: 30000 });
    // Paused and started again on the same day: nothing new.
    expect(monthSoFar({ amount: 6000, missed: "{}" }, "2026-11", "2026-11-20", [{ a: 114000, k: "part", d: "2026-11-19" }]).amount).toBe(0);
  });
  it("the 1st of the month: nothing yet; a later month: the whole month", () => {
    expect(monthSoFar({ amount: 6000, missed: "{}" }, "2026-12", "2026-12-01", []).amount).toBe(0);
    expect(monthSoFar({ amount: 6000, missed: "{}" }, "2026-11", "2026-12-01", []).amount).toBe(180000);
  });
  it("labels", () => {
    expect(dayRangeLabel("2026-11", 1, 19)).toBe("1–19 Nov");
    expect(dayRangeLabel("2026-11", 19, 19)).toBe("19 Nov");
  });
  it("the leaver is not charged for days a part charge covered; the last part day is read from live charges", () => {
    const members = [{ id: "A", splitWeight: 100, joinedFrom: null, leftAt: null }, { id: "B", splitWeight: 100, joinedFrom: null, leftAt: null }, { id: "C", splitWeight: 100, joinedFrom: null, leftAt: null }];
    const bill = { amount: 6000, missed: JSON.stringify({ "2026-11": [10, 11] }), split: JSON.stringify({ mode: "equal" }) };
    // C leaves 15 Nov; 1–9 were already charged: days 12–15 = 4 × 6,000 ÷ 3 = 8,000.
    expect(dailyPrecharge(bill, "2026-11", "2026-11-15", members, "C", 10).amount).toBe(8000);
    expect(lastPartDay([{ m: "", a: 54000, e: "x", d: "2026-11-09", k: "part" }, { m: "C", a: 1, e: "y", d: "2026-11-12" }])).toBe(9);
  });
  it("someone who moved in on the 15th is there 5 of the 19 days: weights 19 : 19 : 19 : 5", () => {
    const w = joinWeights([{ id: "A", splitWeight: 100, joinedFrom: null }, { id: "D", splitWeight: 100, joinedFrom: new Date("2026-11-15T12:00:00Z") }], "2026-11", { from: 1, to: 19 });
    expect(w).toEqual({ A: 1900, D: 500 });
  });
  it("the word on a bill coming up", () => {
    expect(nextBillLabel({ status: "waiting", nature: "fixed", reason: "", payerId: "A" })).toBe("Overdue");
    expect(nextBillLabel({ status: "waiting", nature: "varies", reason: "", payerId: "A" })).toBe("Waiting for amount");
    expect(nextBillLabel({ status: "waiting", nature: "fixed", reason: "payer left", payerId: null })).toBe("Needs a payer");
    expect(nextBillLabel({ status: "upcoming", nature: "fixed", reason: "", payerId: "A" })).toBe("Next bill");
  });
});

describe("stopping a daily bill", () => {
  it("1. stop on 20 Nov adds Milk · 1–19 Nov = 114,000 (38,000 each), closes the month as stopped, and settling leaves everyone at 0", async () => {
    const f = await flat("one");
    const lines = await billChangeLines(f.billId, at("2026-11-20"));
    expect(lines?.stop?.amount).toBe(114000);
    expect(lines?.stop?.line).toContain("1–19 Nov");
    const r = await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"), { expect: 114000 });
    expect(r).toMatchObject({ ok: true });
    const list = await expensesOf(f.groupId);
    expect(list).toHaveLength(1);
    expect(list[0].description).toBe("Milk · 1–19 Nov");
    expect(list[0].amount).toBe(114000);
    expect(shareMap(list[0])).toEqual({ [f.a]: 38000, [f.b]: 38000, [f.c]: 38000 });
    const run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
    expect([run.status, run.reason]).toEqual(["skipped", "stopped"]);
    expect((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).deletedAt).not.toBeNull();
    let net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([76000, -38000, -38000]);
    await pay(f.groupId, f.b, f.a, 38000);
    await pay(f.groupId, f.c, f.a, 38000);
    net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([0, 0, 0]);
    // The daily job on 1 Dec adds nothing for a stopped bill.
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    expect(await db.expense.count({ where: { groupId: f.groupId } })).toBe(1);
    // The part charge is locked (the month is closed).
    expect((await setExpenseDeleted(list[0].id, f.a, true)).ok).toBe(false);
  });

  it("2. days 5 and 6 missed, C moved out 10 Nov (8 × 2,000 = 16,000), stop 20 Nov: 17 × 6,000 − 16,000 = 86,000 (43,000 each for A and B); month total 102,000", async () => {
    const f = await flat("two", { missed: JSON.stringify({ "2026-11": [5, 6] }) });
    const out = await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: `bps-two-${Date.now()}-abcdefgh` }, at("2026-11-10"));
    expect(out).toMatchObject({ ok: true });
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    const list = await expensesOf(f.groupId);
    const charge = list.find((e) => e.description.includes("share"))!;
    const part = list.find((e) => e.description === "Milk · 1–19 Nov")!;
    expect(charge.amount).toBe(16000);
    expect(part.amount).toBe(86000);
    expect(shareMap(part)).toEqual({ [f.a]: 43000, [f.b]: 43000 });
    expect(charge.amount + part.amount).toBe(17 * 6000);
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([43000, -43000, 0]);
  });

  it("3. stop on 1 Dec at 07:00 (before the daily job): November is added as normal, 30 × 6,000 = 180,000 (60,000 each); nothing for December; no duplicate later", async () => {
    const f = await flat("three");
    const early = new Date("2026-12-01T01:30:00Z"); // 07:00 in India
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", early)).ok).toBe(true);
    const list = await expensesOf(f.groupId);
    expect(list.map((e) => [e.description, e.amount])).toEqual([["Milk", 180000]]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 60000, [f.b]: 60000, [f.c]: 60000 });
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    expect(await db.expense.count({ where: { groupId: f.groupId } })).toBe(1);
    await checkBooks(f.groupId);
  });

  it("4. a bill with October still waiting for its amount can't be stopped; nothing is deleted", async () => {
    const f = await flat("four", { startMonth: "2026-10", nature: "varies" });
    await db.billRun.create({ data: { billId: f.billId, period: "2026-10", status: "waiting" } });
    const r = await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"));
    expect(r).toEqual({ ok: false, error: "Milk for October is still waiting for its amount. Enter it or skip it first, then stop the bill." });
    expect((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).deletedAt).toBeNull();
    expect((await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-10" } } })).status).toBe("waiting");
  });

  it("5. two stops at once: one part expense and one run", async () => {
    const f = await flat("five");
    await Promise.all([billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20")), billCommand(f.groupId, f.b, f.billId, "stop", at("2026-11-20"))]);
    expect(await db.expense.count({ where: { groupId: f.groupId, description: "Milk · 1–19 Nov" } })).toBe(1);
    expect(await db.billRun.count({ where: { billId: f.billId, period: "2026-11" } })).toBe(1);
    await checkBooks(f.groupId);
  });

  it("6. the confirm said 114,000, then day 3 was marked missed: the server works out 108,000, refuses and writes nothing", async () => {
    const f = await flat("six");
    expect((await toggleMissedDayFor(f.groupId, f.a, f.billId, "2026-11", 3)).ok).toBe(true);
    const r = await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"), { expect: 114000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Milk changed since you opened this. It now adds ₹1,080. Check and try again.");
    expect(await db.expense.count({ where: { groupId: f.groupId } })).toBe(0);
    expect((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).deletedAt).toBeNull();
    expect(18 * 6000).toBe(108000);
  });

  it("no payer: nothing is written and the person is told what to do", async () => {
    const f = await flat("nopayer");
    await db.bill.update({ where: { id: f.billId }, data: { payer: "gone-member" } });
    const r = await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"));
    expect(r).toEqual({ ok: false, error: "Milk needs a payer before it can be paused, so 1–19 Nov can be added. Pick who pays below." });
    expect(await db.expense.count({ where: { groupId: f.groupId } })).toBe(0);
    expect((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).paused).toBe(false);
  });
});

describe("pausing and starting again", () => {
  it("7. pause 20 Nov (114,000), start again 25 Nov: month end is 25 × 6,000 − 114,000 = 36,000 (12,000 each); balances A +100,000, B −50,000, C −50,000", async () => {
    const f = await flat("seven");
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"))).ok).toBe(true);
    expect((await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-25"))).ok).toBe(true);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await expensesOf(f.groupId);
    expect(list.map((e) => e.amount).sort((x, y) => x - y)).toEqual([36000, 114000]);
    const end = list.find((e) => e.description === "Milk")!;
    expect(shareMap(end)).toEqual({ [f.a]: 12000, [f.b]: 12000, [f.c]: 12000 });
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([100000, -50000, -50000]);
  });

  it("8. pause 20 Oct, start again 5 Dec: October stands as 114,000 (skipped, paused), November has no days, January adds 27 × 6,000 = 162,000, and the price can change", async () => {
    const f = await flat("eight", { startMonth: "2026-10" });
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-10-20"))).ok).toBe(true);
    expect((await expensesOf(f.groupId)).map((e) => e.amount)).toEqual([114000]);
    expect((await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-12-05"))).ok).toBe(true);
    const oct = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-10" } } });
    expect([oct.status, oct.reason]).toEqual(["skipped", "paused"]);
    await runBillsForGroup(f.groupId, at("2026-12-05"));
    const nov = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
    expect([nov.status, nov.reason]).toEqual(["skipped", "no days"]);
    await runBillsForGroup(f.groupId, at("2027-01-01"));
    const list = await expensesOf(f.groupId);
    expect(list.map((e) => e.amount).sort((x, y) => x - y)).toEqual([114000, 162000]);
    await checkBooks(f.groupId);
    const edit = await saveBillFor(f.groupId, f.a, { billId: f.billId, template: "milk", name: "Milk", nature: "daily", amount: "70", day: "31", payer: f.a, split: "equal", ids: [] }, at("2027-01-02"));
    expect(edit.ok).toBe(true);
  });

  it("9. pause 20 Oct, start again 5 Nov: October comes to 114,000 − 114,000 = 0, so it is closed as covered; one October expense, and it is locked", async () => {
    const f = await flat("nine", { startMonth: "2026-10" });
    await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-10-20"));
    await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-05"));
    await runBillsForGroup(f.groupId, at("2026-11-05"));
    const oct = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-10" } } });
    expect([oct.status, oct.reason]).toEqual(["skipped", "covered"]);
    const list = await expensesOf(f.groupId);
    expect(list.map((e) => e.amount)).toEqual([114000]);
    expect((await setExpenseDeleted(list[0].id, f.a, true)).ok).toBe(false);
    await checkBooks(f.groupId);
  });

  it("10. pause 10 Nov (9 × 6,000 = 54,000, 18,000 each), start again 12 Nov, C moves out 15 Nov (days 12–15 = 4 × 2,000 = 8,000); month end 168,000 − 54,000 − 8,000 = 106,000 (53,000 each)", async () => {
    const f = await flat("ten");
    await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-10"));
    await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-12"));
    const out = await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-15", addDaily: true, requestKey: `bps-ten-${Date.now()}-abcdefgh` }, at("2026-11-15"));
    expect(out).toMatchObject({ ok: true });
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await expensesOf(f.groupId);
    const byName = (n: string) => list.find((e) => e.description.startsWith(n) && !e.description.includes("·"))!;
    expect(list.find((e) => e.description === "Milk · 1–9 Nov")!.amount).toBe(54000);
    expect(list.find((e) => e.description.includes("share"))!.amount).toBe(8000);
    const end = byName("Milk");
    expect(end.amount).toBe(106000);
    expect(shareMap(end)).toEqual({ [f.a]: 53000, [f.b]: 53000 });
    expect(54000 + 8000 + 106000).toBe(28 * 6000 + 0);
    const net = await checkBooks(f.groupId);
    // A's own total is 18,000 + 53,000 = 71,000; C's 26,000 (13 days × 2,000) was paid in the move-out.
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([71000, -71000, 0]);
  });

  it("11. D moved in 15 Nov, pause 20 Nov: 114,000 shared 19 : 19 : 19 : 5 = A 34,936, B 34,935, C 34,935, D 9,194", async () => {
    const f = await flat("eleven", { extra: true });
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"))).ok).toBe(true);
    const e = (await expensesOf(f.groupId))[0];
    expect(e.amount).toBe(114000);
    expect(shareMap(e)).toEqual({ [f.a]: 34936, [f.b]: 34935, [f.c]: 34935, [f.d]: 9194 });
    expect(sum(e.shares.map((s) => s.amount))).toBe(114000);
    await checkBooks(f.groupId);
  });

  it("12. after the pause, a day already added (7) can't change and says so; a later day (22) can", async () => {
    const f = await flat("twelve");
    await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"));
    const locked = await toggleMissedDayFor(f.groupId, f.a, f.billId, "2026-11", 7);
    expect(locked).toEqual({ ok: false, error: "Milk for 1–19 Nov was already added when it was paused, so those days can’t change." });
    expect((await toggleMissedDayFor(f.groupId, f.a, f.billId, "2026-11", 22)).ok).toBe(true);
  });

  it("13. a bill paused 20 Oct before this release (no part charge), started again 5 Dec: 1–19 Oct, 114,000, is added then", async () => {
    const f = await flat("thirteen", { startMonth: "2026-10" });
    await db.bill.update({ where: { id: f.billId }, data: { paused: true, pausedAt: at("2026-10-20") } });
    const lines = await billChangeLines(f.billId, at("2026-12-05"));
    expect(lines?.resume?.amount).toBe(114000);
    expect(lines?.resume?.line).toBe("Starting again adds Milk for 1–19 Oct, ₹1,140 (from before it was paused).");
    expect((await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-12-05"), { expect: 114000 })).ok).toBe(true);
    const list = await expensesOf(f.groupId);
    expect(list.map((e) => [e.description, e.amount])).toEqual([["Milk · 1–19 Oct", 114000]]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 38000, [f.b]: 38000, [f.c]: 38000 });
    const oct = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-10" } } });
    expect([oct.status, oct.reason]).toEqual(["skipped", "paused"]);
    await checkBooks(f.groupId);
  });
});

describe("a deleted automatic bill expense can be added again (M8)", () => {
  const rate = async () => ({ ok: true as const, rate: "1", date: "2026-11-02" });
  async function rentFlat(label: string) {
    const f = await flat(label);
    await db.bill.update({ where: { id: f.billId }, data: { name: "Rent", nature: "fixed", amount: 1800000, day: 1, startMonth: "2026-11" } });
    await runBillsForGroup(f.groupId, at("2026-11-02"));
    const first = (await expensesOf(f.groupId))[0];
    return { ...f, first };
  }
  it("Rent 1,800,000 (600,000 each): delete → waiting 'deleted', the job doesn't add it twice, add it again once; the old one can't come back; balances A +1,200,000, B −600,000, C −600,000", async () => {
    const f = await rentFlat("rent1");
    expect(f.first.amount).toBe(1800000);
    expect((await setExpenseDeleted(f.first.id, f.a, true)).ok).toBe(true);
    let run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
    expect([run.status, run.reason]).toEqual(["waiting", "deleted"]);
    await runBillsForGroup(f.groupId, at("2026-11-03"));
    expect(await db.expense.count({ where: { groupId: f.groupId, deletedAt: null } })).toBe(0);
    const bill = await db.bill.findUniqueOrThrow({ where: { id: f.billId } });
    const members = await db.member.findMany({ where: { groupId: f.groupId } });
    const { billExpenseInput } = await import("@/lib/home/bills-db");
    const input: SaveExpenseInput = billExpenseInput(bill, f.groupId, "INR", "2026-11", 1800000, f.a, members);
    const r = await addWaitingBill(input, f.a, rate, { billId: f.billId, period: "2026-11" }, "rent-again-key-aaaa1");
    expect(r.ok).toBe(true);
    run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
    expect(run.status).toBe("added");
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([1200000, -600000, -600000]);
    const back = await setExpenseDeleted(f.first.id, f.a, false);
    expect(back).toEqual({ ok: false, error: "This month’s Rent was already added, so this can’t come back." });
  });
  it("restoring the deleted one before it is added again works, and the month is 'added' with the old expense", async () => {
    const f = await rentFlat("rent2");
    await setExpenseDeleted(f.first.id, f.a, true);
    expect((await setExpenseDeleted(f.first.id, f.a, false)).ok).toBe(true);
    const run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
    expect([run.status, run.expenseId]).toEqual(["added", f.first.id]);
    await checkBooks(f.groupId);
  });
});

// ---------- Audit fixes ----------
const rateOk = async () => ({ ok: true as const, rate: "1", date: "2026-11-02" });
const live = (groupId: string) => db.expense.findMany({ where: { groupId, deletedAt: null }, include: { shares: true }, orderBy: { createdAt: "asc" } });

describe("A1: a month that was already skipped or added gets no 'month so far'", () => {
  it("Nov skipped on 5 Nov, then paused on 20 Nov: nothing is added (not 114,000), the bill is paused, the confirm says nothing is added; books at 0", async () => {
    const f = await flat("a1");
    expect((await billCommand(f.groupId, f.a, f.billId, "skip", at("2026-11-05"))).ok).toBe(true);
    const lines = await billChangeLines(f.billId, at("2026-11-20"));
    expect(lines?.stop).toBeNull();
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"))).ok).toBe(true);
    expect(await live(f.groupId)).toHaveLength(0);
    expect((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).paused).toBe(true);
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([0, 0, 0]);
  });
  it("the same for Stop: the bill is stopped and nothing is charged", async () => {
    const f = await flat("a1b");
    await billCommand(f.groupId, f.a, f.billId, "skip", at("2026-11-05"));
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    expect(await live(f.groupId)).toHaveLength(0);
    expect((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).deletedAt).not.toBeNull();
    await checkBooks(f.groupId);
  });
});

describe("A2: the days after a pause are weighted by the days, even when nobody was missing", () => {
  it("D moved in 15 Nov; pause and start again on 20 Nov; the month end adds 20–30 Nov = 11 × 6,000 = 66,000 = 16,500 each for A, B, C and D", async () => {
    const f = await flat("a2", { extra: true });
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"))).ok).toBe(true);
    expect((await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-20"))).ok).toBe(true);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const list = await live(f.groupId);
    const end = list.find((e) => e.description === "Milk")!;
    expect(end.amount).toBe(66000);
    expect(shareMap(end)).toEqual({ [f.a]: 16500, [f.b]: 16500, [f.c]: 16500, [f.d]: 16500 });
    // Whole month: 114,000 shared 34,936 / 34,935 / 34,935 / 9,194, plus 66,000 → A 51,436, B 51,435, C 51,435, D 25,694 (sum 180,000); A paid it all.
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c], net[f.d]]).toEqual([128564, -51435, -51435, -25694]);
  });
});

describe("pausing, starting again and stopping: the days add up, once", () => {
  it("pause 20 Nov (P1 = 1–19 = 114,000), start again 25 Nov (20–24 not come), pause 28 Nov (P2 = 25–27 = 18,000), start again 29 Nov (28 not come), stop 30 Nov (P3 = 29 = 6,000): 23 days = 138,000; then settling leaves everyone at 0", async () => {
    const f = await flat("scen");
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"))).ok).toBe(true);
    expect((await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-25"))).ok).toBe(true);
    expect((await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-28"))).ok).toBe(true);
    // The days the pause charges cover (even the ones it left out) can't change.
    expect(await toggleMissedDayFor(f.groupId, f.a, f.billId, "2026-11", 22)).toEqual({ ok: false, error: "Milk for 20–27 Nov was already added when it was paused, so those days can’t change." });
    expect((await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-29"))).ok).toBe(true);
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-30"))).ok).toBe(true);
    const list = await live(f.groupId);
    expect(list.map((e) => [e.description, e.amount])).toEqual([["Milk · 1–19 Nov", 114000], ["Milk · 25–27 Nov", 18000], ["Milk · 29 Nov", 6000]]);
    expect(sum(list.map((e) => e.amount))).toBe(23 * 6000); // 138,000
    let net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([92000, -46000, -46000]);
    await pay(f.groupId, f.b, f.a, 46000);
    await pay(f.groupId, f.c, f.a, 46000);
    net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([0, 0, 0]);
    // Nothing more is added by the job.
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    expect(await live(f.groupId)).toHaveLength(3);
  });
  it("month end after a pause and start again: 25 days came, 150,000 − 114,000 = 36,000 more (12,000 each) — one block after the pause charge, A +100,000, B −50,000, C −50,000, then settled to 0", async () => {
    const f = await flat("monthend");
    await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"));
    await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-25"));
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    expect((await live(f.groupId)).map((e) => e.amount).sort((x, y) => x - y)).toEqual([36000, 114000]);
    let net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([100000, -50000, -50000]);
    await pay(f.groupId, f.b, f.a, 50000);
    await pay(f.groupId, f.c, f.a, 50000);
    net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([0, 0, 0]);
  });
  it("C3: D moved in 15 Nov; pause 20 Nov (114,000, shared 19 : 19 : 19 : 5); 22–23 Nov not come; month end = 20, 21 and 24–30 = 9 days = 54,000, 13,500 each (D was there for all 9)", async () => {
    const f = await flat("c3", { extra: true });
    await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"));
    await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-20"));
    for (const d of [22, 23]) expect((await toggleMissedDayFor(f.groupId, f.a, f.billId, "2026-11", d)).ok).toBe(true);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await live(f.groupId)).find((e) => e.description === "Milk")!;
    expect(end.amount).toBe(54000);
    expect(shareMap(end)).toEqual({ [f.a]: 13500, [f.b]: 13500, [f.c]: 13500, [f.d]: 13500 });
    // Whole month 168,000: A 34,936 + 13,500 = 48,436; B and C 48,435; D 9,194 + 13,500 = 22,694. A paid it all.
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c], net[f.d]]).toEqual([119564, -48435, -48435, -22694]);
  });
  it("a joiner who arrives later: D moves in 24 Nov; pause 20 Nov (114,000 = 38,000 each for A, B, C); 22–23 not come; month end 54,000 shared by person-days over 20–30 Nov (11 : 11 : 11 : 7), the same rule the part charge uses", async () => {
    const f = await flat("c3b", { extra: true });
    await db.member.update({ where: { id: f.d }, data: { joinedFrom: new Date("2026-11-24T12:00:00Z") } });
    await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-20"));
    await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-20"));
    for (const d of [22, 23]) await toggleMissedDayFor(f.groupId, f.a, f.billId, "2026-11", d);
    await runBillsForGroup(f.groupId, at("2026-12-01"));
    const end = (await live(f.groupId)).find((e) => e.description === "Milk")!;
    // Days that came 20, 21, 24–30 = 9 days = 54,000. Presence over 20–30 Nov: A, B, C 11 days each, D 7 (24–30): total 40.
    // 54,000 × 11 ÷ 40 = 14,850 each for A, B, C; 54,000 × 7 ÷ 40 = 9,450 for D; 3 × 14,850 + 9,450 = 54,000 exactly.
    expect(shareMap(end)).toEqual({ [f.a]: 14850, [f.b]: 14850, [f.c]: 14850, [f.d]: 9450 });
    expect(sum(end.shares.map((x) => x.amount))).toBe(54000);
    // Whole month 168,000, A paid it all: A, B, C owe 38,000 + 14,850 = 52,850 each; D owes 9,450. A: 168,000 − 52,850 = 115,150.
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c], net[f.d]]).toEqual([115150, -52850, -52850, -9450]);
  });
  it("a leaver after a pause is not charged for days the pause charge covered: pause 10 Nov, start again 12 Nov, C moves out 15 Nov", async () => {
    const f = await flat("leaver");
    await billCommand(f.groupId, f.a, f.billId, "pause", at("2026-11-10"));
    await billCommand(f.groupId, f.a, f.billId, "resume", at("2026-11-12"));
    const out = await moveOut(f.groupId, f.a, { leaverId: f.c, lastDay: "2026-11-15", addDaily: true, requestKey: `bps-lv-${Date.now()}-abcdefgh` }, at("2026-11-15"));
    expect(out).toMatchObject({ ok: true });
    const charge = (await live(f.groupId)).find((e) => e.description.includes("share"))!;
    expect(charge.amount).toBe(8000); // days 12–15 = 4 × 6,000 ÷ 3
    await checkBooks(f.groupId);
  });
});

describe("A4: a month added again can't have the old expense back, however it was renamed", () => {
  it("Rent 1,800,000 deleted and re-added as 'Rent Nov': restoring the first is refused; B and C each owe 600,000, not 1,200,000", async () => {
    const f = await flat("a4");
    await db.bill.update({ where: { id: f.billId }, data: { name: "Rent", nature: "fixed", amount: 1800000, day: 1, startMonth: "2026-11" } });
    await runBillsForGroup(f.groupId, at("2026-11-02"));
    const first = (await live(f.groupId))[0];
    await setExpenseDeleted(first.id, f.a, true);
    const bill = await db.bill.findUniqueOrThrow({ where: { id: f.billId } });
    const members = await db.member.findMany({ where: { groupId: f.groupId } });
    const input: SaveExpenseInput = { ...billExpenseInput(bill, f.groupId, "INR", "2026-11", 1800000, f.a, members), name: "Rent Nov", date: "2026-11-09" };
    expect((await addWaitingBill(input, f.a, rateOk, { billId: f.billId, period: "2026-11" }, "a4-again-key-aaaa1")).ok).toBe(true);
    expect(await db.requestKey.count({ where: { key: `bill-replaced:${first.id}` } })).toBe(1);
    expect((await setExpenseDeleted(first.id, f.a, false)).ok).toBe(false);
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([1800000]);
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([1200000, -600000, -600000]);
  });
  it("an unrelated expense with the same name and month no longer stops a restore (no guessing by name)", async () => {
    const f = await flat("a4b");
    await db.bill.update({ where: { id: f.billId }, data: { name: "Rent", nature: "fixed", amount: 1800000, day: 1, startMonth: "2026-11" } });
    await runBillsForGroup(f.groupId, at("2026-11-02"));
    const first = (await live(f.groupId))[0];
    await setExpenseDeleted(first.id, f.a, true);
    expect((await setExpenseDeleted(first.id, f.a, false)).ok).toBe(true);
    await checkBooks(f.groupId);
  });
});

describe("A6: Stop adds a legacy pause's days, like Start again", () => {
  it("paused 20 Oct before this release, stopped 25 Nov: 1–19 Oct, 114,000 (38,000 each), is added and the bill is stopped", async () => {
    const f = await flat("a6", { startMonth: "2026-10" });
    await db.bill.update({ where: { id: f.billId }, data: { paused: true, pausedAt: at("2026-10-20") } });
    const lines = await billChangeLines(f.billId, at("2026-11-25"));
    expect(lines?.stop?.amount).toBe(114000);
    expect(lines?.stop?.line).toContain("Milk for 1–19 Oct");
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-25"), { expect: 114000 })).ok).toBe(true);
    const list = await live(f.groupId);
    expect(list.map((e) => [e.description, e.amount])).toEqual([["Milk · 1–19 Oct", 114000]]);
    expect(shareMap(list[0])).toEqual({ [f.a]: 38000, [f.b]: 38000, [f.c]: 38000 });
    expect((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).deletedAt).not.toBeNull();
    await checkBooks(f.groupId);
  });
});

describe("A8: a month whose expense was deleted does not hold back Stop, and is not 'waiting' on Home", () => {
  it("October waiting as 'deleted': the status is not waiting, and Stop works", async () => {
    const f = await flat("a8", { startMonth: "2026-10" });
    await db.billRun.create({ data: { billId: f.billId, period: "2026-10", status: "waiting", reason: "deleted", expenseId: "gone-expense" } });
    const status = (await billStatuses(f.groupId, at("2026-11-20")))[0];
    expect(status.status).not.toBe("waiting");
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-20"))).ok).toBe(true);
    expect((await live(f.groupId)).map((e) => e.amount)).toEqual([114000]);
    await checkBooks(f.groupId);
  });
});

describe("B3: a month added again that crashed part-way still remembers what it replaced", () => {
  it("Rent deleted, added again, then the run looks unfinished (as after a crash): the daily job finishes it and the old expense still can't come back", async () => {
    const f = await flat("b3");
    await db.bill.update({ where: { id: f.billId }, data: { name: "Rent", nature: "fixed", amount: 1800000, day: 1, startMonth: "2026-11" } });
    await runBillsForGroup(f.groupId, at("2026-11-02"));
    const first = (await live(f.groupId))[0];
    await setExpenseDeleted(first.id, f.a, true);
    const bill = await db.bill.findUniqueOrThrow({ where: { id: f.billId } });
    const members = await db.member.findMany({ where: { groupId: f.groupId } });
    const input: SaveExpenseInput = { ...billExpenseInput(bill, f.groupId, "INR", "2026-11", 1800000, f.a, members), name: "Rent again" };
    const key = "b3-again-key-aaaaaa1";
    const added = await addWaitingBill(input, f.a, rateOk, { billId: f.billId, period: "2026-11" }, key);
    expect(added.ok).toBe(true);
    // The crash: the expense is saved, but the month still says "adding" with the old expense, and the note was never written.
    await db.billRun.update({ where: { billId_period: { billId: f.billId, period: "2026-11" } }, data: { status: "adding", expenseId: first.id, requestKey: key, claimedAt: new Date("2026-11-03T00:00:00Z") } });
    await db.requestKey.deleteMany({ where: { key: `bill-replaced:${first.id}` } });
    await runBillsForGroup(f.groupId, at("2026-11-20"));
    const run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } });
    expect(run.status).toBe("added");
    expect(run.expenseId).toBe(added.ok ? added.id : "");
    expect(await db.requestKey.count({ where: { key: `bill-replaced:${first.id}` } })).toBe(1);
    expect((await setExpenseDeleted(first.id, f.a, false)).ok).toBe(false);
    const net = await checkBooks(f.groupId);
    expect([net[f.a], net[f.b], net[f.c]]).toEqual([1200000, -600000, -600000]);
  });
});

describe("B6: Skip this time ignores a month waiting because its expense was deleted", () => {
  it("November waits as 'deleted': skipping skips December, and November still waits to be added again", async () => {
    const f = await flat("b6");
    await db.billRun.create({ data: { billId: f.billId, period: "2026-11", status: "waiting", reason: "deleted", expenseId: "gone-expense" } });
    expect((await billCommand(f.groupId, f.a, f.billId, "skip", at("2026-11-20"))).ok).toBe(true);
    const runs = await db.billRun.findMany({ where: { billId: f.billId }, orderBy: { period: "asc" } });
    expect(runs.map((r) => [r.period, r.status, r.reason])).toEqual([["2026-11", "waiting", "deleted"], ["2026-12", "skipped", "skipped"]]);
    await checkBooks(f.groupId);
  });
});

describe("B8: days before a very old pause are not added automatically, and the confirm says so", () => {
  it("paused in May 2023 before this release, stopped Nov 2026: nothing is added for May, the bill stops, and the confirm names the month", async () => {
    const f = await flat("b8", { startMonth: "2022-01" });
    await db.bill.update({ where: { id: f.billId }, data: { paused: true, pausedAt: new Date("2023-05-10T06:00:00Z") } });
    const lines = await billChangeLines(f.billId, at("2026-11-25"));
    expect(lines?.stop?.line).toContain("Days before the pause in May aren’t added automatically.");
    expect(lines?.stop?.amount).toBe(0);
    expect((await billCommand(f.groupId, f.a, f.billId, "stop", at("2026-11-25"), { expect: 0 })).ok).toBe(true);
    expect(await live(f.groupId)).toHaveLength(0);
    expect((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).deletedAt).not.toBeNull();
    await checkBooks(f.groupId);
  });
});
