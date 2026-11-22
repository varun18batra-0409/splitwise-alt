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

// Founder, 22 Nov: in the postcard editor (and every sideways row), swiping to the end made the row jump back to the start.
describe("sideways rows move only when you move them", () => {
  it("a row brings a newly picked item into view once, and never pulls back to it while you swipe", async () => {
    const { revealIfNewPick } = await import("@/lib/reveal-selected");
    const picked = { getBoundingClientRect: () => ({ left: -400, right: -340 }) };
    const row = { scrollLeft: 0, querySelector: () => picked, getBoundingClientRect: () => ({ left: 0, right: 300 }) };
    const shown = { current: null as Element | null };
    // First time (the row opens): the picked item is 400 px off to the left, so the row moves 412 px back (400 + 12 room).
    revealIfNewPick(row as unknown as HTMLElement, shown);
    expect(row.scrollLeft).toBe(-412);
    // The person swipes far away; the row redraws with the same pick: it must stay where the finger left it.
    row.scrollLeft = 900;
    revealIfNewPick(row as unknown as HTMLElement, shown);
    expect(row.scrollLeft).toBe(900);
  });
  it("no row nudges itself after a swipe any more", () => {
    for (const f of ["src/components/SideRow.tsx", "src/components/ChipRow.tsx", "src/app/postcards/new/editor/ToolRow.tsx"]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toContain("keepPeeking(");
      expect(s, f).not.toMatch(/useEffect\(\(\) => revealSelected\([^)]*\)\);/); // no reveal after every redraw
    }
  });
});
