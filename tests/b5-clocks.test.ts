import { describe, expect, it } from "vitest";
import { paidOnLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { pulseDayFor, pulseText } from "@/lib/pulse";

// B5 part A: days and times as each reader sees them. Pure (no database). Every expected value is worked out by hand.

describe("OP-12: 'You said you paid on ...'", () => {
  // 2026-11-17 19:00 UTC is 19:00 on 17 Nov in London (winter time) and 00:30 on 18 Nov in India (UTC+5:30).
  const paidAt = new Date("2026-11-17T19:00:00Z");
  it("London reads 17 Nov, India reads 18 Nov", () => {
    expect(paidOnLabel(paidAt, "Europe/London")).toBe("17 Nov");
    expect(paidOnLabel(paidAt, "Asia/Kolkata")).toBe("18 Nov");
  });
});

describe("amounts in the trip message", () => {
  it("formatMoney prints whole rupees without .00", () => {
    expect(formatMoney(420000, "INR")).toBe("₹4,200"); // 420000 paise = 4200 rupees
    expect(formatMoney(620000, "INR")).toBe("₹6,200");
  });
});

describe("SB-3: when each person is told about a trip day", () => {
  // Evening 16:00-21:59 their time: their today. Morning 06:00-13:59: their yesterday. Otherwise nobody is sent anything.
  it("evening hours tell today", () => {
    for (const h of [16, 19, 21]) expect(pulseDayFor(h, "2026-11-17")).toEqual({ day: "2026-11-17", when: "today" });
  });
  it("morning hours tell yesterday", () => {
    for (const h of [6, 9, 13]) expect(pulseDayFor(h, "2026-11-17")).toEqual({ day: "2026-11-16", when: "yesterday" });
    expect(pulseDayFor(8, "2026-12-01")).toEqual({ day: "2026-11-30", when: "yesterday" }); // across a month end
  });
  it("night and midday are skipped", () => {
    for (const h of [0, 3, 5, 14, 15, 22, 23]) expect(pulseDayFor(h, "2026-11-17")).toBeNull();
  });

  // The two crons (00:30 and 16:00 UTC) and the three people of the plan. Hours worked by hand:
  //   16:00Z 17 Nov: Leo (London, UTC+0) 16:00 -> today (17 Nov). Bina (Makassar, UTC+8) 00:00 on 18 Nov -> skipped.
  //   00:30Z 18 Nov: Bina 08:30 on 18 Nov -> yesterday (17 Nov). Leo 00:30 -> skipped.
  it("the plan's Bali trip: Leo gets 17 Nov in the evening run, Bina gets it in the morning run", () => {
    expect(pulseDayFor(16, "2026-11-17")).toEqual({ day: "2026-11-17", when: "today" }); // Leo, evening run
    expect(pulseDayFor(0, "2026-11-18")).toBeNull(); // Bina, evening run
    expect(pulseDayFor(8, "2026-11-18")).toEqual({ day: "2026-11-17", when: "yesterday" }); // Bina, morning run
    expect(pulseDayFor(0, "2026-11-18")).toBeNull(); // Leo, morning run
  });
  it("the Bali text: day 3 of 6, 300000 of 420000 paise is 71% so the top payer is named", () => {
    // 15 Nov start, 20 Nov end: 17 Nov is day 3 of 6. 300000 / 420000 = 0.714 which is at least 0.6.
    const o = { place: "Bali", day: 3, of: 6, spent: 420000, currency: "INR", count: 2, topPayer: "Bina", topShare: 300000 / 420000 };
    expect(pulseText(o)).toBe("Day 3 in Bali: ₹4,200 gone, Bina’s carrying the team 😅");
    expect(pulseText({ ...o, when: "yesterday" })).toBe("Day 3 in Bali: ₹4,200 gone, Bina’s carrying the team 😅"); // multi-day: same
  });
  it("a one-day trip: 'today' in the evening, 'yesterday' next morning", () => {
    const o = { place: "Goa", day: 1, of: 1, spent: 420000, currency: "INR", count: 2, topShare: 0.5 };
    expect(pulseText(o)).toBe("Goa today: ₹4,200 gone, 2 expenses, shared fair and square 🤝");
    expect(pulseText({ ...o, when: "yesterday" })).toBe("Goa yesterday: ₹4,200 gone, 2 expenses, shared fair and square 🤝");
  });
});
