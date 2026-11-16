import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PREVIEW_CLASS, PREVIEW_W, PREVIEW_W_SMALL, previewWidth } from "@/lib/postcards/preview";
import { CARD_H, KICKER_CQW, bandCqw, bandSide, marginInk, printBox, scrimTop, scrimWanted, titleSizeCqw, wordsOnMargin } from "@/lib/postcards/lettering";
import { ONESIDE } from "@/lib/postcards/format";
import { RARE, rareOpen, rareWhen, windowLabel } from "@/lib/postcards/catalog";
import { ONESIDE_TOUCHES, REACTIONS, TOUCHES, sealBackLine } from "@/lib/postcards/looks";
import { countdownPoster } from "@/lib/home/stories";
import { PICKER_SHORT, placePicker } from "@/lib/picker-place";

const src = (p: string) => readFileSync(p, "utf8");

describe("s1: the editor preview keeps one size", () => {
  it("300 css px on a normal phone, 176 on a 320 phone", () => {
    expect(PREVIEW_W).toBe(300);
    expect(PREVIEW_W_SMALL).toBe(176);
    expect(previewWidth(390)).toBe(300);
    expect(previewWidth(360)).toBe(300);
    expect(previewWidth(359)).toBe(176);
    expect(previewWidth(320)).toBe(176);
    expect(PREVIEW_CLASS).toBe("w-[300px] max-[359px]:w-[176px]");
  });
  it("the composer uses the fixed size on every tab and does not shrink it for the keyboard; the panel gives way instead", () => {
    const c = src("src/app/postcards/new/Composer.tsx");
    expect(c).toContain("const cardW = PREVIEW_CLASS;");
    expect(c).not.toContain("60cqw");
    expect(c).not.toContain("144cqh");
    expect(c).not.toContain("[container-type:size]");
    expect(c).toMatch(/data-composer-preview/);
    const shared = src("src/app/postcards/new/editor/shared.tsx");
    expect(shared).toContain("min-h-[7rem] shrink overflow-y-auto");
    expect(shared).not.toContain("max-h-[40svh] flex-none");
  });
});

describe("s2: wax seal labels and the coffee ring", () => {
  it("the picker has Colour and Design labels, a bold chosen name, and never cuts a name off", () => {
    const n = src("src/app/postcards/new/editor/NotePanels.tsx");
    expect(n).toMatch(/data-wax-label="colour"[^>]*>\s*Colour\s*</);
    expect(n).toMatch(/data-wax-label="design"[^>]*>\s*Design\s*</);
    expect(n).toContain('sel ? "font-bold text-fg"');
    expect(n).not.toMatch(/truncate text-\[10\.5px\]/);
  });
  it("on the back, the coffee ring is clear of the handwritten message (left 6% to 53%, 19% to 92% down)", () => {
    const c = TOUCHES.find((t) => t.id === "coffee")!;
    const ring = { l: c.x, r: c.x + c.w, t: c.y, b: c.y + c.w * 1.5 }; // a square, on a 3:2 card: its height is 1.5 times its width
    const message = { l: 0.06, r: 0.53, t: 0.19, b: 0.92 };
    const overlap = ring.l < message.r && ring.r > message.l && ring.t < message.b && ring.b > message.t;
    expect(overlap).toBe(false);
    expect(ring.r).toBeLessThanOrEqual(1); // x 0.64 + 0.3 = 0.94, inside the card
  });
  it("on a one-side card, the coffee ring is clear of the note in every photo size", () => {
    expect(ONESIDE_TOUCHES.coffee).toEqual({ x: 0.02, y: 0.68, w: 0.26, rot: 0 });
    const c = ONESIDE_TOUCHES.coffee;
    for (const size of ["small", "medium", "large"] as const) {
      const note = ONESIDE[size].note; // x and width, as shares of the card's width
      expect(c.x + c.w, `${size}: ring ends at ${c.x + c.w}, note starts at ${note.x}`).toBeLessThan(note.x);
    }
  });
});

