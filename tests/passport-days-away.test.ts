import { describe, expect, it } from "vitest";
import { daysAway, tripDays } from "@/lib/passport";

// "Days away": distinct days on trips that have started, both ends counted. Worked out by hand.
const t = (start: string, end = "", extra: { undated?: boolean } = {}) => ({ start, end, ...extra });
const TODAY = "2026-11-13";

describe("tripDays: one trip, both ends counted", () => {
  it("5–10 May is 6 days (5, 6, 7, 8, 9, 10)", () => expect(tripDays("2026-05-05", "2026-05-10")).toBe(6));
  it("13–15 Mar is 3 days", () => expect(tripDays("2026-03-13", "2026-03-15")).toBe(3));
  it("no end date is 1 day, and an end before the start is 1 day", () => {
    expect(tripDays("2026-05-05", "")).toBe(1);
    expect(tripDays("2026-05-05", "2026-05-01")).toBe(1);
  });
  it("no start is 0", () => expect(tripDays("", "2026-05-10")).toBe(0));
});

describe("daysAway", () => {
  it("the picture: 5–10 May (6) and 13–15 Mar (3) is 9", () => {
    expect(daysAway([t("2026-05-05", "2026-05-10"), t("2026-03-13", "2026-03-15")], TODAY)).toBe(9);
  });
  it("overlapping trips count each day once: 1–5 Jun and 4–8 Jun is 1..8 = 8, not 10", () => {
    expect(daysAway([t("2026-06-01", "2026-06-05"), t("2026-06-04", "2026-06-08")], TODAY)).toBe(8);
  });
  it("a trip still going counts only up to today: 10–20 Jun, today 12 Jun, is 10, 11, 12 = 3", () => {
    expect(daysAway([t("2026-06-10", "2026-06-20")], "2026-06-12")).toBe(3);
  });
  it("across a year end: 30 Jan–2 Feb 2027 is 30, 31, 1, 2 = 4", () => {
    expect(daysAway([t("2027-01-30", "2027-02-02")], "2027-06-01")).toBe(4);
  });
  it("across a leap day: 28 Feb–1 Mar 2028 is 28, 29, 1 = 3", () => {
    expect(daysAway([t("2028-02-28", "2028-03-01")], "2028-06-01")).toBe(3);
  });
  it("the same dates in a normal year skip the 29th: 28 Feb–1 Mar 2027 is 2", () => {
    expect(daysAway([t("2027-02-28", "2027-03-01")], "2027-06-01")).toBe(2);
  });
  it("no end date is 1 day", () => expect(daysAway([t("2026-05-05")], TODAY)).toBe(1));
  it("a trip without dates of its own is 0", () => {
    expect(daysAway([t("", "")], TODAY)).toBe(0);
    expect(daysAway([t("2026-05-05", "", { undated: true })], TODAY)).toBe(0);
  });
  it("a trip still to come is 0, and one starting today is 1", () => {
    expect(daysAway([t("2026-12-01", "2026-12-05")], TODAY)).toBe(0);
    expect(daysAway([t(TODAY, "2026-11-20")], TODAY)).toBe(1);
  });
  it("no trips is 0 (someone who left before a trip began never gets that trip in the list, so adds nothing)", () => {
    expect(daysAway([], TODAY)).toBe(0);
  });
});
