import { describe, expect, it } from "vitest";
import { dailyMonthShares, dailyPrecharge } from "@/lib/home/moving";

// The month-end share of a daily bill, day by day (pure). Milk is 60 rupees a day = 6,000 paise, shared equally; A, B and C are there all month.
// Every expected number below is worked out by hand: each day is shared by whoever was there, so a person's part is
// Σ over the counted days of 1 ÷ (people there that day); the month's amount is then split in that proportion.

const day = (d: string) => new Date(`${d}T12:00:00Z`);
const person = (id: string, o: { joined?: string; left?: string } = {}) => ({ id, splitWeight: 100, joinedFrom: o.joined ? day(o.joined) : null, leftAt: o.left ? day(o.left) : null });
const milk = { amount: 6000, missed: "{}", split: JSON.stringify({ mode: "equal" }), tz: "Asia/Kolkata" };
const asMap = (r: { memberId: string; amount: number }[] | null) => Object.fromEntries((r ?? []).map((s) => [s.memberId, s.amount]));

describe("dailyMonthShares: hand-worked", () => {
  it("1. A B C all November, D in on 15 Nov, stopped 20 Nov: 19 days = 114,000. Days 1–14 are three-way, days 15–19 four-way; in twelfths A = 14×4 + 5×3 = 71, D = 5×3 = 15 (of 228) → A 35,500, B 35,500, C 35,500, D 7,500", () => {
    const bill = { ...milk, paused: true, pausedAt: new Date("2026-11-20T06:00:00Z") };
    const r = dailyMonthShares({ bill, period: "2026-11", members: [person("A"), person("B"), person("C"), person("D", { joined: "2026-11-15" })], live: [], gone: [], amount: 114000 });
    expect(asMap(r)).toEqual({ A: 35500, B: 35500, C: 35500, D: 7500 });
    expect(r!.reduce((n, s) => n + s.amount, 0)).toBe(114000);
  });

  it("2. the same without a stop, but 20–29 Nov marked didn't-come: 20 days = 120,000; A = 14×4 + 6×3 = 74, D = 6×3 = 18 (of 240) → A 37,000, B 37,000, C 37,000, D 9,000", () => {
    const bill = { ...milk, missed: JSON.stringify({ "2026-11": [20, 21, 22, 23, 24, 25, 26, 27, 28, 29] }) };
    const r = dailyMonthShares({ bill, period: "2026-11", members: [person("A"), person("B"), person("C"), person("D", { joined: "2026-11-15" })], live: [], gone: [], amount: 120000 });
    expect(asMap(r)).toEqual({ A: 37000, B: 37000, C: 37000, D: 9000 });
  });

  it("3. rounding: 1,000 a day, all of November (30,000), D from the 15th. Days 1–14 are shared by 3, days 15–30 by 4, so the daily totals are 300 and 400 and L = 1,200; units A 14×400 + 16×300 = 10,400 (B, C the same), D 16×300 = 4,800 (of 36,000) → A 8,666.67, B 8,666.67, C 8,666.67, D 4,000 → the extra 2 paise go to A and B, the first listed: A 8,667, B 8,667, C 8,666, D 4,000", () => {
    const r = dailyMonthShares({ bill: { ...milk, amount: 1000 }, period: "2026-11", members: [person("A"), person("B"), person("C"), person("D", { joined: "2026-11-15" })], live: [], gone: [], amount: 30000 });
    expect(asMap(r)).toEqual({ A: 8667, B: 8667, C: 8666, D: 4000 });
  });

  it("4. February 2027 has 28 days: 6,000 a day = 168,000, D from 15 Feb. Days 1–14 three-way, 15–28 four-way; in twelfths A = 14×4 + 14×3 = 98, D = 14×3 = 42 (of 336) → A 49,000, B 49,000, C 49,000, D 21,000", () => {
    const r = dailyMonthShares({ bill: milk, period: "2027-02", members: [person("A"), person("B"), person("C"), person("D", { joined: "2027-02-15" })], live: [], gone: [], amount: 168000 });
    expect(asMap(r)).toEqual({ A: 49000, B: 49000, C: 49000, D: 21000 });
  });

  it("5. C's last day is 20 Nov with a charge of 37,000 (14 × 2,000 + 6 × 1,500), D in on 15 Nov, all of November = 180,000: the month end is 143,000, shared by A, B and D, with C counted in the days he was there. In twelfths (of 360): A = 14×4 + 6×3 + 10×4 = 114, D = 6×3 + 10×4 = 58 → A 57,000, B 57,000, D 29,000 (C takes none)", () => {
    const members = [person("A"), person("B"), person("C", { left: "2026-11-20" }), person("D", { joined: "2026-11-15" })];
    const r = dailyMonthShares({ bill: milk, period: "2026-11", members, live: [{ m: "C", a: 37000, e: "x", d: "2026-11-20" }], gone: [], amount: 143000 });
    expect(asMap(r)).toEqual({ A: 57000, B: 57000, D: 29000 });
    expect(37000 + 143000).toBe(180000); // the charge and the month end are the whole month, once
  });

  it("a leaver brought back by Not received who still has a live charge takes no part: C's last day 10 Nov, charge 20,000, stopped 20 Nov (19 days = 114,000, month end 94,000): A 47,000, B 47,000", () => {
    const bill = { ...milk, paused: true, pausedAt: new Date("2026-11-20T06:00:00Z") };
    const r = dailyMonthShares({ bill, period: "2026-11", members: [person("A"), person("B"), person("C")], live: [{ m: "C", a: 20000, e: "x", d: "2026-11-10" }], gone: [], amount: 94000 });
    expect(asMap(r)).toEqual({ A: 47000, B: 47000 });
  });

  it("a brought-back leaver whose charge expense was deleted shares only the days up to his last day: C there 1–10 Nov, 19 days = 114,000. Days 1–10 three-way, 11–19 two-way; in sixths A = 10×2 + 9×3 = 47, C = 10×2 = 20 (of 114) → A 47,000, B 47,000, C 20,000", () => {
    const bill = { ...milk, paused: true, pausedAt: new Date("2026-11-20T06:00:00Z") };
    const r = dailyMonthShares({ bill, period: "2026-11", members: [person("A"), person("B"), person("C")], live: [], gone: [{ m: "C", a: 20000, e: "x", d: "2026-11-10" }], amount: 114000 });
    expect(asMap(r)).toEqual({ A: 47000, B: 47000, C: 20000 });
  });

  it("someone who left with no charge is left out, and the others share every day: A, B, D (in 15 Nov), C gone — days 1–14 two-way, 15–30 three-way; in sixths A = 14×3 + 16×2 = 74, D = 16×2 = 32 (of 180) → 180,000 gives A 74,000, B 74,000, D 32,000", () => {
    const r = dailyMonthShares({ bill: milk, period: "2026-11", members: [person("A"), person("B"), person("C", { left: "2026-11-10" }), person("D", { joined: "2026-11-15" })], live: [], gone: [], amount: 180000 });
    expect(asMap(r)).toEqual({ A: 74000, B: 74000, D: 32000 });
  });

  it("the flat's own split is by weight: A 100, B 200, D 100 from the 15th; days 1–14 total 300, days 15–30 total 400, L = 1,200; A = 14×400 + 16×300 = 10,400, B = 20,800, D = 4,800 (of 36,000) → 36,000 gives A 10,400, B 20,800, D 4,800", () => {
    const members = [{ ...person("A") }, { ...person("B"), splitWeight: 200 }, person("D", { joined: "2026-11-15" })];
    const r = dailyMonthShares({ bill: { ...milk, split: JSON.stringify({ mode: "group" }) }, period: "2026-11", members, live: [], gone: [], amount: 36000 });
    expect(asMap(r)).toEqual({ A: 10400, B: 20800, D: 4800 });
  });

  it("only some people: C is not on the bill, so D (in 15 Nov) and A, B share it; days 1–14 two-way, 15–30 three-way: A 74,000, B 74,000, D 32,000 of 180,000", () => {
    const bill = { ...milk, split: JSON.stringify({ mode: "some", ids: ["A", "B", "D"] }) };
    const r = dailyMonthShares({ bill, period: "2026-11", members: [person("A"), person("B"), person("C"), person("D", { joined: "2026-11-15" })], live: [], gone: [], amount: 180000 });
    expect(asMap(r)).toEqual({ A: 74000, B: 74000, D: 32000 });
  });

  it("the usual way (null) when nobody moved in and nobody has a charge; for a percentage or fixed-amount split; and for an amount of nothing", () => {
    const three = [person("A"), person("B"), person("C")];
    expect(dailyMonthShares({ bill: milk, period: "2026-11", members: three, live: [], gone: [], amount: 180000 })).toBeNull();
    const moved = [...three, person("D", { joined: "2026-11-15" })];
    expect(dailyMonthShares({ bill: { ...milk, split: JSON.stringify({ mode: "percent", pct: { A: 5000, B: 5000 } }) }, period: "2026-11", members: moved, live: [], gone: [], amount: 180000 })).toBeNull();
    expect(dailyMonthShares({ bill: { ...milk, split: JSON.stringify({ mode: "amounts", amt: { A: 100 } }) }, period: "2026-11", members: moved, live: [], gone: [], amount: 180000 })).toBeNull();
    expect(dailyMonthShares({ bill: milk, period: "2026-11", members: moved, live: [], gone: [], amount: 0 })).toBeNull();
    // someone who moved in a month earlier changes nothing
    expect(dailyMonthShares({ bill: milk, period: "2026-11", members: [...three, person("D", { joined: "2026-10-15" })], live: [], gone: [], amount: 180000 })).toBeNull();
  });

  it("every share is a whole number of paise and they add up to the amount, whatever the odd amount", () => {
    const members = [person("A"), person("B"), person("C"), person("D", { joined: "2026-11-15" })];
    for (const amount of [1, 7, 99999, 114001, 180007]) {
      const r = dailyMonthShares({ bill: milk, period: "2026-11", members, live: [], gone: [], amount })!;
      expect(r.reduce((n, s) => n + s.amount, 0)).toBe(amount);
      expect(r.every((s) => Number.isInteger(s.amount) && s.amount > 0)).toBe(true);
    }
  });
});

