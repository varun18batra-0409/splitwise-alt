import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dailyTotal } from "@/lib/home/bills";
import { addPrepaid, dailyPrecharge, parsePrepaid, removePrepaid } from "@/lib/home/moving";
import { moveOut, moveOutPreview } from "@/lib/home/moving-db";
import { runBillsForGroup } from "@/lib/home/bills-db";
import { loadGroup } from "@/lib/group-data";
import { undoEvent } from "@/lib/undo";
import { allocateByWeights } from "@/lib/split";
import { setExpenseDeleted } from "@/lib/save-expense";

// Daily bills (milk, water cans) when someone moves out part-way through the month.
// A daily bill is added once its month is over, shared by whoever is still in the flat.
// The leaver's share for the days they were there is worked out at move-out ("Add it now");
// the month-end bill is then the month's total less that, shared by the others.
// All amounts are paise; the leaver's share is rounded DOWN once, at the end.

const member = (id: string, splitWeight = 100, extra: { joinedFrom?: Date; leftAt?: Date } = {}) => ({ id, splitWeight, joinedFrom: extra.joinedFrom ?? null, leftAt: extra.leftAt ?? null });
const equal = JSON.stringify({ mode: "equal" });
const group = JSON.stringify({ mode: "group" });

describe("the leaver's share of a daily bill (hand-worked)", () => {
  it("Milk ₹48/day, 3 equal, Ravi's last day 14 Nov, 5 Nov missed: 13 days, 13 × 4800 ÷ 3 = 20800; month end 118400 = 59200 + 59200", () => {
    const bill = { amount: 4800, missed: JSON.stringify({ "2026-11": [5] }), split: equal };
    const r = dailyPrecharge(bill, "2026-11", "2026-11-14", [member("A"), member("R"), member("M")], "R");
    expect(r).toEqual({ days: 13, missed: [5], amount: 20800, unsupported: false });
    const total = dailyTotal(bill, "2026-11");
    expect(total).toEqual({ days: 29, amount: 139200 }); // (30 − 1) × 4800
    const rest = total.amount - r.amount;
    expect(rest).toBe(118400);
    const split = allocateByWeights(rest, [{ memberId: "A", weight: 100 }, { memberId: "M", weight: 100 }]);
    expect(split.map((x) => x.amount)).toEqual([59200, 59200]);
    expect(r.amount + split.reduce((s, x) => s + x.amount, 0)).toBe(139200); // nothing lost, nothing added
  });

  it("Water ₹30/day, the flat's own split A 1 : R 1 : M 2, Ravi leaves 10 Nov: 10 × 3000 × 100 ÷ 400 = 7500; month end 82500 = 27500 + 55000", () => {
    const bill = { amount: 3000, missed: "{}", split: group };
    const r = dailyPrecharge(bill, "2026-11", "2026-11-10", [member("A", 100), member("R", 100), member("M", 200)], "R");
    expect(r.amount).toBe(7500);
    const total = dailyTotal(bill, "2026-11");
    expect(total.amount).toBe(90000);
    const split = allocateByWeights(total.amount - r.amount, [{ memberId: "A", weight: 100 }, { memberId: "M", weight: 200 }]);
    expect(split.map((x) => x.amount)).toEqual([27500, 55000]);
    expect(7500 + 27500 + 55000).toBe(90000);
  });

  it("₹50/day, 3 equal, Ravi there 1–10 Nov: 10 × 5000 ÷ 3 = 16666.67 → 16666 (rounded down); month end 133334 = 66667 + 66667", () => {
    const bill = { amount: 5000, missed: "{}", split: equal };
    const r = dailyPrecharge(bill, "2026-11", "2026-11-10", [member("A"), member("R"), member("M")], "R");
    expect(r.amount).toBe(16666);
    const total = dailyTotal(bill, "2026-11");
    expect(total.amount).toBe(150000);
    const split = allocateByWeights(total.amount - r.amount, [{ memberId: "A", weight: 100 }, { memberId: "M", weight: 100 }]);
    expect(split.map((x) => x.amount)).toEqual([66667, 66667]);
    expect(16666 + 66667 + 66667).toBe(150000);
  });

  it("someone who moved in on 10 Nov: days 1–9 shared by two (9 × 4800 ÷ 2 = 21600), days 10–14 by three (5 × 4800 ÷ 3 = 8000) = 29600", () => {
    const bill = { amount: 4800, missed: "{}", split: equal };
    const members = [member("A"), member("R"), member("M", 100, { joinedFrom: new Date("2026-11-10T12:00:00Z") })];
    expect(dailyPrecharge(bill, "2026-11", "2026-11-14", members, "R").amount).toBe(29600);
  });

  it("someone who moved in on the 6th pays only from the 6th: 9 days (6–14) × 4800 ÷ 3 = 14400", () => {
    const bill = { amount: 4800, missed: "{}", split: equal };
    const members = [member("A"), member("R", 100, { joinedFrom: new Date("2026-11-06T12:00:00Z") }), member("M")];
    const r = dailyPrecharge(bill, "2026-11", "2026-11-14", members, "R");
    expect(r.days).toBe(9);
    expect(r.amount).toBe(14400);
  });

  it("an earlier leaver still counts on the days they were there: Zed left 3 Nov, so days 1–3 are shared by four (3 × 4800 ÷ 4 = 3600), days 4–14 by three (11 × 4800 ÷ 3 = 17600) = 21200", () => {
    const bill = { amount: 4800, missed: "{}", split: equal };
    const members = [member("A"), member("R"), member("M"), member("Z", 100, { leftAt: new Date("2026-11-03T12:00:00Z") })];
    expect(dailyPrecharge(bill, "2026-11", "2026-11-14", members, "R").amount).toBe(21200);
  });

  it("percentage split: 25% × 10 days × ₹50 = 12500; only some people: ₹50 × 10 ÷ 2 = 25000; fixed amounts are left to work out by hand", () => {
    const members = [member("A"), member("R"), member("M")];
    expect(dailyPrecharge({ amount: 5000, missed: "{}", split: JSON.stringify({ mode: "percent", pct: { A: 5000, R: 2500, M: 2500 } }) }, "2026-11", "2026-11-10", members, "R").amount).toBe(12500);
    expect(dailyPrecharge({ amount: 5000, missed: "{}", split: JSON.stringify({ mode: "some", ids: ["A", "R"] }) }, "2026-11", "2026-11-10", members, "R").amount).toBe(25000);
    const left = dailyPrecharge({ amount: 5000, missed: "{}", split: JSON.stringify({ mode: "some", ids: ["A", "M"] }) }, "2026-11", "2026-11-10", members, "R");
    expect(left.amount).toBe(0); // not in this bill at all
    const hand = dailyPrecharge({ amount: 5000, missed: "{}", split: JSON.stringify({ mode: "amounts", amt: { A: 2000, R: 1500, M: 1500 } }) }, "2026-11", "2026-11-10", members, "R");
    expect(hand).toMatchObject({ unsupported: true, amount: 0 });
  });

  it("invariant: the shares of everyone leaving on the same day never add up to more than the days' cost, and are within a paisa each", () => {
    for (const [rate, last] of [[4800, 14], [5000, 10], [3333, 29], [101, 7], [7, 30]] as const) {
      const members = [member("A"), member("R"), member("M")];
      const bill = { amount: rate, missed: "{}", split: equal };
      const parts = ["A", "R", "M"].map((id) => dailyPrecharge(bill, "2026-11", `2026-11-${String(last).padStart(2, "0")}`, members, id).amount);
      const cost = rate * last;
      const sum = parts.reduce((s, x) => s + x, 0);
      expect(sum).toBeLessThanOrEqual(cost);
      expect(cost - sum).toBeLessThan(3);
    }
  });

  it("a last day in another month, or a bill that is not charged, gives nothing", () => {
    const members = [member("A"), member("R")];
    expect(dailyPrecharge({ amount: 4800, missed: "{}", split: equal }, "2026-10", "2026-11-14", members, "R").amount).toBe(0);
    expect(dailyPrecharge({ amount: 0, missed: "{}", split: equal }, "2026-11", "2026-11-14", members, "R").amount).toBe(0);
  });

  it("the 'already paid' note round-trips and ignores rubbish", () => {
    const one = addPrepaid("{}", "2026-11", { m: "R", a: 20800, e: "e1", d: "2026-11-14" });
    expect(parsePrepaid(one)).toEqual({ "2026-11": [{ m: "R", a: 20800, e: "e1", d: "2026-11-14" }] });
    expect(parsePrepaid(removePrepaid(one, "2026-11", "e1"))).toEqual({});
    expect(parsePrepaid("not json")).toEqual({});
    expect(parsePrepaid(JSON.stringify({ "2026-11": [{ m: "R", a: -5, e: "x" }, "junk"] }))).toEqual({ "2026-11": [] });
  });
});

