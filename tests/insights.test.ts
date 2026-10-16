import { describe, expect, it } from "vitest";
import { categoryJumps, forecast, monthlySummaryText, sameDayDuplicates, utilityJumps } from "@/lib/home/insights";

// "Heads up" on This month, next month's estimate, and the 1st-of-month summary.

describe("heads up", () => {
  it("a bill that changes is flagged when it's over 25% above its usual", () => {
    const runs = [
      { name: "Electricity", period: "2026-07", amount: 240000 },
      { name: "Electricity", period: "2026-08", amount: 250000 },
      { name: "Electricity", period: "2026-09", amount: 236000 },
      { name: "Electricity", period: "2026-10", amount: 341000 },
      { name: "Gas", period: "2026-09", amount: 100000 },
      { name: "Gas", period: "2026-10", amount: 110000 },
    ];
    expect(utilityJumps(runs, "2026-10")).toEqual([{ name: "Electricity", amount: 341000, usual: 242000, pct: 41 }]);
  });
  it("a category up 30%+ and over ₹1,000 vs last month", () => {
    expect(
      categoryJumps(
        [{ id: "food", amount: 560000 }, { id: "groceries", amount: 90000 }, { id: "bills", amount: 400000 }],
        [{ id: "food", amount: 400000 }, { id: "groceries", amount: 50000 }, { id: "bills", amount: 380000 }],
      ),
    ).toEqual([{ id: "food", amount: 560000, prev: 400000, pct: 40 }]);
  });
  it("the same thing added twice on the same day", () => {
    const day = new Date("2026-10-12T12:00:00Z");
    expect(
      sameDayDuplicates(
        [
          { id: "1", description: "Milk", amount: 6000, spentAt: day, createdAt: day },
          { id: "2", description: "milk ", amount: 6000, spentAt: day, createdAt: day },
          { id: "3", description: "Milk", amount: 6000, spentAt: new Date("2026-10-13T12:00:00Z"), createdAt: day },
        ],
        "Asia/Kolkata",
      ),
    ).toEqual([{ name: "Milk", amount: 6000, day: "2026-10-12", ids: ["1", "2"] }]);
  });
});

describe("next month's estimate", () => {
  it("fixed bills + the usual for bills that change + daily bills + usual groceries", () => {
    expect(
      forecast({
        fixed: [3600000, 99900, 600000],
        varies: [[242000, 250000, 236000]],
        daily: [{ rate: 6000, days: 30 }],
        groceries: [800000, 900000, 1000000],
      }),
    ).toBe(3600000 + 99900 + 600000 + 242667 + 180000 + 900000);
  });
});

describe("the monthly summary", () => {
  it("says the total, your share, the biggest category and anything unusual", () => {
    const money = (n: number) => `₹${(n / 100).toLocaleString("en-IN")}`;
    expect(monthlySummaryText({ month: "2026-10", group: "Flat 402", total: 5052000, mine: 1684000, top: "Bills & Utilities", unusual: "Electricity was 41% more than usual" }, money)).toEqual({
      title: "🏠 Flat 402 · October",
      body: "₹50,520 spent, your share ₹16,840. Most went on Bills & Utilities. Electricity was 41% more than usual.",
    });
  });
});
