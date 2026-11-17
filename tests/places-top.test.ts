import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placeSlot } from "@/lib/places";
import { tripStops } from "@/lib/geo";

// "Top destinations": hand-picked photos for about 75 well-known places, found from a trip's name.
const SAMPLES: [string, string][] = [
  ["San Francisco long weekend", "place-san-francisco"], ["LA: Los Angeles road trip", "place-los-angeles"], ["Vegas weekend", "place-las-vegas"],
  ["Las Vegas 2027", "place-las-vegas"], ["Miami Beach", "place-miami"], ["Chicago food tour", "place-chicago"], ["Washington DC cherry blossom", "place-washington-dc"],
  ["Washington, D.C.", "place-washington-dc"], ["Boston in fall", "place-boston"], ["Seattle", "place-seattle"], ["Grand Canyon rafting", "place-grand-canyon"],
  ["Yellowstone", "place-yellowstone"], ["Yosemite camping", "place-yosemite"], ["Moab & Arches National Park", "place-moab-arches"],
  ["Maui honeymoon", "place-maui"], ["Hawaii 2027", "place-honolulu-oahu"], ["Waikiki", "place-honolulu-oahu"], ["Oahu", "place-honolulu-oahu"],
  ["Maui, Hawaii", "place-maui"], ["New Orleans", "place-new-orleans"], ["NOLA weekend", "place-new-orleans"], ["Nashville bachelorette", "place-nashville"],
  ["Charleston", "place-charleston"], ["San Diego", "place-san-diego"], ["Orlando", "place-orlando"], ["Austin trip", "place-austin"],
  ["Zion", "place-zion"], ["Alaska cruise", "place-alaska"], ["Napa Valley wine", "place-napa"], ["Napa", "place-napa"], ["Lake Tahoe ski", "place-lake-tahoe"],
  ["Aspen", "place-aspen"], ["Philadelphia", "place-philadelphia"], ["Savannah", "place-savannah"], ["Sedona", "place-sedona"], ["Portland weekend", "place-portland"],
  ["Atlanta", "place-atlanta"], ["Houston", "place-houston"], ["Dallas", "place-dallas"], ["Phoenix", "place-phoenix"], ["Niagara Falls", "place-niagara"], ["Big Sur drive", "place-big-sur"],
  ["NYC 2027", "place-newyork"], ["Rome", "place-rome"], ["Venice", "place-venice"], ["Florence", "place-florence"], ["Amalfi coast", "place-amalfi"],
  ["Barcelona", "place-barcelona"], ["Madrid", "place-madrid"], ["Lisbon & Porto", "place-lisbon"], ["Porto", "place-porto"], ["Athens", "place-athens"],
  ["Dubrovnik", "place-dubrovnik"], ["Istanbul", "place-istanbul"], ["Cappadocia balloons", "place-cappadocia"], ["Amsterdam", "place-amsterdam"], ["Prague", "place-prague"],
  ["Vienna", "place-vienna"], ["Budapest", "place-budapest"], ["Berlin", "place-berlin"], ["Munich", "place-munich"], ["Edinburgh", "place-edinburgh"],
  ["Iceland ring road", "place-iceland"], ["Reykjavik", "place-iceland"], ["Copenhagen", "place-copenhagen"], ["Stockholm", "place-stockholm"], ["Norway fjords", "place-norway-fjords"],
  ["Abu Dhabi", "place-abu-dhabi"], ["Doha layover", "place-doha"], ["Cairo & Giza", "place-cairo-giza"], ["Marrakech", "place-marrakech"], ["Cape Town", "place-cape-town"],
  ["Seoul", "place-seoul"], ["Hong Kong", "place-hong-kong"], ["Kuala Lumpur", "place-kuala-lumpur"], ["Sydney NYE", "place-sydney"], ["Melbourne", "place-melbourne"],
  ["Queenstown", "place-queenstown"], ["Toronto", "place-toronto"], ["Vancouver", "place-vancouver"], ["Banff", "place-banff"], ["Mexico City", "place-mexico-city"],
  ["Cancun", "place-cancun-tulum"], ["Tulum", "place-cancun-tulum"], ["Rio de Janeiro", "place-rio"], ["Rio carnival", "place-rio"], ["Machu Picchu trek", "place-machu-picchu"],
];

