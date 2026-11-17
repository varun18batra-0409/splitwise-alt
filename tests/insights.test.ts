import { describe, expect, it } from "vitest";
import { computeInsights, type InsightGroup } from "@/lib/insights";
import { monthNumbers } from "@/lib/home/banner";

// Insights must add up exactly like everything else: your share of each
// expense (as in each group's balances and Home's "your month"), or each
// expense's whole amount once (group spend). Money back takes away.

const day = (d: string) => new Date(`${d}T12:00:00.000Z`); // a chosen expense day
const exp = (id: string, amount: number, shares: Record<string, number>, d: string, category = "food", kind = "expense") => ({
  id,
  amount,
  kind,
  category,
  spentAt: day(d),
  createdAt: day(d),
  shares: Object.entries(shares).map(([memberId, a]) => ({ memberId, amount: a })),
});

// Trip in INR: me = "m1". Flat in INR: me = "f1". A USD group: me = "u1".
const trip: InsightGroup = {
  currency: "INR",
  myId: "m1",
  expenses: [
    exp("t1", 90000, { m1: 30000, m2: 30000, m3: 30000 }, "2026-10-03", "food"), // ₹900 dinner, my share ₹300
    exp("t2", 48000, { m1: 12000, m2: 36000 }, "2026-10-14", "transport"), // my share ₹120
    exp("t3", 20000, { m1: 10000, m2: 10000 }, "2026-09-28", "food"), // September
    exp("t4", 6000, { m1: 3000, m2: 3000 }, "2026-10-15", "food", "refund"), // money back: my share −₹30
  ],
};
const flat: InsightGroup = {
  currency: "INR",
  myId: "f1",
  expenses: [
    exp("f1x", 4200000, { f1: 1400000, f2: 1400000, f3: 1400000 }, "2026-10-01", "bills"), // rent: my share ₹14,000
    exp("f2x", 99900, { f2: 49950, f3: 49950 }, "2026-10-05", "bills"), // Wi-Fi, not mine
  ],
};
const usd: InsightGroup = {
  currency: "USD",
  myId: "u1",
  expenses: [exp("u1x", 5000, { u1: 2500, u2: 2500 }, "2026-10-10", "activities")], // $50, my share $25
};
const toINR = (amount: number, cur: string) => (cur === "USD" ? amount * 84 : null); // $1 = ₹84 (cents → paise)

const base = { now: day("2026-10-21"), tz: "Asia/Kolkata", currency: "INR", toChart: toINR } as const;

