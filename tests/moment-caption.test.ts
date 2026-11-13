import { describe, expect, it } from "vitest";
import { cleanCaption, cleanTakenOn, dayLabel, graphemeCount, timeAgo, tripDays } from "@/lib/moments-text";

describe("a moment's words", () => {
  it("trims and collapses spaces, and keeps emoji", () => {
    expect(cleanCaption("  The boat  we almost missed 😂 ")).toBe("The boat we almost missed 😂");
  });
  it("accepts exactly 80 characters and refuses 81", () => {
    expect(cleanCaption("a".repeat(80))).toBe("a".repeat(80));
    expect(cleanCaption("a".repeat(81))).toBeNull();
  });
  it("counts what people see: 80 family emoji are 80, 81 are too many", () => {
    const family = "👨‍👩‍👧";
    expect(graphemeCount(family)).toBe(1);
    expect(cleanCaption(family.repeat(80))).toBe(family.repeat(80));
    expect(cleanCaption(family.repeat(81))).toBeNull();
  });
  it("turns line breaks and tabs into single spaces", () => {
    expect(cleanCaption("one\ntwo\r\n\tthree")).toBe("one two three");
  });
  it("removes the characters that flip text direction (U+202E and friends)", () => {
    expect(cleanCaption("abc\u202edef")).toBe("abcdef");
    expect(cleanCaption("\u202a\u202b\u202c\u202d\u2066\u2067\u2068\u2069x")).toBe("x");
  });
  it("removes zero-width characters and direction marks, but keeps the joiner inside a family emoji", () => {
    expect(cleanCaption("a\u200bb\u200cc\u200dd\ufeffe\u200ef\u200fg\u061ch")).toBe("abcdefgh");
    expect(cleanCaption("\u200b\u200c\u200d\ufeff\u200e\u200f\u061c")).toBe("");
    const family = "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}";
    expect(cleanCaption(`x${family}\u200b`)).toBe(`x${family}`);
  });
  it("refuses more than 2,000 UTF-16 code units before doing anything else, and accepts 2,000 of spaces-and-letters that fit", () => {
    expect(cleanCaption("a".repeat(2001))).toBeNull();
    expect(cleanCaption(" ".repeat(2001))).toBeNull(); // even if it would trim to nothing
    expect(cleanCaption("a b ".repeat(100))).toBeNull(); // 400 units, fine, but 200 characters once spaces collapse is over 80
    expect(cleanCaption(`ok${" ".repeat(1998)}`)).toBe("ok"); // exactly 2,000 units: allowed
  });
  it("keeps at most 3 combining marks on a letter; 5,000 of them are refused outright", () => {
    const mark = "\u0301";
    expect(cleanCaption(`a${mark.repeat(5000)}`)).toBeNull();
    const trimmed = cleanCaption(`a${mark.repeat(300)}`);
    expect(trimmed).toBe(`a${mark.repeat(3)}`);
    expect([...trimmed!].length).toBe(4);
    expect(cleanCaption(`a${mark.repeat(2)}b${mark.repeat(3)}`)).toBe(`a${mark.repeat(2)}b${mark.repeat(3)}`); // under the cap: untouched
  });
  it("allows an empty caption", () => {
    expect(cleanCaption("")).toBe("");
    expect(cleanCaption("   \n ")).toBe("");
    expect(cleanCaption(undefined)).toBe("");
  });
});

describe("the days of a trip", () => {
  it("lists every day from the start to the end", () => {
    expect(tripDays("2026-03-30", "2026-04-02")).toEqual(["2026-03-30", "2026-03-31", "2026-04-01", "2026-04-02"]);
  });
  it("a start with no end is one day; no start means no choice", () => {
    expect(tripDays("2026-03-30", "")).toEqual(["2026-03-30"]);
    expect(tripDays("", "2026-04-02")).toEqual([]);
    expect(tripDays("not a date", "")).toEqual([]);
  });
  it("an end before the start is one day, and a very long trip stops at 60 days", () => {
    expect(tripDays("2026-03-30", "2026-03-01")).toEqual(["2026-03-30"]);
    expect(tripDays("2026-01-01", "2027-01-01")).toHaveLength(60);
  });
  it("leap day is a day", () => {
    expect(tripDays("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });
  it("only one of the trip's days is accepted, or none", () => {
    expect(cleanTakenOn("", "2026-03-30", "2026-04-02")).toBe("");
    expect(cleanTakenOn("2026-04-01", "2026-03-30", "2026-04-02")).toBe("2026-04-01");
    expect(cleanTakenOn("2026-04-03", "2026-03-30", "2026-04-02")).toBeNull();
    expect(cleanTakenOn("2026-02-30", "2026-02-01", "2026-03-30")).toBeNull();
    expect(cleanTakenOn("2026-04-01", "", "")).toBeNull(); // no trip dates: no day choice
  });
  it("says Day 3 for the third day", () => {
    expect(dayLabel("2026-04-01", "2026-03-30", "2026-04-02")).toBe("Day 3");
    expect(dayLabel("", "2026-03-30", "2026-04-02")).toBe("");
    expect(dayLabel("2026-05-01", "2026-03-30", "2026-04-02")).toBe("");
  });
});

describe("how long ago", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it("reads in plain words", () => {
    expect(timeAgo(ago(20_000), now)).toBe("just now");
    expect(timeAgo(ago(12 * 60_000), now)).toBe("12 min ago");
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe("3 h ago");
    expect(timeAgo(ago(86_400_000), now)).toBe("1 day ago");
    expect(timeAgo(ago(2 * 86_400_000), now)).toBe("2 days ago");
    expect(timeAgo(new Date("2026-11-02T12:00:00Z"), now)).toBe("2 Nov");
  });
});
