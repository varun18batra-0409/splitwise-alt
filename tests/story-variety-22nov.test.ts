import { describe, expect, it } from "vitest";
import { buildStories, type Frame, type Story } from "@/lib/home/stories";
import { STORY_POOLS } from "@/lib/home/story-lines";
import { TAG_LINES } from "@/lib/home/photo-tags";

// Founder, 22 Nov: "make sure messages on story are not repeated often, and if trips are to similar places like beach ensure no
// messages are same in the stories which are live."

const DAY = 86_400_000;
const start = new Date("2026-11-22T06:00:00Z").getTime();
const goaPhotos = ["/photos/place-goa.jpg", "/photos/place-goa-2.jpg", "/photos/place-goa-4.jpg", "/photos/place-goa-6.jpg"];
const gokarnaPhotos = ["/photos/place-gokarna.jpg", "/photos/place-gokarna-2.jpg"];
const beachPhotos = ["/photos/cover-beach.jpg", "/photos/cover-beach-2.jpg", "/photos/cover-beach-3.jpg", "/photos/cover-beach-4.jpg"];
const empty = { games: [], squared: [], collections: [], memories: [], wrapped: [] };

// Every sentence a person reads on a story's slides, apart from the trip's name and numbers.
function words(s: Story): string[] {
  const out: string[] = [];
  for (const f of s.frames as Frame[]) {
    if (f.kind === "photo" || f.kind === "art") out.push(f.head, f.line ?? "");
    if (f.kind === "poster" || f.kind === "list") out.push(f.line ?? "");
  }
  return out.filter((w) => w && !/^(Goa|Gokarna|Beach weekend)( ·|,| starts| in|$)/.test(w));
}

// The slides with written lines (not the first slide, which names the trip).
const captions = (s: Story) => (s.frames as Frame[]).slice(1).filter((f): f is Extract<Frame, { kind: "photo" }> => f.kind === "photo").map((f) => f.head);

