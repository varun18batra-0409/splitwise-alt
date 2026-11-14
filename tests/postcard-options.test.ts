import { describe, expect, it } from "vitest";
import { HAND_PICKS, HANDS, INK_PICKS, INKS, LETTERING_PICKS, PAPER_PICKS, TONE_PICKS, handOf, inkColor, inkOf, keptHand, keptInk, keptLettering, keptPaper, keptTone, letteringOf, paperOf, paperTones, toneOf } from "@/lib/postcards/catalog";
import { LOOK_PICKS, TOUCH_PICKS, TOUCHES, cleanLook, keptLook, lookCss, lookOf, touchesOn } from "@/lib/postcards/looks";

// The postcard editor offers few choices. Every older id stays valid and is drawn as the nearest kept one.
describe("postcard editor: fewer choices", () => {
  it("how many of each are offered", () => {
    expect(HAND_PICKS.map((h) => h.name)).toEqual(["Classic", "Casual", "Neat"]);
    expect(PAPER_PICKS.length).toBe(4);
    expect(INK_PICKS.length).toBe(4);
    expect(TONE_PICKS.length).toBe(6);
    expect(LOOK_PICKS.length).toBe(5);
    expect(LETTERING_PICKS.length).toBe(5);
    expect(TOUCH_PICKS.length).toBe(4);
    // every offered id really exists
    for (const h of HAND_PICKS) expect(HANDS.some((x) => x.id === h.id)).toBe(true);
    for (const i of INK_PICKS) expect(INKS.some((x) => x.id === i)).toBe(true);
    for (const t of TOUCH_PICKS) expect(TOUCHES.some((x) => x.id === t)).toBe(true);
  });

  it("no brand names in the look names or the touches picked", () => {
    expect(lookOf("kodak:60")).toEqual({ id: "golden", amount: 60 });
    expect(JSON.stringify(LOOK_PICKS)).not.toMatch(/kodak/i);
    expect(TOUCHES.filter((t) => (TOUCH_PICKS as readonly string[]).includes(t.id)).map((t) => t.name).join()).not.toMatch(/boarding|kodak/i);
  });

  it("a removed choice is drawn as the nearest kept one (worked by hand)", () => {
    // handwriting: flowing scripts -> Classic (caveat), rounded print hands -> Casual (kalam)
    expect(keptHand("parisienne")).toBe("caveat");
    expect(keptHand("gochi")).toBe("kalam");
    expect(keptHand("patrick")).toBe("patrick");
    expect(handOf("allura").family).toBe("Caveat");
    expect(handOf("nothing-made-up").family).toBe("Caveat"); // unknown stays the default
    // paper: kraft -> cream, mint -> sage, lavender -> ivory
    expect(keptPaper("kraft")).toBe("cream");
    expect(keptPaper("mint")).toBe("sage");
    expect(paperOf("lavender")).toBe("ivory");
    expect(paperTones("kraft")).toEqual(paperTones("cream"));
    // ink: royal blue -> midnight (navy), emerald -> bottle green, crimson -> sepia
    expect(keptInk("blue")).toBe("navy");
    expect(inkOf("emerald")).toBe("green");
    expect(inkColor("crimson")).toBe(inkColor("sepia"));
    expect(inkColor("sepia")).toBe("#6b3f22");
    // words colour: lilac -> white, chocolate -> black (still dark, so the card still adds its light glow)
    expect(keptTone("lilac")).toBe("white");
    expect(toneOf("chocolate").id).toBe("black");
    expect(toneOf("chocolate").dark).toBe(true);
    // lettering: Stencil -> Poster, Bold -> Classic
    expect(keptLettering("stencil")).toBe("poster");
    expect(letteringOf("bold").id).toBe("classic");
    // look: Kodak warm -> Golden hour (keeps its strength), Matte -> Faded, Nordic -> Natural
    expect(cleanLook("kodak:70")).toBe("golden:70");
    expect(keptLook("matte")).toBe("faded");
    expect(lookCss("cool:80")).toBe("none");
    expect(lookCss("kodak:100")).toBe(lookCss("golden:100"));
  });

  it("old touches: front stickers draw as the tape, the kiss as the coffee ring, back stamp-like labels are left off", () => {
    expect(touchesOn("boarding,clip", "front").map((t) => t.id)).toEqual(["tape"]); // two removed -> one tape, not two
    expect(touchesOn("tape,flower", "front").map((t) => t.id).sort()).toEqual(["flower", "tape"]);
    expect(touchesOn("kiss", "back").map((t) => t.id)).toEqual(["coffee"]);
    expect(touchesOn("customs,arrived,received,seal", "back").map((t) => t.id)).toEqual(["seal"]);
  });
});
