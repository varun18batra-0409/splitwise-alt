import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { depositRefunds, leaverPayments, proRataShares, joinWeights } from "@/lib/home/moving";
import { moveOutPreview, moveOut, saveDepositFor } from "@/lib/home/moving-db";
import { loadGroup } from "@/lib/group-data";

// Moving in and out of a flat, and the deposit.

describe("rent for the days someone stayed", () => {
  it("Rohan leaves on the 15th of a 30-day month: half his rent goes to the others", () => {
    const shares = [
      { memberId: "you", amount: 1200000 },
      { memberId: "asha", amount: 1200000 },
      { memberId: "rohan", amount: 1200000 },
    ];
    const r = proRataShares(shares, "rohan", 15, 30, { you: 100, asha: 100, rohan: 100 });
    expect(r).toEqual([
      { memberId: "you", amount: 1500000 },
      { memberId: "asha", amount: 1500000 },
      { memberId: "rohan", amount: 600000 },
    ]);
    expect(r.reduce((s, x) => s + x.amount, 0)).toBe(3600000);
  });
  it("a bigger room takes more of what's freed up", () => {
    const r = proRataShares([{ memberId: "a", amount: 1000 }, { memberId: "b", amount: 1000 }, { memberId: "c", amount: 1001 }], "c", 0, 30, { a: 200, b: 100, c: 100 });
    // ₹10.01 freed: 2 : 1 → 6.67 and 3.34 (the leftover paisa goes to the bigger remainder)
    expect(r).toEqual([{ memberId: "a", amount: 1667 }, { memberId: "b", amount: 1334 }, { memberId: "c", amount: 0 }]);
  });
});

describe("someone moving in mid-month", () => {
  it("their weight counts only for the days they're there", () => {
    expect(joinWeights([{ id: "a", splitWeight: 100, joinedFrom: null }, { id: "m", splitWeight: 100, joinedFrom: new Date("2026-10-16T12:00:00Z") }], "2026-10")).toEqual({ a: 3100, m: 1600 });
    expect(joinWeights([{ id: "m", splitWeight: 100, joinedFrom: new Date("2026-09-20T12:00:00Z") }], "2026-10")).toEqual({ m: 3100 });
  });
});

describe("the leaver's final payments", () => {
  it("someone who owes pays those who are owed, in proportion", () => {
    expect(leaverPayments({ you: 300000, asha: 100000, rohan: -400000 }, "rohan")).toEqual([
      { from: "rohan", to: "you", amount: 300000 },
      { from: "rohan", to: "asha", amount: 100000 },
    ]);
  });
  it("someone who's owed is paid by those who owe", () => {
    expect(leaverPayments({ you: -100000, asha: -50000, rohan: 150000 }, "rohan")).toEqual([
      { from: "you", to: "rohan", amount: 100000 },
      { from: "asha", to: "rohan", amount: 50000 },
    ]);
  });
  it("nothing when they're square", () => {
    expect(leaverPayments({ you: 100, asha: -100, rohan: 0 }, "rohan")).toEqual([]);
  });
});

describe("deposit back at the end", () => {
  it("deductions shared the group's way, never below zero", () => {
    expect(depositRefunds([{ memberId: "a", amount: 3600000 }, { memberId: "b", amount: 3600000 }, { memberId: "c", amount: 3600000 }], 800000, { a: 100, b: 100, c: 100 })).toEqual([
      { memberId: "a", refund: 3333333 },
      { memberId: "b", refund: 3333333 },
      { memberId: "c", refund: 3333334 },
    ]);
    expect(depositRefunds([{ memberId: "a", amount: 1000 }], 5000, { a: 100 })).toEqual([{ memberId: "a", refund: 0 }]);
  });
});

describe("moving out, for real", () => {
  let groupId = "", you = "", asha = "", rohan = "", meera = "";
  beforeAll(async () => {
    const g = await db.group.create({
      data: {
        name: "Flat 402", type: "home", currency: "INR", inviteCode: `move-${Date.now()}`,
        members: { create: [{ name: "You" }, { name: "Asha" }, { name: "Rohan" }, { name: "Meera" }] },
      },
      include: { members: true },
    });
    groupId = g.id;
    const id = (n: string) => g.members.find((m) => m.name === n)!.id;
    [you, asha, rohan, meera] = [id("You"), id("Asha"), id("Rohan"), id("Meera")];
    // Meera joins on the 16th, so she isn't part of October's rent.
    await db.member.update({ where: { id: meera }, data: { joinedFrom: new Date("2026-10-16T12:00:00Z") } });
    // October rent ₹36,000 paid by you on the 1st, shared by the three of you.
    const rent = await db.expense.create({
      data: {
        groupId, description: "Rent", category: "bills", amount: 3600000, paidById: you, createdById: you, splitType: "equal", forMode: "selected",
        originalAmount: 3600000, originalCurrency: "INR", baseCurrency: "INR", exchangeRate: "1", rateDate: "2026-10-01", rateSource: "same",
        convertedAmount: 3600000, paymentMethod: "cash", markupBp: 0, markupAmount: 0, spentAt: new Date("2026-10-01T12:00:00Z"),
        shares: { create: [{ memberId: you, amount: 1200000 }, { memberId: asha, amount: 1200000 }, { memberId: rohan, amount: 1200000 }] },
      },
    });
    const bill = await db.bill.create({ data: { groupId, name: "Rent", nature: "fixed", amount: 3600000, day: 1, startMonth: "2026-10", payer: you } });
    await db.billRun.create({ data: { billId: bill.id, period: "2026-10", status: "added", expenseId: rent.id } });
    await saveDepositFor(groupId, you, { heldBy: "Landlord", amounts: { [you]: "36000", [asha]: "36000", [rohan]: "36000" } });
  });
  afterAll(async () => {
    await db.group.delete({ where: { id: groupId } }).catch(() => {});
  });

  it("previews what Rohan owes for his days", async () => {
    const p = await moveOutPreview(groupId, rohan, "2026-10-15");
    expect(p.ok && p.rentCredit).toBe(619355); // 16 of October's 31 days of his ₹12,000 go back to the others
    expect(p.ok && p.balanceToday).toBe(-1200000);
    expect(p.ok && p.payments).toEqual([{ from: rohan, to: you, amount: 580645 }]);
  });

  it("re-splits this month's rent, settles him up, hands his deposit to Meera, and marks him left — balances still add up", async () => {
    const r = await moveOut(groupId, you, { leaverId: rohan, lastDay: "2026-10-15", depositTo: meera, requestKey: `move-${Date.now()}-abcdefgh` });
    expect(r.ok).toBe(true);
    const data = (await loadGroup(groupId))!;
    expect(Object.values(data.net).reduce((a, b) => a + b, 0)).toBe(0);
    expect(data.net[rohan]).toBe(0);
    expect(data.group.members.find((m) => m.id === rohan)?.leftAt).not.toBeNull();
    const rent = data.expenses.find((e) => e.description === "Rent")!;
    expect(rent.amount).toBe(3600000);
    expect(rent.shares.find((s) => s.memberId === rohan)?.amount).toBe(580645); // 15 of 31 days
    const dep = await db.depositShare.findMany({ where: { deposit: { groupId } } });
    expect(dep.find((d) => d.memberId === rohan)?.status).toBe("transferred");
    expect(dep.find((d) => d.memberId === meera)?.amount).toBe(3600000);
  });
});