// ---------- Against the database ----------

const groupIds: string[] = [];
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

async function flat(label: string, opts: { weights?: [number, number, number]; rate: number; split: string; missed?: string }) {
  const w = opts.weights ?? [100, 100, 100];
  const g = await db.group.create({
    data: {
      name: `Flat ${label}`, type: "home", currency: "INR", inviteCode: `dp-${label}-${Date.now()}`,
      members: { create: [{ name: "Asha", splitWeight: w[0] }, { name: "Ravi", splitWeight: w[1] }, { name: "Meera", splitWeight: w[2] }] },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  const [asha, ravi, meera] = [id("Asha"), id("Ravi"), id("Meera")];
  const bill = await db.bill.create({ data: { groupId: g.id, name: "Milk", category: "groceries", nature: "daily", amount: opts.rate, startMonth: "2026-11", payer: asha, split: opts.split, missed: opts.missed ?? "{}" } });
  return { groupId: g.id, asha, ravi, meera, billId: bill.id };
}

const key = (label: string) => `dp-${label}-${Date.now()}-abcdefgh`;
const monthEnd = new Date("2026-12-01T06:00:00Z");
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("moving out with a daily bill, end to end", () => {
  it("example 1: preview shows 13 days and ₹208; Add it now charges it, Ravi pays Asha 20800 and ends at 0; month end is 118400 split 59200 + 59200", async () => {
    const f = await flat("one", { rate: 4800, split: equal, missed: JSON.stringify({ "2026-11": [5] }) });
    const now = new Date("2026-11-14T06:00:00Z");
    const p = await moveOutPreview(f.groupId, f.ravi, "2026-11-14", now);
    if (!p.ok) throw new Error(p.error);
    expect(p.daily).toEqual([{ billId: f.billId, name: "Milk", days: 13, missed: [5], amount: 20800, unsupported: false }]);
    expect(p.payments).toEqual([]); // without it, nothing to pay
    expect(p.paymentsWithDaily).toEqual([{ from: f.ravi, to: f.asha, amount: 20800 }]);

    const r = await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-14", addDaily: true, requestKey: key("one") }, now);
    expect(r).toEqual({ ok: true, payments: [{ from: f.ravi, to: f.asha, amount: 20800 }] });

    const pre = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: { contains: "Ravi" } }, include: { shares: true } });
    expect(pre.description).toBe("Milk · 1–14 Nov (Ravi’s share)");
    expect(pre.amount).toBe(20800);
    expect(pre.paidById).toBe(f.asha);
    expect(pre.shares.map((s) => [s.memberId, s.amount])).toEqual([[f.ravi, 20800]]); // shares add up to the amount
    const bill = await db.bill.findUniqueOrThrow({ where: { id: f.billId } });
    expect(JSON.parse(bill.prepaid)).toEqual({ "2026-11": [{ m: f.ravi, a: 20800, e: pre.id, d: "2026-11-14" }] });
    let data = (await loadGroup(f.groupId))!;
    expect(data.net[f.ravi]).toBe(0);
    expect(sum(Object.values(data.net))).toBe(0);

    // The month ends: Milk is added for the total less Ravi's share, split between the two still there.
    const run = await runBillsForGroup(f.groupId, monthEnd);
    expect(run.added).toBe(1);
    const milk = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: "Milk" }, include: { shares: true } });
    expect(milk.amount).toBe(118400);
    expect(Object.fromEntries(milk.shares.map((s) => [s.memberId, s.amount]))).toEqual({ [f.asha]: 59200, [f.meera]: 59200 });
    expect(sum(milk.shares.map((s) => s.amount))).toBe(milk.amount);
    expect(milk.notes).toContain("29 days");
    expect(milk.notes).toContain("less");
    expect(milk.notes).toContain("Ravi");
    data = (await loadGroup(f.groupId))!;
    expect(sum(Object.values(data.net))).toBe(0);
    expect(data.net[f.ravi]).toBe(0); // paid up, owes nothing more
    // The whole month cost 139200: 20800 + 59200 + 59200 + ... = 139200 across the two expenses.
    expect(pre.amount + milk.amount).toBe(139200);
  });

  it("example 2: water cans ₹30/day, shares 1 : 1 : 2, Ravi leaves 10 Nov: 7500, then 82500 = 27500 + 55000", async () => {
    const f = await flat("two", { rate: 3000, split: group, weights: [100, 100, 200] });
    const now = new Date("2026-11-10T06:00:00Z");
    const r = await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-10", addDaily: true, requestKey: key("two") }, now);
    expect(r).toEqual({ ok: true, payments: [{ from: f.ravi, to: f.asha, amount: 7500 }] });
    await runBillsForGroup(f.groupId, monthEnd);
    const milk = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: "Milk" }, include: { shares: true } });
    expect(milk.amount).toBe(82500);
    expect(Object.fromEntries(milk.shares.map((s) => [s.memberId, s.amount]))).toEqual({ [f.asha]: 27500, [f.meera]: 55000 });
    const data = (await loadGroup(f.groupId))!;
    expect(sum(Object.values(data.net))).toBe(0);
    expect(data.net[f.ravi]).toBe(0);
  });

  it("example 3: ₹50/day, Ravi 1–10 Nov: 16666 (rounded down), then 133334 = 66667 + 66667; the whole month adds back to 150000", async () => {
    const f = await flat("three", { rate: 5000, split: equal });
    const now = new Date("2026-11-10T06:00:00Z");
    const r = await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-10", addDaily: true, requestKey: key("three") }, now);
    expect(r).toEqual({ ok: true, payments: [{ from: f.ravi, to: f.asha, amount: 16666 }] });
    await runBillsForGroup(f.groupId, monthEnd);
    const milk = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: "Milk" }, include: { shares: true } });
    expect(milk.amount).toBe(133334);
    expect(milk.shares.map((s) => s.amount).sort()).toEqual([66667, 66667]);
    const pre = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: { contains: "share" } } });
    expect(pre.amount + milk.amount).toBe(150000);
  });

  it("Add it now left off: nothing is charged to Ravi, and the others pay the whole month (₹1,392 = 69600 + 69600)", async () => {
    const f = await flat("off", { rate: 4800, split: equal, missed: JSON.stringify({ "2026-11": [5] }) });
    const now = new Date("2026-11-14T06:00:00Z");
    const r = await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-14", requestKey: key("off") }, now);
    expect(r).toEqual({ ok: true, payments: [] });
    expect(JSON.parse((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).prepaid)).toEqual({});
    await runBillsForGroup(f.groupId, monthEnd);
    const milk = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: "Milk" }, include: { shares: true } });
    expect(milk.amount).toBe(139200);
    expect(milk.shares.map((s) => s.amount)).toEqual([69600, 69600]);
    expect(sum(Object.values((await loadGroup(f.groupId))!.net))).toBe(0);
  });

  it("undo before the month is added: the charge is deleted, the note is empty, and the month-end bill is the whole month again", async () => {
    const f = await flat("undo", { rate: 4800, split: equal, missed: JSON.stringify({ "2026-11": [5] }) });
    const now = new Date("2026-11-14T06:00:00Z");
    expect((await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-14", addDaily: true, requestKey: key("undo") }, now)).ok).toBe(true);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.groupId, kind: "member_left" }, orderBy: { createdAt: "desc" } });
    const u = await undoEvent(ev.id, f.asha);
    expect(u.ok).toBe(true);
    const pre = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: { contains: "share" } } });
    expect(pre.deletedAt).not.toBeNull();
    expect(JSON.parse((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).prepaid)).toEqual({});
    expect((await db.member.findUniqueOrThrow({ where: { id: f.ravi } })).leftAt).toBeNull();
    // Ravi is back in the flat, so the month is shared by all three: 139200 ÷ 3 = 46400 each.
    await runBillsForGroup(f.groupId, monthEnd);
    const milk = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: "Milk" }, include: { shares: true } });
    expect(milk.amount).toBe(139200);
    expect(milk.shares.map((s) => s.amount)).toEqual([46400, 46400, 46400]);
  });

  it("undo after the month's bill was added is refused, and nothing changes", async () => {
    const f = await flat("late", { rate: 4800, split: equal, missed: JSON.stringify({ "2026-11": [5] }) });
    const now = new Date("2026-11-14T06:00:00Z");
    expect((await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-14", addDaily: true, requestKey: key("late") }, now)).ok).toBe(true);
    await runBillsForGroup(f.groupId, monthEnd);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.groupId, kind: "member_left" }, orderBy: { createdAt: "desc" } });
    const u = await undoEvent(ev.id, f.asha);
    expect(u).toEqual({ ok: false, error: "This month’s Milk was already added, so the move-out can’t be undone. Edit Milk instead." });
    expect((await db.member.findUniqueOrThrow({ where: { id: f.ravi } })).leftAt).not.toBeNull();
    const pre = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: { contains: "share" } } });
    expect(pre.deletedAt).toBeNull();
    expect(Object.keys(JSON.parse((await db.bill.findUniqueOrThrow({ where: { id: f.billId } })).prepaid))).toEqual(["2026-11"]);
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: ev.id } })).undoneAt).toBeNull(); // can be tried again
  });

  it("a charge that was deleted by hand no longer comes off the month-end bill; one that covers the whole month skips it", async () => {
    const f = await flat("del", { rate: 4800, split: equal });
    const now = new Date("2026-11-14T06:00:00Z");
    expect((await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-14", addDaily: true, requestKey: key("del") }, now)).ok).toBe(true);
    const pre = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: { contains: "share" } } });
    await db.expense.update({ where: { id: pre.id }, data: { deletedAt: new Date() } });
    await runBillsForGroup(f.groupId, monthEnd);
    const milk = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: "Milk" } });
    expect(milk.amount).toBe(30 * 4800); // the deleted charge doesn't count

    const g = await flat("covered", { rate: 100, split: equal });
    const e = await db.expense.create({
      data: {
        groupId: g.groupId, description: "Milk · charge", amount: 3000, paidById: g.asha, createdById: g.asha, splitType: "exact", forMode: "selected",
        originalAmount: 3000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 3000, shares: { create: [{ memberId: g.ravi, amount: 3000 }] },
      },
    });
    await db.bill.update({ where: { id: g.billId }, data: { prepaid: addPrepaid("{}", "2026-11", { m: g.ravi, a: 3000, e: e.id }) } }); // 30 × 100 = 3000: all of it
    await runBillsForGroup(g.groupId, monthEnd);
    const runRow = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: g.billId, period: "2026-11" } } });
    expect(runRow).toMatchObject({ status: "skipped", reason: "covered" });
    expect(await db.expense.count({ where: { groupId: g.groupId, description: "Milk" } })).toBe(0);
  });
});

