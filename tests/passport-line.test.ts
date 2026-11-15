import { describe, expect, it } from "vitest";
import { passportLine, PASSPORT_LINE_EMPTY } from "@/lib/passport-line";

describe("passport line", () => {
  it("shows the plain line before any country", () => {
    expect(passportLine(0)).toBe(PASSPORT_LINE_EMPTY);
    expect(passportLine(-3)).toBe(PASSPORT_LINE_EMPTY);
    expect(passportLine(Number.NaN)).toBe(PASSPORT_LINE_EMPTY);
  });

  it("changes every 5 countries and stays the same inside a band", () => {
    expect(passportLine(1)).toBe("The first stamps. Plenty of pages to fill.");
    expect(passportLine(4)).toBe(passportLine(1));
    expect(passportLine(5)).toBe("The pages are starting to fill up.");
    expect(passportLine(9)).toBe(passportLine(5));
    expect(passportLine(10)).toBe("Well travelled, and it shows.");
    expect(passportLine(22)).toBe("A seasoned traveller, still curious.");
    expect(passportLine(49)).toBe("More stamps than most will ever see.");
    expect(passportLine(50)).toBe("A passport worth framing.");
    expect(passportLine(190)).toBe("A passport worth framing.");
  });

  it("never repeats the number and fits on two short lines", () => {
    const all = new Set<string>();
    for (let n = 0; n <= 60; n++) all.add(passportLine(n));
    expect(all.size).toBe(12);
    for (const line of all) {
      expect(line).not.toMatch(/\d/);
      expect(line.length).toBeLessThanOrEqual(48);
    }
  });
});
