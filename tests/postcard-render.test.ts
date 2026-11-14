import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PostcardFront } from "@/components/postcards/Card";
import { PostcardOneSide } from "@/components/postcards/OneSide";

// Cards from before fit existed must draw exactly as they did; the new fits and the one-side card draw their own markup.
const base = { front: "photo:/photos/place-goa.jpg", words: "Goa", lettering: "classic", tone: "white", look: "golden:70", k: "t" };
const html = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(PostcardFront, { ...base, ...props }));

describe("PostcardFront fit", () => {
  it("a missing fit is the same markup as fit full", () => {
    expect(html({})).toBe(html({ fit: "full" }));
    expect(html({ fit: "nonsense" })).toBe(html({ fit: "full" }));
  });
  it("full: the photo fills the card and there is no print frame", () => {
    const m = html({});
    expect(m).toContain('class="absolute inset-0 h-full w-full object-cover"');
    expect(m).not.toContain("data-print-frame");
    expect(m).toContain('data-fit="full"');
  });
  it("border: a frame of paper around the picture", () => {
    const m = html({ fit: "border" });
    expect(m).toContain('data-fit="border"');
    expect(m).toContain("data-print-frame");
    expect(m).toContain("inset-[5%]");
  });
  it("taped: a tilted white-edged print", () => {
    const m = html({ fit: "taped" });
    expect(m).toContain('data-fit="taped"');
    expect(m).toContain("data-print-frame");
    expect(m).toContain("rotate(-3deg)");
  });
});

describe("PostcardOneSide", () => {
  const one = { size: "medium", front: "print:beach", message: "Wish you were here", hand: "caveat", stamp: "t:airmail", paper: "cream", place: "Goa", date: "2 JAN 2026", from: "Asha", k: "o" };
  const m = renderToStaticMarkup(createElement(PostcardOneSide, one));
  it("is marked as one side, with its print size, and is not the back of a two-sided card", () => {
    expect(m).toContain("data-postcard-oneside");
    expect(m).toContain('data-photo-size="medium"');
    expect(m).not.toContain("data-postcard-back");
    expect(m).toContain("data-oneside-photo");
    expect(m).toContain("data-stamp-svg");
    expect(m).toContain("data-postmark");
    expect(m).toContain("Wish you were here");
    expect(m).toContain("— Asha");
  });
  it("an unknown size reads as small", () => {
    expect(renderToStaticMarkup(createElement(PostcardOneSide, { ...one, size: "huge" }))).toContain('data-photo-size="small"');
  });
  it("a wax seal and the touches that fit one side are drawn; the tape is not", () => {
    const t = renderToStaticMarkup(createElement(PostcardOneSide, { ...one, touches: "seal,coffee,tape,ticket" }));
    expect(t).toContain('data-touch="seal"');
    expect(t).toContain('data-touch="coffee"');
    expect(t).not.toContain('data-touch="tape"');
    expect(t).not.toContain('data-touch="ticket"');
  });
});