describe("dailyMonthShares and dailyPrecharge: review fixes (hand-worked)", () => {
  const live = [{ m: "C", a: 20000, e: "x", d: "2026-11-10" }];

  it("a second leaver's charge counts a brought-back C only to his last day: B leaves 25 Nov, C there 1–10 Nov: 10 × 6,000 ÷ 3 + 15 × 6,000 ÷ 2 = 20,000 + 45,000 = 65,000 (not 50,000); with C's charge deleted it is the same; with no earlier charge nothing changes (25 × 2,000 = 50,000)", () => {
    const members = [person("A"), person("B"), person("C")];
    expect(dailyPrecharge(milk, "2026-11", "2026-11-25", members, "B", { live, gone: [] }).amount).toBe(65000);
    expect(dailyPrecharge(milk, "2026-11", "2026-11-25", members, "B", { live: [], gone: live }).amount).toBe(65000);
    expect(dailyPrecharge(milk, "2026-11", "2026-11-25", members, "B").amount).toBe(50000);
    expect(dailyPrecharge(milk, "2026-11", "2026-11-25", members, "B", { live: [], gone: [] }).amount).toBe(50000);
    // His own earlier (deleted) charge does not shorten his own days: moving out again on 25 Nov he is charged for all 25.
    expect(dailyPrecharge(milk, "2026-11", "2026-11-25", members, "C", { live: [], gone: live }).amount).toBe(50000);
  });

  it("both charged: A alone takes the month end, 180,000 − 20,000 − 65,000 = 95,000", () => {
    const members = [person("A"), person("B", { left: "2026-11-25" }), person("C")];
    const r = dailyMonthShares({ bill: milk, period: "2026-11", members, live: [...live, { m: "B", a: 65000, e: "y", d: "2026-11-25" }], gone: [], amount: 95000 });
    expect(asMap(r)).toEqual({ A: 95000 });
  });

  it("a percentage split A 34%, B 33%, C 33%, C charged 19,800 up to the 10th, stopped 20 Nov (19 days), 94,200 to share: units (of 10,519,000) A 5,338,000, B 5,181,000 → A 47,802.985 → 47,803, B 46,397.015 → 46,397; without a charge the usual way (null)", () => {
    const bill = { ...milk, split: JSON.stringify({ mode: "percent", pct: { A: 3400, B: 3300, C: 3300 } }), paused: true, pausedAt: new Date("2026-11-20T06:00:00Z") };
    const members = [person("A"), person("B"), person("C")];
    expect(asMap(dailyMonthShares({ bill, period: "2026-11", members, live: [{ m: "C", a: 19800, e: "x", d: "2026-11-10" }], gone: [], amount: 94200 }))).toEqual({ A: 47803, B: 46397 });
    expect(dailyMonthShares({ bill, period: "2026-11", members, live: [], gone: [], amount: 94200 })).toBeNull();
  });

  it("numbers too big to keep exact (14 people with big, different weights joining on different days) never give up while C has a live charge: still shared to the exact total, C takes none", () => {
    const people = Array.from({ length: 14 }, (_, i) => ({ ...person(`P${i}`, i === 0 ? {} : { joined: `2026-11-${String(i + 1).padStart(2, "0")}` }), splitWeight: 1000003 + i * 7919 }));
    const members = [...people, { ...person("C", { left: "2026-11-30" }), splitWeight: 1000033 }];
    const r = dailyMonthShares({ bill: { ...milk, split: JSON.stringify({ mode: "group" }) }, period: "2026-11", members, live: [{ m: "C", a: 1000, e: "z", d: "2026-11-30" }], gone: [], amount: 1234567 });
    expect(r).not.toBeNull();
    expect(r!.reduce((n, s) => n + s.amount, 0)).toBe(1234567);
    expect(r!.some((s) => s.memberId === "C")).toBe(false);
  });
});