// ---------- Audit fixes: the charge as it is now, who is credited, and the preview ----------

describe("the move-out charge after it was changed, and who is credited for it", () => {
  const chargeOf = (groupId: string) => db.expense.findFirstOrThrow({ where: { groupId, description: { contains: "share" } }, include: { shares: true } });

  it("the charge was edited 20800 → 15000: the month-end bill takes off 15000 (not the 20800 written down): 139200 − 15000 = 124200 = 62100 + 62100; every balance adds to 0", async () => {
    const f = await flat("edited", { rate: 4800, split: equal, missed: JSON.stringify({ "2026-11": [5] }) });
    const now = new Date("2026-11-14T06:00:00Z");
    expect((await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-14", addDaily: true, requestKey: key("edited") }, now)).ok).toBe(true);
    const pre = await chargeOf(f.groupId);
    expect(pre.amount).toBe(20800);
    // Someone corrects the charge to 15000 (the amount and Ravi's share together).
    await db.expense.update({ where: { id: pre.id }, data: { amount: 15000, originalAmount: 15000, convertedAmount: 15000, shares: { updateMany: { where: { memberId: f.ravi }, data: { amount: 15000 } } } } });

    expect((await runBillsForGroup(f.groupId, monthEnd)).added).toBe(1);
    const milk = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: "Milk" }, include: { shares: true } });
    expect(milk.amount).toBe(124200); // 29 days × 4800 = 139200, less 15000
    expect(Object.fromEntries(milk.shares.map((x) => [x.memberId, x.amount]))).toEqual({ [f.asha]: 62100, [f.meera]: 62100 });
    expect(milk.notes).toContain("₹150"); // the note names what was really taken off
    expect(milk.notes).not.toContain("₹208");

    // Asha paid both: +15000 (the charge) +124200 (Milk) −62100 (her share) −20800 (Ravi's payment at move-out) = 56300.
    // Ravi: −15000 + 20800 = +5800 (he paid 20800 and the charge became 15000). Meera: −62100.
    const net = (await loadGroup(f.groupId))!.net;
    expect(net[f.asha]).toBe(56300);
    expect(net[f.ravi]).toBe(5800);
    expect(net[f.meera]).toBe(-62100);
    expect(sum(Object.values(net))).toBe(0);
  });

  it("a charge edited up to the whole month's cost (30 × ₹1 = 3000) skips the month-end bill as 'covered'", async () => {
    const f = await flat("cover", { rate: 100, split: equal });
    const now = new Date("2026-11-14T06:00:00Z");
    expect((await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-14", addDaily: true, requestKey: key("cover") }, now)).ok).toBe(true);
    const pre = await chargeOf(f.groupId);
    await db.expense.update({ where: { id: pre.id }, data: { amount: 3000, originalAmount: 3000, convertedAmount: 3000, shares: { updateMany: { where: { memberId: f.ravi }, data: { amount: 3000 } } } } });
    await runBillsForGroup(f.groupId, monthEnd);
    expect(await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: f.billId, period: "2026-11" } } })).toMatchObject({ status: "skipped", reason: "covered" });
  });

  it("deleted, then the month is added, then restore is refused with a plain sentence and nothing changes", async () => {
    const f = await flat("restore", { rate: 4800, split: equal, missed: JSON.stringify({ "2026-11": [5] }) });
    const now = new Date("2026-11-14T06:00:00Z");
    expect((await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-14", addDaily: true, requestKey: key("restore") }, now)).ok).toBe(true);
    const pre = await chargeOf(f.groupId);
    expect((await setExpenseDeleted(pre.id, f.asha, true)).ok).toBe(true);
    // The month is added without it: the whole month, 139200 = 69600 + 69600.
    await runBillsForGroup(f.groupId, monthEnd);
    const milk = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: "Milk" } });
    expect(milk.amount).toBe(139200);
    const r = await setExpenseDeleted(pre.id, f.asha, false);
    expect(r).toEqual({ ok: false, error: "This month’s Milk was already added, so this charge can’t come back. Add it again by hand if needed." });
    expect((await db.expense.findUniqueOrThrow({ where: { id: pre.id } })).deletedAt).not.toBeNull();
  });

  it("deleted and restored BEFORE the month is added is fine, and counts again: the month-end bill is 118400", async () => {
    const f = await flat("restore-early", { rate: 4800, split: equal, missed: JSON.stringify({ "2026-11": [5] }) });
    const now = new Date("2026-11-14T06:00:00Z");
    expect((await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-14", addDaily: true, requestKey: key("restore-early") }, now)).ok).toBe(true);
    const pre = await chargeOf(f.groupId);
    expect((await setExpenseDeleted(pre.id, f.asha, true)).ok).toBe(true);
    expect((await setExpenseDeleted(pre.id, f.asha, false)).ok).toBe(true);
    await runBillsForGroup(f.groupId, monthEnd);
    expect((await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: "Milk" } })).amount).toBe(118400);
  });

  it("the payer changed before month end (Asha → Meera): the charge is credited to Meera too, shares unchanged; Meera is credited the whole month (20800 + 118400 = 139200); balances add to 0", async () => {
    const f = await flat("payer", { rate: 4800, split: equal, missed: JSON.stringify({ "2026-11": [5] }) });
    const now = new Date("2026-11-14T06:00:00Z");
    expect((await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-14", addDaily: true, requestKey: key("payer") }, now)).ok).toBe(true);
    expect((await chargeOf(f.groupId)).paidById).toBe(f.asha); // chosen at move-out
    await db.bill.update({ where: { id: f.billId }, data: { payer: f.meera } }); // Meera pays Milk from now on

    await runBillsForGroup(f.groupId, monthEnd);
    const milk = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: "Milk" }, include: { shares: true } });
    expect(milk.paidById).toBe(f.meera);
    expect(milk.amount).toBe(118400);
    const pre = await chargeOf(f.groupId);
    expect(pre.paidById).toBe(f.meera);
    expect(pre.payers).toBe("");
    expect(pre.shares.map((x) => [x.memberId, x.amount])).toEqual([[f.ravi, 20800]]); // still only Ravi's
    expect(pre.amount + milk.amount).toBe(139200);

    // Asha: −59200 (Milk share) −20800 (Ravi's payment at move-out) = −80000. Meera: +20800 +118400 −59200 = +80000. Ravi: −20800 +20800 = 0.
    const net = (await loadGroup(f.groupId))!.net;
    expect(net[f.asha]).toBe(-80000);
    expect(net[f.meera]).toBe(80000);
    expect(net[f.ravi]).toBe(0);
    expect(sum(Object.values(net))).toBe(0);
  });

  it("when the payer stays the same nothing about the charge changes", async () => {
    const f = await flat("same-payer", { rate: 4800, split: equal });
    const now = new Date("2026-11-14T06:00:00Z");
    expect((await moveOut(f.groupId, f.asha, { leaverId: f.ravi, lastDay: "2026-11-14", addDaily: true, requestKey: key("same-payer") }, now)).ok).toBe(true);
    await runBillsForGroup(f.groupId, monthEnd);
    expect((await chargeOf(f.groupId)).paidById).toBe(f.asha);
    expect(sum(Object.values((await loadGroup(f.groupId))!.net))).toBe(0);
  });
});

