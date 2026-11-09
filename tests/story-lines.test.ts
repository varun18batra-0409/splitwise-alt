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

describe("story slides match their photos", () => {
  it("puts a sunset line on a sunset and a houseboat line on a houseboat", async () => {
    const { lineForPhoto } = await import("@/lib/home/photo-tags");
    const used = new Set<string>();
    expect(lineForPhoto("/photos/place-goa-4.jpg", 0, used)?.[0]).toMatch(/Golden hour|Sunset/);
    expect(lineForPhoto("/photos/place-kerala.jpg", 0, used)?.[1]).toMatch(/backwaters/);
    expect(lineForPhoto("/photos/place-somewhere-new.jpg", 0, used)).toBeNull();
  });
  it("adds a line for the time of year", async () => {
    const { storyLines } = await import("@/lib/home/story-lines");
    expect(storyLines({ month: 6, place: null, country: "IN", mood: "any", people: 3, seed: "x" }).some(([k]) => /Monsoon|Rain/.test(k))).toBe(true);
    expect(storyLines({ month: 0, place: null, country: "AU", mood: "any", people: 3, seed: "x" }).some(([k]) => /Summer|Long days/.test(k))).toBe(true);
  });
});
