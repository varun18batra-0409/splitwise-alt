import { describe, expect, it } from "vitest";
import { dayKey, expenseDate, isTimeZone, parseDay, todayKey } from "@/lib/dates";

describe("expense dates (Indian time)", () => {
  const now = new Date("2026-10-14T20:00:00Z"); // 15 Oct, 01:30 in India

  it("today is the Indian calendar day", () => {
    expect(todayKey(now)).toBe("2026-10-15");
  });

  it("reads a chosen day as noon that day, so it never slips to another day", () => {
    const d = parseDay("2026-10-12", now)!;
    expect(dayKey(d)).toBe("2026-10-12");
  });

  it("rejects impossible, ancient and future dates", () => {
    expect(parseDay("2026-02-31", now)).toBeNull();
    expect(parseDay("1999-12-31", now)).toBeNull();
    expect(parseDay("2026-10-20", now)).toBeNull();
    expect(parseDay("not a date", now)).toBeNull();
  });

  it("uses the chosen day when there is one, otherwise when it was added", () => {
    const created = new Date("2026-10-14T10:00:00Z");
    expect(expenseDate({ createdAt: created, spentAt: null })).toBe(created);
    const spent = parseDay("2026-10-10", now)!;
    expect(expenseDate({ createdAt: created, spentAt: spent })).toBe(spent);
  });
});

describe("India's time zone under its old and new names", () => {
  // Chrome reports Asia/Calcutta; the standard list says Asia/Kolkata. Both are UTC+5:30, so they must give the same day.
  it("accepts both names", () => {
    expect(isTimeZone("Asia/Kolkata")).toBe(true);
    expect(isTimeZone("Asia/Calcutta")).toBe(true);
  });

  it("gives the same day either way (hand-worked: 18:29 UTC is 23:59 in India, 18:30 UTC is 00:00 the next day)", () => {
    const before = new Date("2026-10-14T18:29:00Z");
    const after = new Date("2026-10-14T18:30:00Z");
    for (const tz of ["Asia/Kolkata", "Asia/Calcutta"]) {
      expect(dayKey(before, tz)).toBe("2026-10-14");
      expect(dayKey(after, tz)).toBe("2026-10-15");
      expect(todayKey(after, tz)).toBe("2026-10-15");
    }
  });
});
