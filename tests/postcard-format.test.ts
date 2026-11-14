import { describe, expect, it } from "vitest";
import { ONESIDE, ONESIDE_MAX, fitOf, formatOf, oneSideTooLong, photoSizeOf } from "@/lib/postcards/format";
import { oneSideFont, roughMeasure, wrapLines } from "@/lib/postcards/fit";
import { cardProps } from "@/lib/postcards/view";
import { stampOrder } from "@/lib/postcards/catalog";

// The shape of a postcard (classic or one side), how the photo sits (fit) and the size of the taped print: unknown values are the original.
describe("postcard format, fit and photo size", () => {
  it("read as the original card when missing or made up", () => {
    expect(formatOf(undefined)).toBe("classic");
    expect(formatOf("")).toBe("classic");
    expect(formatOf("evil")).toBe("classic");
    expect(formatOf("oneside")).toBe("oneside");
    expect(fitOf("x")).toBe("full");
    expect(fitOf(undefined)).toBe("full");
    expect(fitOf("taped")).toBe("taped");
    expect(fitOf("border")).toBe("border");
    expect(photoSizeOf("huge")).toBe("small");
    expect(photoSizeOf("large")).toBe("large");
  });

  it("an older saved card (no format, fit or size) is a classic card, full fit, with no one-side props", () => {
    const old = { id: "c1", front: "print:beach", photoId: "", words: "Goa", lettering: "classic", message: "Hi", hand: "caveat", stamp: "t:airmail", paper: "cream", address: "[]", place: "Goa", createdAt: new Date("2026-01-02T10:00:00Z") };
    const c = cardProps(old, "Asha", "Asia/Kolkata");
    expect(c.format).toBe("classic");
    expect(c.front.fit).toBe("full");
    expect(c.one).toBeNull();
    expect(c.back.from).toBe("Asha");
  });

  it("a one-side row gives the one-side props (size read safely)", () => {
    const row = { id: "c2", front: "own", photoId: "p123456", words: "", lettering: "classic", message: "Hi", hand: "caveat", stamp: "t:airmail", paper: "cream", address: "[]", place: "Goa", createdAt: new Date("2026-01-02T10:00:00Z"), format: "oneside", photoSize: "medium" };
    const c = cardProps(row, "Asha", "Asia/Kolkata");
    expect(c.format).toBe("oneside");
    expect(c.one?.size).toBe("medium");
    expect(c.one?.photo).toBe("/api/postcard-photo/p123456");
    expect(cardProps({ ...row, photoSize: "huge" }, "Asha", "Asia/Kolkata").one?.size).toBe("small");
  });
});

describe("one side: 160 characters", () => {
  it("160 is fine, 161 is too long (counting JavaScript length, the same on the phone and the server)", () => {
    expect(ONESIDE_MAX).toBe(160);
    expect(oneSideTooLong("a".repeat(160))).toBe(false);
    expect(oneSideTooLong("a".repeat(161))).toBe(true);
    expect(oneSideTooLong("😀".repeat(80))).toBe(false); // 80 emoji = 160
    expect(oneSideTooLong("😀".repeat(81))).toBe(true); // 162
  });
});

describe("one side: the note shrinks to fit (worked by hand)", () => {
  // Message "abcdefghi " x16 trimmed = 159 characters (16 words of 9 letters). Hand caveat has size 1.12, small print.
  // Base font = .0657 card widths (x 1.12 / 1.12). Box width .48, box height (.85 - .20) x 2/3 = .43333.
  // roughMeasure = .45 em a letter: one word 9 x .45 = 4.05 em, two words (19 letters) 8.55 em, three (29 letters) 13.05 em.
  // Step k makes the font .0657 x (1 - .02 k) and the line length .48 / font:
  //   k=12  f=.049932  line 9.613 em   -> 2 words a line, 8 lines, 8 x 1.12 x .049932 = .44739  too tall
  //   k=13  f=.048618  line 9.873 em   -> 2 words a line, 8 lines, 8 x 1.12 x .048618 = .43562  too tall
  //   k=14  f=.047304  line 10.147 em  -> 2 words a line, 8 lines, 8 x 1.12 x .047304 = .42384  fits (.43333)
  // Earlier steps are too big: up to k=7 a line holds only one word (16 lines); k=8..11 hold two words but 8 lines are still too tall
  // (k=11: f=.051246, 8 x 1.12 x .051246 = .45916).
  const msg = "abcdefghi ".repeat(16).trim();
  it("the message is 159 characters", () => expect(msg.length).toBe(159));
  it("the base numbers", () => {
    expect(ONESIDE.small.font).toBeCloseTo(0.0657, 6);
    expect((ONESIDE.small.note.bottom - ONESIDE.small.note.top) * (2 / 3)).toBeCloseTo(0.43333, 4);
    expect(wrapLines(msg, 9.613, roughMeasure).length).toBe(8);
  });
  it("takes the 14th step down", () => {
    const r = oneSideFont(msg, 1.12, "small", roughMeasure);
    expect(r.over).toBe(false);
    expect(r.f).toBeCloseTo(0.047304, 6);
  });
  it("a short message keeps the full size", () => {
    expect(oneSideFont("Hi", 1.12, "small", roughMeasure).f).toBeCloseTo(0.0657, 6);
  });
  it("a message that can't fit even after 20 steps is shown at 60% and marked over", () => {
    const r = oneSideFont("word ".repeat(400).trim(), 1.12, "large", roughMeasure);
    expect(r.over).toBe(true);
    expect(r.f).toBeCloseTo(ONESIDE.large.font * 0.6, 8);
  });
});

describe("stamp order", () => {
  it("the chosen stamp, the trip's country, home, limited stamps on issue, then themes in the sender's money, then countries; no repeats", () => {
    const list = stampOrder("c:IN", "IN", "GB", ["r:newyear"]);
    expect(list.slice(0, 4)).toEqual(["c:IN", "c:GB", "r:newyear", "t:airmail@GB"]);
    expect(new Set(list).size).toBe(list.length);
    // all 16 themes are there, each in GB money, and the other countries follow
    expect(list.filter((s) => s.startsWith("t:")).length).toBe(16);
    expect(list.every((s) => !s.startsWith("t:") || s.endsWith("@GB"))).toBe(true);
    expect(list).toContain("c:TH");
    expect(list.indexOf("t:home@GB")).toBeLessThan(list.indexOf("c:TH"));
  });
  it("a home with no money of its own (or India) leaves the themes plain", () => {
    expect(stampOrder("t:love", "", "IN", [])[0]).toBe("t:love");
    expect(stampOrder("t:love", "", "IN", [])).toContain("t:airmail");
  });
});