describe("no line is in two lists, so two trips never borrow each other's words", () => {
  it("place, mood, photo, season, crew and country lines are all different", () => {
    const all: string[] = [];
    for (const list of Object.values(STORY_POOLS.PLACE)) all.push(...list.map(([, l]) => l));
    for (const list of Object.values(STORY_POOLS.MOOD)) all.push(...list.map(([, l]) => l));
    for (const list of Object.values(TAG_LINES)) all.push(...list.map(([, l]) => l));
    for (const f of Object.values(STORY_POOLS.FLAVOUR)) if (f.thing) all.push(f.thing);
    // Season and crew lines come from small builders: add each distinct one once.
    const extra = new Set<string>();
    for (const m of [0, 3, 6, 9]) for (const cc of ["IN", "AU", "GB"]) for (const [, l] of STORY_POOLS.seasonLines(m, cc)) extra.add(l);
    for (const n of [1, 2, 3, 6, 12]) for (const [, l] of STORY_POOLS.crewLines(n)) extra.add(l);
    all.push(...extra);
    const seen = new Map<string, number>();
    for (const l of all) seen.set(l, (seen.get(l) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([l]) => l);
    expect(dupes).toEqual([]);
  });
  it("beach places and beach photos have plenty of lines to take turns with", () => {
    expect(STORY_POOLS.PLACE.goa.length).toBeGreaterThanOrEqual(12);
    expect(STORY_POOLS.MOOD.beach.length).toBeGreaterThanOrEqual(10);
    for (const t of ["beach", "sea", "sunset", "palms", "island"]) expect(TAG_LINES[t].length).toBeGreaterThanOrEqual(6);
  });
});

describe("a Goa story changes day by day", () => {
  const goaOn = (d: number) =>
    buildStories({ now: new Date(start + d * DAY), trips: [{ id: "goa-trip-1", name: "Goa trip", phase: { kind: "before", days: 30 - d }, people: 5, photos: goaPhotos, crew: ["You", "Asha", "Ravi", "Meera", "Dev"], mood: "beach", month: 11 }], ...empty })[0];
  it("no slide line shows two days running", () => {
    for (let d = 0; d < 20; d++) {
      const today = new Set(captions(goaOn(d)));
      const tomorrow = captions(goaOn(d + 1));
      expect(tomorrow.filter((c) => today.has(c)), `day ${d} → ${d + 1}`).toEqual([]);
    }
  });
  it("over two weeks, no slide line shows more than 3 times, and most of Goa's own lines get a turn", () => {
    const count = new Map<string, number>();
    for (let d = 0; d < 14; d++) for (const c of captions(goaOn(d))) count.set(c, (count.get(c) ?? 0) + 1);
    expect(Math.max(...count.values())).toBeLessThanOrEqual(3);
    const goaShown = STORY_POOLS.PLACE.goa.filter(([, l]) => count.has(l)).length;
    expect(goaShown).toBeGreaterThanOrEqual(10);
  });
  it("one story never says the same line twice", () => {
    for (let d = 0; d < 20; d++) {
      const w = words(goaOn(d));
      expect(new Set(w).size, `day ${d}`).toBe(w.length);
    }
  });
});

describe("beach trips on the same Home never share a line", () => {
  const home = (d: number, phases: [Parameters<typeof buildStories>[0]["trips"][number]["phase"], Parameters<typeof buildStories>[0]["trips"][number]["phase"], Parameters<typeof buildStories>[0]["trips"][number]["phase"]]) =>
    buildStories({
      now: new Date(start + d * DAY),
      trips: [
        { id: "goa-trip-1", name: "Goa trip", phase: phases[0], people: 5, photos: goaPhotos, crew: ["You", "Asha", "Ravi"], mood: "beach", month: 11, today: { spent: "₹4,200", count: 3, top: "Asha", biggest: { what: "Dinner at the shack", amount: "₹2,000" } } },
        { id: "gokarna-2", name: "Gokarna", phase: phases[1], people: 3, photos: gokarnaPhotos, crew: ["You", "Kabir", "Riya"], mood: "beach", month: 11, today: { spent: "₹1,100", count: 2, top: "Kabir" } },
        { id: "beach-weekend-3", name: "Beach weekend", phase: phases[2], people: 3, photos: beachPhotos, crew: ["You", "Zoya", "Arjun"], mood: "beach", month: 11, today: { spent: "Nothing", count: 0 } },
      ],
      ...empty,
    }).filter((s) => s.kind === "trip");
  const cases: [string, Parameters<typeof home>[1]][] = [
    ["all a month away", [{ kind: "before", days: 20 }, { kind: "before", days: 22 }, { kind: "before", days: 25 }]],
    ["all this week", [{ kind: "before", days: 3 }, { kind: "before", days: 3 }, { kind: "before", days: 5 }]],
    ["all tomorrow", [{ kind: "before", days: 1 }, { kind: "before", days: 1 }, { kind: "before", days: 1 }]],
    ["all on the trip", [{ kind: "during", day: 2, of: 5 }, { kind: "during", day: 2, of: 4 }, { kind: "during", day: 3, of: 3 }]],
    ["mixed", [{ kind: "today" }, { kind: "before", days: 2 }, { kind: "during", day: 2, of: 3 }]],
  ];
  for (const [name, phases] of cases)
    it(`${name}: every day for two weeks`, () => {
      for (let d = 0; d < 14; d++) {
        const stories = home(d, phases);
        expect(stories).toHaveLength(3);
        const lists = stories.map(words);
        for (let a = 0; a < lists.length; a++)
          for (let b = a + 1; b < lists.length; b++) {
            const shared = lists[a].filter((w) => lists[b].includes(w));
            expect(shared, `${name}, day ${d}: ${stories[a].label} and ${stories[b].label}`).toEqual([]);
          }
        // The one-line summary on each circle differs too.
        const summaries = stories.map((s) => s.line.replace(/^Day \d+ of \d+\. /, ""));
        expect(new Set(summaries).size, `${name}, day ${d}: summaries`).toBe(summaries.length);
      }
    });
});