describe("s3: lettering you can always read", () => {
  it("hand-worked layout: a normal title (13.5) needs a 19.3 band; the print gets what is left", () => {
    expect(titleSizeCqw(false, false, 1)).toBe(13.5);
    expect(titleSizeCqw(true, true, 1)).toBe(11);
    expect(titleSizeCqw(false, false, 1.5)).toBe(20.25);
    expect(KICKER_CQW).toBe(3.2);
    // 3.2 (small line) + 13.5 (title) + 2.6 (air) = 19.3
    expect(bandCqw(13.5)).toBeCloseTo(19.3, 5);
    // card height is 100 * 2/3 = 66.667; room for the print = 66.667 - 19.3 = 47.367
    expect(CARD_H).toBeCloseTo(66.667, 3);
    const box = printBox(19.3, 4 / 3);
    expect(box.area).toBeCloseTo(47.367, 3);
    // print height = 47.367 - 7 (tape and tilt) = 40.367; width = (40.367 - 1.6 - 6) * 4/3 + 3.2 = 46.89
    expect(box.w).toBeCloseTo(46.89, 2);
    expect(box.h).toBeCloseTo(40.367, 2);
    // the print and the band together stay inside the card
    expect(box.h + 7 + 19.3).toBeCloseTo(CARD_H, 2);
    // the biggest title (150%): a 26.5 band still leaves a print at least 20 high
    expect(printBox(bandCqw(titleSizeCqw(false, false, 1.5)), 4 / 3).h).toBeGreaterThanOrEqual(20);
    // a very wide print is capped at the old 62
    expect(printBox(0, 4 / 3).w).toBe(62);
  });
  it("margin rules: taped and border put words on the margin; the top setting uses the top margin", () => {
    expect(wordsOnMargin("taped")).toBe(true);
    expect(wordsOnMargin("border")).toBe(true);
    expect(wordsOnMargin("full")).toBe(false);
    expect(bandSide("top")).toBe("top");
    expect(bandSide("middle")).toBe("bottom");
    expect(bandSide("bottom")).toBe("bottom");
  });
  it("a scrim only for light words over a full photo; light words on the margin are drawn in navy", () => {
    expect(scrimWanted("full", false, true)).toBe(true);
    expect(scrimWanted("full", true, true)).toBe(false);
    expect(scrimWanted("full", false, false)).toBe(false);
    expect(scrimWanted("taped", false, true)).toBe(false);
    expect(scrimTop("bottom")).toBeCloseTo(0.6, 5);
    expect(scrimTop("top")).toBe(0);
    expect(scrimTop("middle")).toBeCloseTo(0.3, 5);
    expect(marginInk({ c: "#f2c66d", dark: false })).toBe("#1d2a52");
    expect(marginInk({ c: "#c8312b", dark: true })).toBe("#c8312b");
  });
  it("the sent picture draws the same way (source)", () => {
    const r = src("src/components/postcards/render.ts");
    expect(r).toContain("scrimWanted(");
    expect(r).toContain("wordsOnMargin(fit)");
    expect(r).toContain("marginInk(t)");
  });
});