describe("Top destinations: a trip's name finds its photo", () => {
  it.each(SAMPLES)("%s", (name, slot) => expect(placeSlot(name)).toBe(slot));

  it("doesn't match look-alike words", () => {
    expect(placeSlot("Salary")).toBeNull();
    expect(placeSlot("Rioja wine")).toBeNull();
    expect(placeSlot("LA LA land")).toBeNull();
    expect(placeSlot("Dallas's birthday")).toBeNull();
    expect(placeSlot("Austin's 30th")).toBeNull();
    expect(placeSlot("Portugal")).toBeNull(); // the Portugal country photo is used instead
    expect(placeSlot("Washington")).toBeNull();
    expect(placeSlot("DC comics night")).toBeNull();
    expect(placeSlot("Portland")).toBe("place-portland");
    expect(placeSlot("Porto")).toBe("place-porto"); // not Portland / Port Blair
    expect(placeSlot("Port Blair")).toBe("place-andaman");
  });

  it("keeps the older places as they were", () => {
    expect(placeSlot("Goa trip")).toBe("place-goa");
    expect(placeSlot("Bali")).toBe("place-bali");
    expect(placeSlot("Paris honeymoon")).toBe("cover-paris");
    expect(placeSlot("Tokyo")).toBe("place-japan");
    expect(placeSlot("Osaka")).toBe("place-japan"); // skipped: no new photo
    expect(placeSlot("Dubai")).toBe("place-dubai");
    expect(placeSlot("London")).toBe("place-london");
    expect(placeSlot("Santorini")).toBe("place-santorini");
    expect(placeSlot("Goa and Las Vegas")).toBe("place-goa");
  });

  it("every new place has a slot in the photo downloader, and no photo is used twice", () => {
    const text = readFileSync("scripts/fetch-photos.mjs", "utf8");
    const slots = new Set(SAMPLES.map(([, s]) => s).filter((s) => s !== "place-newyork"));
    const seen = new Map<string, string>();
    for (const m of text.matchAll(/^\s*"(place-[a-z-]+)": \[((?:"[^"]+",? ?)+)\]/gm)) {
      for (const id of m[2].match(/photo-[0-9a-z-]+/g) ?? []) {
        const other = seen.get(id);
        expect(other === undefined || other === m[1], `${id} in ${m[1]} and ${other}`).toBe(true);
        seen.set(id, m[1]);
      }
    }
    for (const s of slots) expect(text.includes(`"${s}": ["photo-`), s).toBe(true);
    expect(text).toMatch(/"place-newyork": \["photo-1765187275519-547fb2d0bb6a", "photo-1764344793554-12da6166d940"\]/);
  });
});

describe("Top destinations: the passport gets the right country", () => {
  it.each([
    ["Lisbon & Porto", "PT"], ["Seoul", "KR"], ["Sydney", "AU"], ["Toronto", "CA"], ["Chicago", "US"], ["Vegas weekend", "US"], ["Cape Town", "ZA"],
    ["Marrakech", "MA"], ["Doha", "QA"], ["Abu Dhabi", "AE"], ["Cairo", "EG"], ["Machu Picchu trek", "PE"], ["Rio de Janeiro", "BR"], ["Mexico City", "MX"],
    ["Tulum", "MX"], ["Iceland", "IS"], ["Reykjavik", "IS"], ["Edinburgh", "GB"], ["Dubrovnik", "HR"], ["Budapest", "HU"], ["Copenhagen", "DK"],
    ["Stockholm", "SE"], ["Norway fjords", "NO"], ["Cappadocia", "TR"], ["Hong Kong", "HK"], ["Kuala Lumpur", "MY"], ["Queenstown", "NZ"], ["Banff", "CA"],
    ["Vancouver", "CA"], ["Melbourne", "AU"], ["Waikiki", "US"], ["Napa", "US"], ["Washington DC", "US"],
  ])("%s", (name, code) => expect(tripStops(name)[0].country).toBe(code));

  it("keeps the old stops", () => {
    expect(tripStops("Goa trip")).toEqual([{ city: "Goa", country: "IN" }]);
    expect(tripStops("Lisbon & Porto")).toEqual([{ city: "", country: "PT" }]);
    expect(tripStops("Mexico City")).toEqual([{ city: "Mexico City", country: "MX" }]);
    expect(tripStops("Oahu")).toEqual([{ city: "Hawaii", country: "US" }]);
  });
});
