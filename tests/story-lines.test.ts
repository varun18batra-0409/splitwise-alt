import { describe, expect, it } from "vitest";
import { storyLines } from "@/lib/home/story-lines";

describe("story lines write themselves", () => {
  it("use the place's own lines first", () => {
    const l = storyLines({ place: "place-goa", mood: "beach", people: 5, seed: "t1-b3" });
    expect(l).toHaveLength(4);
    expect(l.some(([, line]) => /Goa|scooty|thali|beach shack/i.test(line))).toBe(true);
  });
  it("speak to two of you, or a big squad", () => {
    expect(storyLines({ place: null, mood: "any", people: 2, seed: "s" }).some(([k]) => /two|Couple/.test(k))).toBe(true);
    expect(storyLines({ place: null, mood: "any", people: 12, seed: "s" }).some(([, l]) => /12 of you|Count everyone/.test(l))).toBe(true);
  });
  it("stay the same for a day and change the next", () => {
    const a = storyLines({ place: "place-japan", mood: "city", people: 3, seed: "t1-d2" });
    expect(storyLines({ place: "place-japan", mood: "city", people: 3, seed: "t1-d2" })).toEqual(a);
    const days = ["d1", "d2", "d3", "d4", "d5"].map((d) => JSON.stringify(storyLines({ place: "place-japan", mood: "city", people: 3, seed: `t1-${d}` })));
    expect(new Set(days).size).toBeGreaterThan(1);
  });
  it("never describe what's in a photo", () => {
    for (const place of ["place-goa", "place-manali", "place-bali", null]) {
      for (const [, line] of storyLines({ place, mood: "beach", people: 4, seed: "x", n: 10 })) expect(line).not.toMatch(/this (sunset|photo|view|picture)/i);
    }
  });
});
