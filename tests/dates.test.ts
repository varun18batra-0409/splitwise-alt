import { describe, expect, it } from "vitest";
import { dayKey, expenseDate, parseDay, todayKey } from "@/lib/dates";

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