describe("Insights: the numbers", () => {
  it("your share this month = your shares of every expense, money back taken off, across groups and currencies", () => {
    const r = computeInsights([trip, flat, usd], { ...base, view: "share", grain: "m" });
    // ₹300 + ₹120 − ₹30 (trip) + ₹14,000 (flat) + $25 × 84 = ₹2,100 (USD group)
    expect(r.selected).toBe("2026-10");
    expect(r.bars.at(-1)).toEqual({ key: "2026-10", value: 30000 + 12000 - 3000 + 1400000 + 2500 * 84 });
    expect(r.bars.find((b) => b.key === "2026-09")!.value).toBe(10000);
    expect(r.converted).toBe(true);
    expect(r.skipped).toBe(0);
    // Where it went (October, your share): bills ₹14,000, activities ₹2,100, food ₹300 − ₹30, transport ₹120
    expect(r.categories).toEqual([
      { id: "bills", amount: 1400000 },
      { id: "activities", amount: 210000 },
      { id: "food", amount: 27000 },
      { id: "transport", amount: 12000 },
    ]);
  });

  it("group spend = each expense's whole amount, once (money back takes away)", () => {
    const r = computeInsights([trip, flat], { ...base, view: "spent", grain: "m" });
    expect(r.bars.at(-1)!.value).toBe(90000 + 48000 - 6000 + 4200000 + 99900);
  });

  it("matches Home's 'your month' card exactly", () => {
    const groups = [trip, flat, usd];
    const r = computeInsights(groups, { ...base, view: "share", grain: "m" });
    const home = monthNumbers(groups, (a, cur) => toINR(a, cur), "INR", day("2026-10-21"), "Asia/Kolkata");
    expect(home!.share).toBe(r.bars.at(-1)!.value);
  });

  it("weeks start on Monday; years add up every month", () => {
    const w = computeInsights([trip], { ...base, view: "share", grain: "w" });
    // 14 Oct (Wed) and 15 Oct (Thu) are in the week of Mon 12 Oct: ₹120 − ₹30
    expect(w.bars.find((b) => b.key === "2026-10-12")!.value).toBe(12000 - 3000);
    expect(w.bars.find((b) => b.key === "2026-09-28")!.value).toBe(30000 + 10000); // 28 Sep (Mon) and 3 Oct (Sat)
    const y = computeInsights([trip, flat], { ...base, view: "share", grain: "y" });
    expect(y.bars.at(-1)).toEqual({ key: "2026", value: 30000 + 12000 + 10000 - 3000 + 1400000 });
  });

  it("a tapped month is lit, and its categories shown", () => {
    const r = computeInsights([trip], { ...base, view: "share", grain: "m", selected: "2026-09" });
    expect(r.selected).toBe("2026-09");
    expect(r.categories).toEqual([{ id: "food", amount: 10000 }]);
  });

  it("words typed in Search narrow the chart too", () => {
    const r = computeInsights([trip], { ...base, view: "spent", grain: "m", include: (id) => id === "t1" });
    expect(r.bars.at(-1)!.value).toBe(90000);
  });

  it("a currency with no saved rate is left out (and counted), never guessed", () => {
    const r = computeInsights([usd], { ...base, view: "share", grain: "m", toChart: () => null });
    expect(r.bars.every((b) => b.value === 0)).toBe(true);
    expect(r.skipped).toBe(1);
  });

  it("the founder's trip: my cut ₹19,000, I paid ₹11,000, so I owe ₹8,000 (as on Home)", () => {
    // Nupur paid a ₹25,000 return flight (my share ₹12,500) and ₹6,500 'Adjustment NB' (all mine);
    // I paid ₹11,000 'Adjustment Ph' for others (my share 0); Nupur's ₹81,000 and ₹40,500 flights aren't mine.
    const pay = (id: string, amount: number, paidBy: string, shares: Record<string, number>, cat: string) => ({ ...exp(id, amount, shares, "2026-10-18", cat), paidById: paidBy });
    const g: InsightGroup = {
      currency: "INR",
      myId: "v",
      expenses: [
        pay("a", 2500000, "n", { v: 1250000, n: 1250000 }, "transport"),
        pay("b", 650000, "n", { v: 650000 }, "other"),
        pay("c", 1100000, "v", { n: 1100000 }, "other"),
        pay("d", 8100000, "n", { n: 4050000, x: 4050000 }, "transport"),
        pay("e", 4050000, "n", { n: 4050000 }, "transport"),
      ],
    };
    const r = computeInsights([g], { ...base, view: "share", grain: "m" });
    expect(r.bars.at(-1)!.value).toBe(1900000);
    expect(r.me).toEqual({ share: 1900000, paid: 1100000, net: -800000 });
  });
});

// Batch B4 (Recap): every category is listed, the rows add up to the header, and the third number is not called "owed".
import { recapDiffLabel } from "@/lib/insights";
import { percentsTo100, roundPartsToTotal } from "@/lib/money-display";

describe("Recap: where it went adds up (B4)", () => {
  it("seven categories: all returned, rounded rows equal the rounded header, percentages add to 100", () => {
    // ₹20,132.00 + 12,298.00 + 7,952.00 + 5,957.00 + 2,725.00 + 2,004.48 + 579.00 = ₹51,647.48 (header shows ₹51,647).
    const amounts: [string, number][] = [["accommodation", 2013200], ["food", 1229800], ["transport", 795200], ["activities", 595700], ["shopping", 272500], ["groceries", 200448], ["bills", 57900]];
    const g: InsightGroup = { currency: "INR", myId: "m1", expenses: amounts.map(([cat, a], i) => exp(`c${i}`, a, { m1: a }, "2026-10-05", cat)) };
    const r = computeInsights([g], { ...base, view: "share", grain: "m" });
    expect(r.categories.map((c) => c.amount)).toEqual(amounts.map(([, a]) => a)); // all 7 (the screen used to cut to the top 5: 49,064 and 95%)
    const total = r.categories.reduce((s, c) => s + c.amount, 0);
    expect(total).toBe(5164748);
    const rows = roundPartsToTotal(r.categories.map((c) => c.amount), "INR");
    expect(rows.map((x) => x / 100)).toEqual([20132, 12298, 7952, 5957, 2725, 2004, 579]);
    expect(rows.reduce((s, x) => s + x, 0)).toBe(5164700); // ₹51,647 = the header
    const pcts = percentsTo100(r.categories.map((c) => c.amount));
    expect(pcts).toEqual([39, 24, 15, 12, 5, 4, 1]);
    expect(pcts.reduce((s, x) => s + x, 0)).toBe(100);
  });
  it("the third number is worded as what it is: paid minus your share, never 'owed'", () => {
    expect(recapDiffLabel(7326300)).toBe("More than your share");
    expect(recapDiffLabel(-420000)).toBe("Less than your share");
    expect(recapDiffLabel(0)).toBe("Exactly your share");
    for (const n of [7326300, -420000, 0]) expect(recapDiffLabel(n)).not.toMatch(/owed|owe/i);
  });
});
