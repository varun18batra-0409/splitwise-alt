import { describe, expect, it } from "vitest";
import { dayIn, funTitles, hourIn, type WrapExpense } from "@/lib/wrapped";

// Speed fix 1: the hour and the day of an expense now come from date formatters that are made once and
// reused. Same options, so the answer must be the same as the old way (a new formatter every time).
const oldHourIn = (d: Date, tz: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(d)) % 24;
const oldDayIn = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

const ZONES = ["Pacific/Kiritimati", "America/Los_Angeles", "Asia/Kolkata"];

describe("hourIn and dayIn give the old answers", () => {
  // Every half hour across a month that holds a US clock change (8 Mar 2026) and the one in November (1 Nov),
  // plus the minutes either side of local midnight.
  const instants: Date[] = [];
  for (const [from, to] of [["2026-03-01", "2026-03-20"], ["2026-10-25", "2026-11-08"], ["2026-12-30", "2027-01-03"]]) {
    for (let t = Date.parse(`${from}T00:00:00Z`); t < Date.parse(`${to}T00:00:00Z`); t += 30 * 60_000) instants.push(new Date(t));
  }
  for (const tz of ZONES) {
    it(`${tz}: ${instants.length} moments, hour and day identical`, () => {
      for (const d of instants) {
        expect(hourIn(d, tz)).toBe(oldHourIn(d, tz));
        expect(dayIn(d, tz)).toBe(oldDayIn(d, tz));
      }
    });
  }

  it("asking twice (the second time uses the saved formatter) still gives the same answer", () => {
    const d = new Date("2026-11-01T08:59:59Z"); // Los Angeles: the clock goes back that night
    for (const tz of ZONES) {
      expect(hourIn(d, tz)).toBe(oldHourIn(d, tz));
      expect(hourIn(d, tz)).toBe(oldHourIn(d, tz));
      expect(dayIn(d, tz)).toBe(oldDayIn(d, tz));
    }
  });

  it("hand-worked: 17:30 UTC on 10 Nov 2026 is 23:00 in Kolkata, 09:30 in Los Angeles and 07:30 the next day in Kiritimati", () => {
    const d = new Date("2026-11-10T17:30:00Z");
    expect([hourIn(d, "Asia/Kolkata"), dayIn(d, "Asia/Kolkata")]).toEqual([23, "2026-11-10"]);
    expect([hourIn(d, "America/Los_Angeles"), dayIn(d, "America/Los_Angeles")]).toEqual([9, "2026-11-10"]);
    expect([hourIn(d, "Pacific/Kiritimati"), dayIn(d, "Pacific/Kiritimati")]).toEqual([7, "2026-11-11"]);
    // Midnight exactly: 00:00 reads as 0, not 24.
    expect(hourIn(new Date("2026-11-10T18:30:00Z"), "Asia/Kolkata")).toBe(0);
  });
});

describe("funTitles: expenses added near midnight earn the same titles in each zone as before", () => {
  // Two expenses added by "x" at 17:30 UTC, so 23:00 in Kolkata (Night Owl: after 10 pm, at least twice),
  // 07:30 in Kiritimati (Early Bird: 5 to 9 am), and 09:30 in Los Angeles (neither). Two more added by "z"
  // at 12:00 UTC so nobody reaches the 3 added that earns "Keeper of Receipts" first.
  const mk = (i: number): WrapExpense => ({
    description: `Thing ${i}`, amount: 1000, category: "other", paidById: "y", createdById: i < 2 ? "x" : "z",
    createdAt: new Date(`2026-11-${String(10 + i)}T${i < 2 ? "17:30" : "12:00"}:00Z`), spentAt: null,
  });
  const expenses = [0, 1, 2, 3].map(mk);
  const titlesOf = (tz: string) => funTitles(expenses, ["x", "y", "z"], tz, "INR");
  const has = (tz: string, title: string, who: string) => titlesOf(tz).some((t) => t.title === title && t.memberId === who);

  it("Kolkata: x is the Night Owl, not an Early Bird", () => {
    expect(has("Asia/Kolkata", "Night Owl", "x")).toBe(true);
    expect(has("Asia/Kolkata", "Early Bird", "x")).toBe(false);
  });
  it("Kiritimati: x is an Early Bird, not a Night Owl", () => {
    expect(has("Pacific/Kiritimati", "Early Bird", "x")).toBe(true);
    expect(has("Pacific/Kiritimati", "Night Owl", "x")).toBe(false);
  });
  it("Los Angeles: neither", () => {
    expect(has("America/Los_Angeles", "Night Owl", "x")).toBe(false);
    expect(has("America/Los_Angeles", "Early Bird", "x")).toBe(false);
  });
  it("the same call twice gives the same titles", () => {
    for (const tz of ZONES) expect(titlesOf(tz)).toEqual(titlesOf(tz));
  });
});