describe("the move-out preview names the same payee as the real move-out", () => {
  it("Ravi paid Milk; Meera (not the first one left, Asha) confirms: the preview and the move-out both say Ravi pays Meera 20800", async () => {
    const f = await flat("heir", { rate: 4800, split: equal, missed: JSON.stringify({ "2026-11": [5] }) });
    await db.bill.update({ where: { id: f.billId }, data: { payer: f.ravi } }); // the leaver paid it, so it goes to whoever confirms
    const now = new Date("2026-11-14T06:00:00Z");
    const p = await moveOutPreview(f.groupId, f.ravi, "2026-11-14", now, f.meera);
    if (!p.ok) throw new Error(p.error);
    expect(p.paymentsWithDaily).toEqual([{ from: f.ravi, to: f.meera, amount: 20800 }]);
    // Without saying who confirms, the first remaining person (Asha) is assumed, as before.
    const guess = await moveOutPreview(f.groupId, f.ravi, "2026-11-14", now);
    if (!guess.ok) throw new Error(guess.error);
    expect(guess.paymentsWithDaily).toEqual([{ from: f.ravi, to: f.asha, amount: 20800 }]);

    const r = await moveOut(f.groupId, f.meera, { leaverId: f.ravi, lastDay: "2026-11-14", addDaily: true, requestKey: key("heir") }, now);
    expect(r).toEqual({ ok: true, payments: p.paymentsWithDaily });
    const pre = await db.expense.findFirstOrThrow({ where: { groupId: f.groupId, description: { contains: "share" } } });
    expect(pre.paidById).toBe(f.meera);
  });
});
