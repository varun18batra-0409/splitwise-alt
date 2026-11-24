import { describe, expect, it } from "vitest";
import { dayKey, startOfDayIn } from "@/lib/dates";

// Batch 9 (L32): a sealed postcard opens at the true start of the chosen day in the sender's zone.
// The old code took the zone's offset at NOON that day and used it for midnight; on a day the clocks change those differ by an hour.
describe("startOfDayIn: the first moment of a calendar day in a zone", () => {
  it("2027-03-14 New York (clocks go forward at 02:00 that day): midnight is still UTC-5, so 05:00Z (the old code gave 04:00Z)", () => {
    expect(startOfDayIn("2027-03-14", "America/New_York")?.toISOString()).toBe("2027-03-14T05:00:00.000Z");
  });

  it("2027-11-07 New York (clocks go back at 02:00 that day): midnight is still UTC-4, so 04:00Z (the old code gave 05:00Z)", () => {
    expect(startOfDayIn("2027-11-07", "America/New_York")?.toISOString()).toBe("2027-11-07T04:00:00.000Z");
  });

  it("2026-12-25 Kolkata (UTC+5:30, no clock changes): 2026-12-24 18:30Z", () => {
    expect(startOfDayIn("2026-12-25", "Asia/Kolkata")?.toISOString()).toBe("2026-12-24T18:30:00.000Z");
  });

  it("an ordinary day in UTC and a zone ahead of the date line", () => {
    expect(startOfDayIn("2026-06-01", "UTC")?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(startOfDayIn("2026-12-25", "Pacific/Kiritimati")?.toISOString()).toBe("2026-12-24T10:00:00.000Z"); // UTC+14
  });

  // America/Santiago: on Sunday 5 Sep 2027 the clocks go from 23:59 on the 4th straight to 01:00 on the 5th (UTC-4 -> UTC-3), so there is
  // no 00:00 that day. The first moment of the 5th is 01:00 local = 04:00Z. (Looked up in the installed time-zone data; Chile starts summer
  // time at "24:00" on the first Saturday night of September. Asia/Beirut skips midnight in March the same way.)
  it("a zone that skips midnight (America/Santiago, 2027-09-05): the first instant of that day, 04:00Z, and it is on that day", () => {
    const at = startOfDayIn("2027-09-05", "America/Santiago")!;
    expect(at.toISOString()).toBe("2027-09-05T04:00:00.000Z");
    expect(dayKey(at, "America/Santiago")).toBe("2027-09-05");
    expect(dayKey(new Date(at.getTime() - 1000), "America/Santiago")).toBe("2027-09-04"); // the second before is still the 4th
  });

  it("whatever the zone, the answer is exactly the first moment of the day, all year (a few zones, every day of 2027)", () => {
    for (const tz of ["America/New_York", "Europe/London", "Australia/Lord_Howe", "America/Santiago", "Asia/Kolkata", "Pacific/Chatham"]) {
      for (let d = 0; d < 365; d++) {
        const day = new Date(Date.UTC(2027, 0, 1 + d)).toISOString().slice(0, 10);
        const at = startOfDayIn(day, tz)!;
        expect(dayKey(at, tz), `${tz} ${day}`).toBe(day);
        expect(dayKey(new Date(at.getTime() - 1000), tz) < day, `${tz} ${day} before`).toBe(true);
      }
    }
  });

  it("not a real date: nothing", () => {
    expect(startOfDayIn("2027-02-31", "UTC")).toBeNull();
    expect(startOfDayIn("tomorrow", "UTC")).toBeNull();
  });
});
