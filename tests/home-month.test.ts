import { describe, expect, it } from "vitest";
import { addMonths, daysInMonth, daysLeft, dueDate, dueKey, monthKey, prorate } from "@/lib/home/month";
import { aheadBehind, monthSummary } from "@/lib/home/summary";

const tz = "Asia/Kolkata";

describe("month maths", () => {
  it("knows the month in India time", () => {
    expect(monthKey(new Date("2026-10-31T19:00:00Z"), tz)).toBe("2026-11"); // 01 Nov 00:30 IST
    expect(monthKey(new Date("2026-10-31T17:00:00Z"), tz)).toBe("2026-10");
  });
  it("clamps bill days to short months", () => {
    expect(dueKey("2026-02", 30)).toBe("2026-02-28");
    expect(dueKey("2028-02", 30)).toBe("2028-02-29");
    expect(dueKey("2026-04", "last")).toBe("2026-04-30");
    expect(dueKey("2026-11", 1)).toBe("2026-11-01");
    expect(dueDate("2026-11", 1).toISOString()).toBe("2026-11-01T12:00:00.000Z"); // a chosen-day marker
  });
  it("counts days", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysLeft(new Date("2026-10-16T06:00:00Z"), tz)).toBe(15); // 16 → 31 Oct
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
  it("shares rent by days", () => {
    expect(prorate(1125000, 15, 30)).toBe(562500);
    expect(prorate(100, 1, 3)).toBe(33);
  });
});

describe("this month's numbers", () => {
  const day = (d: string) => new Date(`${d}T12:00:00Z`);
  const e = (amount: number, d: string, extra: object = {}) => ({
    amount, paidById: "you", category: "groceries", spentAt: day(d), createdAt: day(d),
    shares: [{ memberId: "you", amount: amount / 2 }, { memberId: "asha", amount: amount / 2 }], ...extra,
  });
  const expenses = [
    e(400000, "2026-10-03"),
    e(100000, "2026-10-10", { paidById: "asha", category: "food" }),
    e(20000, "2026-10-12", { kind: "refund", paidById: "asha" }),
    e(300000, "2026-09-20"),
  ];
  it("totals, my share, what I paid and last month", () => {
    const s = monthSummary(expenses, "you", "2026-10", tz);
    expect(s.total).toBe(480000);
    expect(s.mine).toBe(240000);
    expect(s.paidByMe).toBe(400000);
    expect(s.net).toBe(160000); // +2,000 (dinner) − 500 (Asha's) + 100 (my half of what Asha got back)
    expect(s.lastTotal).toBe(300000);
    expect(s.byCategory).toEqual([{ id: "groceries", amount: 380000 }, { id: "food", amount: 100000 }]);
  });
  it("couples: ahead, behind or even", () => {
    expect(aheadBehind(230000)).toBe("ahead");
    expect(aheadBehind(-5)).toBe("behind");
    expect(aheadBehind(0)).toBe("even");
  });
});
