import { describe, expect, it } from "vitest";
import { cleanCaption, graphemeCount, timeAgo } from "@/lib/moments-text";

// B5 part A: captions keep skin tones and Indian scripts (SB-6); a moment's date is the reader's day (SB-12).
// Every expected value is written out by hand.

describe("SB-6: joiners in captions", () => {
  it("keeps a skin-toned emoji joined to another emoji, and counts it as one character", () => {
    const technologist = "\u{1F469}\u{1F3FD}‍\u{1F4BB}"; // woman, medium skin tone, joiner, laptop
    expect(cleanCaption(technologist)).toBe(technologist);
    expect(graphemeCount(technologist)).toBe(1);
  });
  it("keeps a plain family emoji and a variation-selector emoji joined", () => {
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    expect(cleanCaption(family)).toBe(family);
    const heart = "❤️‍\u{1F525}"; // heart + selector + joiner + fire
    expect(cleanCaption(heart)).toBe(heart);
  });
  it("keeps joiners inside one Indian script: Sinhala, Devanagari (both joiners), Tamil", () => {
    expect(cleanCaption("ශ්‍රී")).toBe("ශ්‍රී");
    expect(cleanCaption("क्‍ष")).toBe("क्‍ष");
    expect(cleanCaption("क्‌ष")).toBe("क्‌ष");
    expect(cleanCaption("க்‍ஷ")).toBe("க்‍ஷ");
  });
  it("still strips them everywhere else", () => {
    expect(cleanCaption("a‍b")).toBe("ab");
    expect(cleanCaption("a‌b")).toBe("ab");
    expect(cleanCaption("क‍A")).toBe("कA"); // Devanagari on one side only
    expect(cleanCaption("क‌க")).toBe("कக"); // two different Indian scripts
    expect(cleanCaption("\u{1F600}‍a")).toBe("\u{1F600}a"); // emoji then a letter
    expect(cleanCaption("a​‎b")).toBe("ab"); // zero-width space and direction mark: still gone
  });
});

describe("SB-12: a moment older than a week shows the reader's day", () => {
  // 2026-11-09 20:30 UTC is 02:00 on 10 Nov in India (UTC+5:30) and still 9 Nov in UTC.
  const then = new Date("2026-11-09T20:30:00Z");
  const now = new Date("2026-11-20T12:00:00Z");
  it("India reads 10 Nov, UTC reads 9 Nov", () => {
    expect(timeAgo(then, now, "Asia/Kolkata")).toBe("10 Nov");
    expect(timeAgo(then, now, "UTC")).toBe("9 Nov");
  });
  it("the words for recent moments do not depend on the zone", () => {
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(timeAgo(ago(12 * 60_000), now, "UTC")).toBe("12 min ago");
    expect(timeAgo(ago(2 * 86_400_000), now, "Asia/Kolkata")).toBe("2 days ago");
  });
});
