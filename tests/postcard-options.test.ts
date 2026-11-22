import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PostcardOneSide } from "@/components/postcards/OneSide";
import { HAND_PICKS, HANDS, INK_PICKS, INKS, LETTERINGS, LETTERING_PICKS, PAPER_PICKS, PAPERS, TONE_PICKS, TONES, handOf, inkColor, inkOf, keptHand, keptInk, keptLettering, keptPaper, keptTone, letteringOf, paperOf, paperTones, toneOf } from "@/lib/postcards/catalog";
import { LOOKS, LOOK_PICKS, SEAL_COLOURS, SEAL_COLOUR_PICKS, SEAL_DESIGNS, SEAL_DESIGN_PICKS, TOUCH_PICKS, TOUCHES, cleanLook, cleanSeal, cleanTouches, keptLook, lookCss, lookOf, sealOf, touchesOn } from "@/lib/postcards/looks";

// The postcard editor offers its best choices (each list 15 at most). Cheap-looking or off-style ones are not offered, but every older
// id stays valid and is drawn as the nearest offered one; the ones that came back save and draw as themselves.
describe("postcard editor: what is offered", () => {
  it("the exact lists", () => {
    expect(HAND_PICKS.map((h) => `${h.id}:${h.name}`)).toEqual(["caveat:Classic", "kalam:Casual", "patrick:Neat", "homemade:Inky", "dancing:Flowing", "satisfy:Brush", "parisienne:Parisian", "allura:Formal", "sacramento:Fine", "labelle:Loose", "nothing:Quick", "cedarville:School", "shadows:Light"]);
    expect([...LETTERING_PICKS]).toEqual(["classic", "italic", "elegant", "vogue", "riviera", "roman", "deco", "artdeco", "engraved", "poster", "bold", "typewriter", "script", "signpainter"]);
    expect([...PAPER_PICKS]).toEqual(["cream", "ivory", "airmail", "kraft", "linen", "parchment", "aged", "stone", "sage", "sky", "dusk", "blush", "lavender", "terracotta", "saffron", "seafoam", "pistachio", "harbour"]);
    expect([...INK_PICKS]).toEqual(["navy", "blue", "indigo", "black", "slate", "sepia", "brown", "oxblood", "crimson", "plum", "violet", "green", "teal"]);
    expect([...TONE_PICKS]).toEqual(["white", "ivory", "cream", "gold", "coral", "blush", "sea", "sky", "lilac", "red", "navy", "teal", "plum", "black"]);
    expect([...LOOK_PICKS]).toEqual(["none", "golden", "faded", "matte", "riviera", "cool", "bw", "sepia"]);
    expect([...SEAL_COLOUR_PICKS]).toEqual(["crimson", "scarlet", "burgundy", "blush", "gold", "bronze", "silver", "rosegold", "pearl", "navy", "sapphire", "teal", "forest", "plum", "black"]);
    expect([...SEAL_DESIGN_PICKS]).toEqual(["initial", "crest", "fleur", "heart", "star", "rose", "crown", "laurel", "compass", "anchor", "key", "moon", "plane", "bee"]);
    expect([...TOUCH_PICKS]).toEqual(["tape", "flower", "seal", "coffee", "paravion", "ticket", "map", "compass", "film", "clip", "sticker", "kiss"]); // sticker and kiss back (founder, 22 Nov)
  });

  it("no list has more than 15, and every offered id really exists", () => {
    const lists: [string, readonly string[], readonly string[]][] = [
      ["hands", HAND_PICKS.map((h) => h.id), HANDS.map((h) => h.id)],
      ["lettering", LETTERING_PICKS, LETTERINGS.map((l) => l.id)],
      ["papers", PAPER_PICKS, PAPERS.map((p) => p.id)],
      ["inks", INK_PICKS, INKS.map((i) => i.id)],
      ["tones", TONE_PICKS, TONES.map((t) => t.id)],
      ["looks", LOOK_PICKS, LOOKS.map((l) => l.id)],
      ["wax colours", SEAL_COLOUR_PICKS, SEAL_COLOURS.map((c) => c.id)],
      ["wax designs", SEAL_DESIGN_PICKS, SEAL_DESIGNS.map((d) => d.id)],
      ["touches", TOUCH_PICKS, TOUCHES.map((t) => t.id)],
    ];
    for (const [name, picked, all] of lists) {
      expect(picked.length, name).toBeLessThanOrEqual(name === "papers" ? 18 : 15); // paper is one sideways row of 18
      for (const id of picked) expect(all, `${name}: ${id}`).toContain(id);
      expect(new Set(picked).size, `${name} has no repeats`).toBe(picked.length);
    }
  });

  it("no brand names among the offered ids, or the look names, or the touch art", () => {
    const ids = [...HAND_PICKS.map((h) => h.id), ...LETTERING_PICKS, ...PAPER_PICKS, ...INK_PICKS, ...TONE_PICKS, ...LOOK_PICKS, ...SEAL_COLOUR_PICKS, ...SEAL_DESIGN_PICKS, ...TOUCH_PICKS];
    for (const id of ids) expect(id).not.toMatch(/kodak|boarding/i);
    expect(LOOKS.filter((l) => (LOOK_PICKS as readonly string[]).includes(l.id)).map((l) => l.name).join()).not.toMatch(/kodak|warm film/i);
    expect(TOUCHES.filter((t) => (TOUCH_PICKS as readonly string[]).includes(t.id)).map((t) => `${t.name} ${t.svg}`).join()).not.toMatch(/boarding|kodak/i);
  });

  it("the touches that came back are on the right sides", () => {
    const side = (id: string) => TOUCHES.find((t) => t.id === id)!.side;
    for (const id of ["clip", "ticket", "map", "compass", "film"]) expect(side(id), id).toBe("front");
    expect(side("paravion")).toBe("back");
  });
});

