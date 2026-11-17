import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { photoSet, pickBySeed, placePhoto, placeSlot, tripPhotoSrc } from "@/lib/places";
import { homeHighlights } from "@/lib/home/highlights";

// A made-up set of downloaded photos: Thailand has 4, Kyoto and Japan one each.
const have = Object.fromEntries(
  [
    ["place-thailand", "/photos/place-thailand.jpg"], ["place-thailand-2", "/photos/place-thailand-2.jpg"],
    ["place-thailand-3", "/photos/place-thailand-3.jpg"], ["place-thailand-4", "/photos/place-thailand-4.jpg"],
    ["place-kyoto", "/photos/place-kyoto.jpg"], ["place-japan", "/photos/place-japan.jpg"], ["place-japan-2", "/photos/place-japan-2.jpg"],
    ["cover-friends", "/photos/cover-friends.jpg"],
  ].map(([k, src]) => [k, { src }]),
);

describe("Kyoto vs Tokyo", () => {
  it("Kyoto has its own photo; Tokyo, Osaka, Hokkaido and Japan keep the Japan one", () => {
    expect(placeSlot("Kyoto weekend")).toBe("place-kyoto");
    expect(placeSlot("Kyoto, Japan")).toBe("place-kyoto"); // Kyoto wins over the country
    expect(placeSlot("Tokyo 2027")).toBe("place-japan");
    expect(placeSlot("Osaka food trip")).toBe("place-japan");
    expect(placeSlot("Hokkaido skiing")).toBe("place-japan");
    expect(placeSlot("Japan")).toBe("place-japan");
  });
  it("the photo shown follows: Kyoto the temple, Tokyo the tower", () => {
    expect(placePhoto("Kyoto weekend", undefined, have)?.src).toBe("/photos/place-kyoto.jpg");
    expect(placePhoto("Tokyo 2027", undefined, have)?.src).toBe("/photos/place-japan.jpg");
    expect(photoSet("place-kyoto", have)).toEqual(["/photos/place-kyoto.jpg"]);
  });
});

describe("A group with no cover chosen gets a stable photo of its place", () => {
  const trip = (id: string) => ({ id, name: "Thailand trip", type: "trip", cover: "" });
  it("the same group id always gives the same photo", () => {
    for (const id of ["g1", "cm0abc", "xyz-99"]) {
      const first = tripPhotoSrc(trip(id), have);
      for (let i = 0; i < 5; i++) expect(tripPhotoSrc(trip(id), have)).toBe(first);
      expect(placePhoto("Thailand trip", id, have)?.src).toBe(first);
    }
  });
  it("20 different groups show at least 2 different Thailand photos, all from the set", () => {
    const set = photoSet("place-thailand", have);
    const shown = new Set(Array.from({ length: 20 }, (_, i) => tripPhotoSrc(trip(`group-${i}`), have)));
    expect(shown.size).toBeGreaterThanOrEqual(2);
    for (const s of shown) expect(set).toContain(s);
  });
  it("without an id the first photo is used, as before; a single-photo place always shows it", () => {
    expect(placePhoto("Thailand trip", undefined, have)?.src).toBe("/photos/place-thailand.jpg");
    expect(placePhoto("Kyoto weekend", "any-id", have)?.src).toBe("/photos/place-kyoto.jpg");
  });
  it("a chosen cover is left alone", () => {
    expect(tripPhotoSrc({ id: "g1", name: "Thailand trip", type: "trip", cover: "photo-friends" }, have)).toBeUndefined();
    expect(tripPhotoSrc({ id: "g1", name: "Thailand trip", type: "trip", cover: "plain" }, have)).toBeUndefined();
    expect(tripPhotoSrc({ id: "g1", name: "Flat", type: "home", cover: "" }, have)).toBeUndefined();
  });
  it("pickBySeed: empty list gives nothing", () => {
    expect(pickBySeed([], "x")).toBeUndefined();
  });
});

describe("No place lists the same photo twice", () => {
  // Read the photo lists straight from the script (it runs at build, so it is read as text).
  const script = readFileSync("scripts/fetch-photos.mjs", "utf8");
  const ids = (line: string) => [...line.matchAll(/photo-[0-9a-f]+-[0-9a-f]+/g)].map((m) => m[0]);
  it("each place's own list (MORE and INDIA) has no repeated id", () => {
    for (const block of ["const MORE = {", "const INDIA = {"]) {
      const body = script.slice(script.indexOf(block), script.indexOf("};", script.indexOf(block)));
      for (const line of body.split("\n")) {
        const list = ids(line);
        expect(new Set(list).size, line.slice(0, 60)).toBe(list.length);
      }
    }
  });
  it("across a place's numbered photos (place-x, place-x-2, place-x-3…) no id is used twice", () => {
    // Rebuild the slot lists the way the script does: the main list, MORE as -2, -3…, INDIA as main then -2…
    const section = (from: string) => script.slice(script.indexOf(from), script.indexOf("};", script.indexOf(from)));
    const family = new Map<string, string[]>();
    const add = (slot: string, list: string[]) => family.set(slot, [...(family.get(slot) ?? []), list[0] ?? ""]);
    const entries = (body: string) => [...body.matchAll(/^\s+"([a-z0-9-]+)": \[(.*)\],?(?:\s*\/\/.*)?$/gm)];
    const mainBody = script.slice(script.indexOf("const SLOTS = {"), script.indexOf("// More pictures of each place"));
    for (const [, slot, list] of entries(mainBody)) if (slot.startsWith("place-")) add(slot, ids(list));
    for (const [, slot, list] of entries(section("const MORE = {"))) ids(list).forEach((id) => add(slot, [id]));
    for (const [, slot, list] of entries(section("const INDIA = {"))) {
      // an entry that is a nested list ([[a, b]]) is one slot's candidates, so its first id counts once
      const nested = list.trim().startsWith("[");
      (nested ? [ids(list)] : ids(list).map((id) => [id])).forEach((cands) => add(slot, cands));
    }
    expect(family.size).toBeGreaterThan(20);
    for (const [slot, list] of family) expect(new Set(list).size, `${slot} repeats a photo`).toBe(list.length);
  });
  it("the new picks are in place", () => {
    expect(script).toContain('"place-japan": ["photo-1759495051024-cbea2d646b61"]');
    expect(script).toMatch(/"place-kyoto": \["photo-1578469645742-46cae010e5d4"/);
    // dubai-5 (the 4th extra Dubai photo): the white high-rises by the water, with no fallback (the old photo was the duplicate)
    expect(script).toMatch(/"place-dubai": \["photo-1512453979798-5ea266f8880c", "photo-1518684079-3c830dcef090", "photo-1784125160488-09f633671243", "photo-1580674684081-7617fbf3d745"\]/);
    expect(script).not.toContain("photo-1546412414-e1885259563a");
    expect(script).toMatch(/"place-london": \["photo-1520986606214-8b456906c813"/);
  });
});

describe("Thanksgiving card art", () => {
  const base = { trips: [], billsDue: [], postcardsNew: 0, hasMonth: false } as unknown as Parameters<typeof homeHighlights>[0];
  const season = (id: string) => ({ id, eyebrow: "e", title: "t", text: "x", button: "b", href: "/" });
  it("Thanksgiving gets the harvest art, other festivals keep theirs", () => {
    const art = (id: string) => (homeHighlights({ ...base, season: season(id) }).find((h) => h.id === `season-${id}`) as { art: string } | undefined)?.art;
    expect(art("thanksgiving-2026")).toBe("harvest");
    expect(art("diwali-2026")).toBe("festive");
  });
});
