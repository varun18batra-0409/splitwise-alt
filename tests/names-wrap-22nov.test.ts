import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Founder, 22 Nov ("Second line yes"): a long name goes onto a second line instead of being cut off with "…", and at very large text
// the name moves under its letter circle. Short names look exactly as before.
const src = (f: string) => readFileSync(f, "utf8");

describe("long names wrap, never cut off", () => {
  it("Settle up cards, the record sheet and direct cards: names and group lines wrap", () => {
    for (const f of ["src/components/SettleUp.tsx", "src/app/settle/page.tsx"]) {
      const s = src(f);
      expect(s).not.toMatch(/truncate font-display text-\[20px\]/);
      expect(s).not.toMatch(/truncate text-\[14px\] text-fg\/60/);
      expect(s).toMatch(/break-words font-display text-\[20px\]/);
    }
    const settle = src("src/components/SettleUp.tsx");
    // The letter and the name share a row that can wrap; the name needs room for about 9 letters before it moves underneath.
    expect(settle.match(/flex-wrap items-(start|center) gap-x-3 gap-y-2/g)?.length).toBe(3);
    expect(settle.match(/min-w-\[9em\] flex-1 basis-\[9em\]/g)?.length).toBe(3);
    expect(src("src/app/settle/page.tsx")).toMatch(/flex min-h-11 flex-wrap items-start gap-x-3 gap-y-2/);
  });
  it("You: your name wraps and moves under the letter at very large text", () => {
    const a = src("src/app/account/page.tsx");
    expect(a).not.toContain('truncate font-display text-2xl');
    expect(a).toContain('break-words font-display text-[length:min(1.5rem,9vw)]'); // never wider than the screen at 200% text
    expect(a).toContain('hyphens-auto');
    expect(a).toContain('flex flex-wrap items-center gap-x-4 gap-y-3');
  });
});