describe("postcard editor: a dropped choice is drawn as the nearest one offered (worked by hand)", () => {
  it("handwriting", () => {
    expect(keptHand("reenie")).toBe("kalam");
    expect(keptHand("indie")).toBe("kalam");
    expect(keptHand("gochi")).toBe("kalam");
    expect(keptHand("grace")).toBe("kalam");
    expect(keptHand("delafield")).toBe("caveat");
    expect(handOf("delafield").family).toBe("Caveat");
    expect(handOf("nothing-made-up").family).toBe("Caveat"); // unknown stays the default
    // brought back: they are themselves now
    for (const id of ["homemade", "dancing", "satisfy", "parisienne", "allura", "sacramento", "labelle", "nothing", "cedarville", "shadows", "patrick"]) expect(keptHand(id)).toBe(id);
    expect(handOf("allura").family).toBe("Allura");
  });
  it("lettering", () => {
    for (const id of ["neon", "collegiate", "stencil", "woodtype", "condensed"]) expect(letteringOf(id).id, id).toBe("poster");
    for (const id of ["bollywood", "sport", "blackletter"]) expect(letteringOf(id).id, id).toBe("script");
    for (const id of ["slab", "retro", "editorial"]) expect(letteringOf(id).id, id).toBe("classic");
    for (const id of ["elegant", "vogue", "riviera", "roman", "deco", "artdeco", "engraved", "bold", "signpainter"]) expect(keptLettering(id), id).toBe(id);
    expect(LETTERINGS.find((l) => l.id === "elegant")?.hidden).toBeFalsy();
    expect(LETTERINGS.find((l) => l.id === "vogue")?.hidden).toBeFalsy();
  });
  it("paper", () => {
    expect(paperOf("butter")).toBe("cream");
    expect(paperOf("rose")).toBe("cream");
    expect(paperOf("mint")).toBe("sage");
    expect(paperTones("butter")).toEqual(paperTones("cream"));
    expect(paperOf("kraft")).toBe("kraft");
    expect(paperOf("lavender")).toBe("lavender");
    expect(paperOf("made-up")).toBe("cream");
  });
  it("the five new papers: offered last, exact tones, saved as themselves, drawn by the card and the saved-image drawing alike", () => {
    expect(PAPER_PICKS).toHaveLength(18);
    expect([...PAPER_PICKS].slice(-5)).toEqual(["terracotta", "saffron", "seafoam", "pistachio", "harbour"]);
    const tones: Record<string, string[]> = {
      terracotta: ["#f9e6d9", "#f1cfba", "#e8bda5"],
      saffron: ["#fdeec6", "#fbd996", "#f4c670"],
      seafoam: ["#e2f4f2", "#bce4e2", "#9fd5d6"],
      pistachio: ["#f0f5d4", "#dfeab4", "#cfdf97"],
      harbour: ["#e2eaf6", "#c3d4ec", "#aec3e2"],
    };
    for (const [id, g] of Object.entries(tones)) {
      expect(paperOf(id), id).toBe(id); // a saved card keeps it
      expect([...paperTones(id)], id).toEqual(g); // render.ts (saved and sent images) and Card.tsx both read paperTones
    }
    // The card on screen uses the middle tone of the new paper.
    const oneSide = { size: "medium", front: "print:beach", message: "Hi", hand: "caveat", stamp: "t:airmail", paper: "harbour", place: "Goa", date: "2 JAN 2026", from: "Asha", k: "p" };
    expect(renderToStaticMarkup(createElement(PostcardOneSide, oneSide))).toContain("#e2eaf6");
  });
  it("ink", () => {
    expect(inkOf("burnt")).toBe("sepia");
    for (const id of ["emerald", "turquoise", "olive"]) expect(inkOf(id), id).toBe("green");
    expect(keptInk("blue")).toBe("blue");
    expect(inkOf("blue")).toBe("blue");
    expect(inkColor("blue")).toBe("#24489a");
    expect(inkColor("burnt")).toBe(inkColor("sepia"));
    expect(inkColor("sepia")).toBe("#6b3f22");
  });
  it("words colour", () => {
    expect(keptTone("peach")).toBe("coral");
    expect(keptTone("sunflower")).toBe("gold");
    expect(keptTone("mint")).toBe("white");
    expect(toneOf("forest").id).toBe("black");
    expect(toneOf("chocolate").id).toBe("black");
    expect(toneOf("chocolate").dark).toBe(true); // still dark, so the card still adds its light glow
    for (const id of ["ivory", "blush", "sea", "sky", "lilac", "red", "teal", "plum"]) expect(keptTone(id), id).toBe(id);
  });
  it("looks", () => {
    expect(lookOf("kodak:60")).toEqual({ id: "golden", amount: 60 });
    expect(cleanLook("kodak:70")).toBe("golden:70");
    expect(keptLook("kodak")).toBe("golden");
    expect(lookCss("kodak:100")).toBe(lookCss("golden:100"));
    // brought back: they save and draw as themselves
    expect(cleanLook("riviera:60")).toBe("riviera:60");
    expect(keptLook("matte")).toBe("matte");
    expect(cleanLook("cool:80")).toBe("cool:80");
    expect(lookCss("cool:80")).not.toBe("none");
  });
  it("wax: the colours and designs off the picker are still drawn as themselves", () => {
    for (const id of ["ochre", "copper", "olive"]) expect(sealOf(`${id}:initial`).colour, id).toBe(id);
    for (const id of ["xo", "infinity"]) expect(sealOf(`crimson:${id}`).design, id).toBe(id);
    expect(cleanSeal("copper:xo")).toBe("copper:xo");
    expect(cleanSeal("nonsense:thing")).toBe("crimson:initial");
  });
  it("touches: the ones that came back draw as themselves; the stickers with a brand or place feel draw as the tape", () => {
    for (const id of ["clip", "ticket", "map", "compass", "film"]) expect(touchesOn(id, "front").map((t) => t.id), id).toEqual([id]);
    expect(touchesOn("paravion", "back").map((t) => t.id)).toEqual(["paravion"]);
    expect(cleanTouches("clip,ticket,map,compass,film,paravion")).toBe("clip,ticket,map,compass,film,paravion");
    // still mapped to the tape (two removed -> one tape, not two)
    expect(touchesOn("boarding,luggage", "front").map((t) => t.id)).toEqual(["tape"]);
    expect(touchesOn("corners", "front").map((t) => t.id)).toEqual(["tape"]);
    // The hotel sticker and the lipstick kiss are offered again (founder, 22 Nov) and draw as themselves.
    expect(touchesOn("sticker", "front").map((t) => t.id)).toEqual(["sticker"]);
    expect(touchesOn("tape,flower", "front").map((t) => t.id).sort()).toEqual(["flower", "tape"]);
    // the kiss as itself, in the address half (x from 0.5), never over the message; stamp-like labels on the back are left off
    expect(touchesOn("kiss", "back").map((t) => t.id)).toEqual(["kiss"]);
    expect(TOUCHES.find((t) => t.id === "kiss")!.x).toBeGreaterThanOrEqual(0.5);
    expect(touchesOn("customs,arrived,received,seal", "back").map((t) => t.id)).toEqual(["seal"]);
  });
  it("touches on a one-side card: no tape, only the few that fit, each at its own spot", () => {
    const on = touchesOn("tape,seal,coffee,flower,paravion,ticket,clip", "oneside");
    expect(on.map((t) => t.id).sort()).toEqual(["coffee", "flower", "paravion", "seal"]);
    const seal = on.find((t) => t.id === "seal")!;
    expect([seal.x, seal.y, seal.w]).toEqual([0.4, 0.74, 0.13]);
    const coffee = on.find((t) => t.id === "coffee")!;
    expect([coffee.x, coffee.y, coffee.w]).toEqual([0.02, 0.68, 0.26]);
    const flower = on.find((t) => t.id === "flower")!;
    expect([flower.x, flower.y, flower.w]).toEqual([0.05, 0.62, 0.16]);
  });
});
