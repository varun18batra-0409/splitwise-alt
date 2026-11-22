import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Founder, 22 Nov: the cards at the bottom of Home (postcard, passport, weather…) must not slide by themselves or jump back to the
// first card after the last; you swipe left and right yourself.
describe("Home's row of cards moves only when you swipe", () => {
  const src = readFileSync("src/components/HomeBanner.tsx", "utf8");
  it("no timer, no wrap-around to the first card, no pause button", () => {
    expect(src).not.toMatch(/setInterval|setTimeout/);
    expect(src).not.toMatch(/%\s*n\b/);
    expect(src).not.toContain("Pause the highlights");
  });
  it("still a swipeable row with dots that jump to a card", () => {
    expect(src).toContain("snap-x snap-mandatory overflow-x-auto");
    expect(src).toContain("aria-label={`Show ${i + 1} of ${n}`}");
  });
});