describe("s4: stamps and seals", () => {
  it("dates come from the app's own windows", () => {
    expect(RARE.holi.from).toBe("03-10");
    expect(RARE.holi.to).toBe("03-25");
    expect(RARE.diwali.from).toBe("10-25");
    expect(RARE.diwali.to).toBe("11-12");
    expect(windowLabel("03-10", "03-25")).toBe("10 to 25 March");
    expect(windowLabel("10-25", "11-12")).toBe("25 Oct to 12 Nov");
    expect(rareWhen("r:holi")).toBe("10 to 25 March");
    expect(rareWhen("r:diwali")).toBe("25 Oct to 12 Nov");
    expect(rareWhen("r:holi@US")).toBe("10 to 25 March"); // a stamp that carries a sender's country
    expect(rareWhen("r:kites")).toBe("mid January"); // descriptions that say something are kept
    expect(rareWhen("r:nonsense")).toBe("");
  });
  it("no album line repeats the stamp's name", () => {
    for (const id of Object.keys(RARE)) expect(rareWhen(`r:${id}`).toLowerCase(), id).not.toBe(RARE[id].name.toLowerCase());
  });
  it("the label matches what is enforced (India time): Holi on 10 and 25 March, not 9 or 26", () => {
    const at = (s: string) => new Date(`${s}T06:30:00Z`); // noon in India
    expect(rareOpen("r:holi", at("2026-03-10"))).toBe(true);
    expect(rareOpen("r:holi", at("2026-03-25"))).toBe(true);
    expect(rareOpen("r:holi", at("2026-03-09"))).toBe(false);
    expect(rareOpen("r:holi", at("2026-03-26"))).toBe(false);
    expect(rareOpen("r:diwali", at("2026-10-25"))).toBe(true);
    expect(rareOpen("r:diwali", at("2026-11-12"))).toBe(true);
    expect(rareOpen("r:diwali", at("2026-11-13"))).toBe(false);
  });
  it("album and shelf copy", () => {
    const a = src("src/app/postcards/stamps/page.tsx");
    expect(a).toContain("each available for a few days or weeks a year");
    expect(a).not.toContain("on issue for a few days");
    expect(a).toContain("rareWhen(id)");
    expect(a).toContain("opacity-[0.55] grayscale"); // easier to see than the old 0.16
    expect(src("src/app/postcards/page.tsx")).toContain("Rare stamps to collect");
  });
  it("the line over the five seals", () => {
    expect(sealBackLine(null)).toBe("Press a seal back on it");
    expect(sealBackLine("")).toBe("Press a seal back on it");
    expect(sealBackLine("bogus")).toBe("Press a seal back on it");
    expect(sealBackLine("love")).toBe("Sent: Love it");
    for (const r of REACTIONS) expect(sealBackLine(r.id)).toBe(`Sent: ${r.name}`);
    const page = src("src/app/postcards/[id]/page.tsx");
    expect(page).toContain("sealBackLine(p.reaction)");
    expect(page).toContain("data-seal-chosen");
    expect(page).toContain("opacity-45"); // the others fade
    expect(page).toContain("grid grid-cols-5"); // five seals fit a 320 phone without cutting a name
  });
});

describe("s5: the countdown slide", () => {
  it("uses the trip photo, 'Sleeps to {Place}' and 'Time to start packing'", () => {
    expect(countdownPoster(45, "Manali", "/photos/manali.jpg")).toEqual({ kind: "poster", tone: "sun", kicker: "Sleeps to Manali", big: "45", line: "Time to start packing", photo: "/photos/manali.jpg" });
  });
  it("no photo, no photo key; one sleep is singular; the last days keep their playful line", () => {
    expect(countdownPoster(45, "Manali")).not.toHaveProperty("photo");
    expect(countdownPoster(1, "Goa")).toMatchObject({ kicker: "Sleep to Goa", big: "1" });
    expect(countdownPoster(3, "Goa").line).toContain("counting");
    expect(JSON.stringify(countdownPoster(45, "Manali"))).not.toContain("lock screen");
  });
  it("the slide draws the photo under a dark layer and keeps the big number", () => {
    const s = src("src/components/Stories.tsx");
    expect(s).toContain("data-poster-scrim");
    expect(s).toContain("f.photo ?");
    expect(s).toContain("min(84px, "); // the number stays as big as before
  });
});

