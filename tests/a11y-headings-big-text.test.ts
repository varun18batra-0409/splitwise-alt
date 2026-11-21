import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Accessibility follow-up (one-off check, 19 Nov). Screens are read as text, the way batch-c-static.test.ts does, so a later edit that
// takes a fix away fails here. The browser version of the same checks is e2e/tests/53-big-text-headings.spec.ts.
const read = (f: string) => readFileSync(path.resolve(__dirname, "..", f), "utf8");
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("one main heading per screen", () => {
  const home = read("src/app/(home)/page.tsx");
  it("Home: one h1 on the start screen, and a hidden 'Home' h1 only when the person has groups (never both)", () => {
    expect(count(home, /<h1[\s>]/g)).toBe(2); // the start screen's visible one + the hidden one
    expect(home).toMatch(/\{hasAny && <h1 className="sr-only">Home<\/h1>\}/);
    // The visible h1 sits inside the `!hasAny` branch (the start card), so the two never show together.
    const startBranch = home.slice(home.indexOf("{!hasAny ? ("));
    expect(startBranch.indexOf('<h1 className="font-display')).toBeGreaterThan(-1);
  });
  it("the tour: only the slide in view is an h1, the others are h2 (was seven h1s)", () => {
    const tour = read("src/components/IntroTour.tsx");
    expect(tour).toContain("i === active ? (");
    expect(count(tour, /<h1[\s>]/g)).toBe(1);
    expect(count(tour, /<h2[\s>]/g)).toBe(1);
  });
});

describe("trip group header at 200% text", () => {
  it("the faces and the Invite pill may wrap to a second line instead of pushing the page sideways", () => {
    const header = read("src/app/groups/[id]/_components/GroupHeader.tsx");
    expect(header).toContain('className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1"');
    expect(header).toContain("{faces}");
  });
});