describe("s6: emoji in colour, and the picker under the +", () => {
  it("colour emoji font first for emoji; only emoji ranges, so digits and ordinary symbols keep their own font", () => {
    const css = src("src/app/globals.css");
    const face = css.slice(css.indexOf('font-family: "Loopin Colour Emoji"'));
    expect(face).toContain('local("Noto Color Emoji")');
    expect(face).toContain('local("Apple Color Emoji")');
    expect(face).toContain('local("Segoe UI Emoji")');
    const range = /unicode-range:([^;]+);/.exec(face)![1];
    expect(range).toContain("U+1F000-1FAFF");
    expect(range).not.toMatch(/U\+0023|U\+002A|U\+0030/); // # * and digits (keycaps)
    expect(range).not.toContain("U+2600"); // ✓ ♥ ☼ stay plain text
    expect(css).toMatch(/--font-sans: var\(--font-instrument\), "Loopin Colour Emoji", ui-sans-serif/);
    expect(css).toMatch(/\.emoji-font \{\s*font-family: var\(--font-sans, system-ui\), "Loopin Colour Emoji"/);
  });
  it("hand-worked picker places: room under, scroll to fit, above only when short of room", () => {
    // 800 tall phone, + at 356..400: room under = 800 - 96 (bar) - 400 - 8 = 296, picker 262 fits
    expect(placePicker({ buttonTop: 356, buttonBottom: 400, viewHeight: 800, panelHeight: 262, scrollRoom: 500 })).toEqual({ above: false, scrollBy: 0, maxHeight: 262 });
    // 640 tall, + at 456..500: room under = 640 - 96 - 500 - 8 = 36; needs 226 more; the + can move up 456 - 72 = 384, so scroll by 226
    expect(placePicker({ buttonTop: 456, buttonBottom: 500, viewHeight: 640, panelHeight: 262, scrollRoom: 1000 })).toEqual({ above: false, scrollBy: 226, maxHeight: 262 });
    // the page can only scroll 100 more: room under becomes 136 (under 160), above has 456 - 8 - 72 = 376, so open above, short (184)
    expect(placePicker({ buttonTop: 456, buttonBottom: 500, viewHeight: 640, panelHeight: 262, scrollRoom: 100 })).toEqual({ above: true, scrollBy: 0, maxHeight: PICKER_SHORT });
    expect(PICKER_SHORT).toBe(184);
    // the + near the top of a short screen: more room under (152) than above (20), so stay under and scroll inside
    expect(placePicker({ buttonTop: 100, buttonBottom: 144, viewHeight: 400, panelHeight: 262, scrollRoom: 0 })).toEqual({ above: false, scrollBy: 0, maxHeight: 152 });
  });
  it("the picker is anchored with a pointer and measures its full height", () => {
    const p = src("src/app/groups/[id]/moments/_components/ReactionPicker.tsx");
    expect(p).toContain("placePicker(");
    expect(p).toContain("data-picker-pointer");
    expect(p).toContain("panel.current.scrollHeight");
    expect(p).toContain("overflow-y-auto");
  });
});

describe("screenshots and docs", () => {
  it("each changed screen has a shot at 390 and 320", () => {
    const s = src("scripts/screenshots.ts");
    expect(s).toContain("for (const w of [390, 320] as const)");
    for (const n of ["s1-card-photo", "s1-card-words", "s1-card-message", "s2-wax-seal", "s2-coffee-ring", "s3-gold-scrim", "s3-taped-margin", "s3-border-margin", "s4-stamp-album", "s4-shelf", "s4-seal-pressed", "s5-countdown-slide"]) expect(s, n).toContain(`b11e-${n}-\${w}`);
    expect(s).toContain("viewer-reactions-fit");
  });
  it("How Loopin works and the FAQ describe the new screens", () => {
    const h = src("src/app/how-it-works/page.tsx");
    expect(h).toContain("Sent: Love it");
    expect(h).toContain("10 to 25 March");
    expect(h).toContain("25 Oct to 12 Nov");
    expect(src("src/app/faq/page.tsx")).toContain("dates they’re available");
  });
});
