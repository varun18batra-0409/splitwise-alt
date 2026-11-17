import { describe, expect, it } from "vitest";
import { COUNTRIES, countryOf, searchCountries, tripStops } from "@/lib/geo";
import { readFileSync } from "node:fs";
import { buildPassport, parseHandPlaces, passportZone, stampDay, stampPages, undatedFacts, undatedTripDay, wentOnTrip } from "@/lib/passport";
import { buildStories } from "@/lib/home/stories";
import { squareNumbers } from "@/lib/square";
import { funTitles, wrapSlides } from "@/lib/wrapped";
import { quickReactions, reactionSummary } from "@/lib/reactions";
import { memoryText, pulseText } from "@/lib/pulse";

describe("Trip passport: where a trip went", () => {
  it("from the trip's name, or what was typed in Where to?", () => {
    expect(tripStops("Goa trip")).toEqual([{ city: "Goa", country: "IN" }]);
    expect(tripStops("Bangkok & Phuket")).toEqual([{ city: "Bangkok", country: "TH" }, { city: "Phuket", country: "TH" }]);
    expect(tripStops("Thailand trip")).toEqual([{ city: "", country: "TH" }]);
    expect(tripStops("Office offsite", "Coorg")).toEqual([{ city: "Coorg", country: "IN" }]);
    expect(tripStops("Euro trip", "Zagreb, Split", "HR")).toEqual([{ city: "Zagreb", country: "HR" }, { city: "Split", country: "HR" }]);
    expect(tripStops("Weekend away")).toEqual([]);
    expect(countryOf("in")?.flag).toBe("🇮🇳");
  });
});

describe("Trip passport: stamps", () => {
  const trip = (groupId: string, name: string, start: string, place = "") => ({ groupId, name, start, end: "", place, country: "", people: 4 });
  const p = buildPassport(
    [trip("a", "Goa trip", "2024-03-01"), trip("b", "Goa again", "2025-01-01"), trip("c", "Goa 3", "2026-02-01"), trip("d", "Thailand", "2026-05-01", "Bangkok, Phuket"), trip("f", "Italy", "2026-06-01", "Rome"), trip("e", "Manali", "2027-05-01")],
    [{ c: "JP" }, { c: "IT" }],
    "IN",
    "2026-10-27",
  );
  it("every trip leaves its own stamp, oldest first; trips to come not yet", () => {
    expect(p.stamps.map((s) => [s.kind, s.name, s.when])).toEqual([
      ["city", "Goa", "2024-03-01"],
      ["city", "Goa", "2025-01-01"],
      ["city", "Goa", "2026-02-01"],
      ["country", "Thailand", "2026-05-01"],
      ["country", "Italy", "2026-06-01"],
    ]);
    expect(p.stamps[3].cities).toEqual(["Bangkok", "Phuket"]);
  });
  it("Been there stamps stay apart, even for a country a Loopin trip went to", () => {
    expect(p.been.map((s) => [s.code, s.byHand])).toEqual([["IT", true], ["JP", true]]);
    expect(p.stamps.some((s) => s.code === "IT" && !s.byHand)).toBe(true);
  });
  it("counts places once, not stamps", () => {
    expect(p.stats).toEqual({ cities: 4, countries: 4, abroad: 3, trips: 5, thisYear: 3, continents: 2 });
    expect(p.index.map((r) => [r.code, r.trips, r.byHand, r.cities.join("/")])).toEqual([
      ["IN", 3, false, "Goa"],
      ["IT", 1, true, "Rome"],
      ["JP", 0, true, ""],
      ["TH", 1, false, "Bangkok/Phuket"],
    ]);
    expect(p.milestones).toEqual(["First trip abroad", "3 countries abroad", "Goa ×3", "3 trips this year"]);
  });
  it("badges: earned ones, and how close the rest are", () => {
    const b = Object.fromEntries(p.badges.map((x) => [x.id, x.earned ? "✓" : `${x.have}/${x.need}`]));
    expect(b).toEqual({ "first-abroad": "✓", beach: "✓", hills: "0/3", city: "1/3", cities: "4/10", countries: "4/10", frequent: "2/5", year: "✓", trips: "5/10" });
  });
  it("pages of six: one passport, trip stamps first, then Been there, no separate section", () => {
    const pages = stampPages(p.stamps, p.been, 2);
    expect(pages.map((x) => [x.title, x.stamps.length])).toEqual([["Stamps", 2], ["Stamps", 2], ["Stamps", 2], ["Stamps", 1]]);
    expect(pages.flatMap((x) => x.stamps).slice(-2).every((s) => s.byHand)).toBe(true);
  });
  it("Places I've been are countries only (old cities dropped, no repeats)", () => {
    expect(parseHandPlaces('[{"c":"th","city":" Krabi "},{"c":"TH"},{"c":"XX"},"junk"]')).toEqual([{ c: "TH" }]);
    expect(parseHandPlaces("nope")).toEqual([]);
  });
  it("every country is there, A to Z, and can be searched", () => {
    expect(COUNTRIES.length).toBeGreaterThan(230);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(COUNTRIES.map((c) => c.name)).toEqual([...COUNTRIES.map((c) => c.name)].sort((a, b) => a.localeCompare(b, "en")));
    expect(searchCountries("uae").map((c) => c.code)).toEqual(["AE"]);
    expect(searchCountries("cro").map((c) => c.code)).toEqual(["HR"]);
    expect(searchCountries("new z").map((c) => c.code)).toEqual(["NZ"]);
    expect(searchCountries("saint lu").map((c) => c.code)).toEqual(["LC"]);
    expect(searchCountries("turkiye").map((c) => c.code)).toEqual(["TR"]);
    expect(searchCountries("").length).toBe(COUNTRIES.length);
  });
});

describe("Stories on Home", () => {
  const now = new Date("2026-10-27T10:00:00Z");
  it("a trip coming up, last night's game, a year ago and a collection filling up (its circle is back, founder 15 Nov); old games and far trips left out", () => {
    const s = buildStories({
      now,
      trips: [
        { id: "g1", name: "Goa trip", phase: { kind: "before", days: 3 }, people: 5 },
        { id: "g2", name: "Ladakh trip", phase: { kind: "before", days: 90 }, people: 4 },
      ],
      games: [
        { id: "p1", groupId: "pg", name: "Diwali night", winner: "Asha", won: "₹600", finishedAt: new Date("2026-10-26T20:00:00Z") },
        { id: "p2", groupId: "pg", name: "Old night", winner: "Ravi", won: "₹100", finishedAt: new Date("2026-10-10T20:00:00Z") },
      ],
      squared: [],
      collections: [{ id: "c1", code: "abc", title: "Farewell", paid: 2, people: 5 }],
      memories: [{ id: "g9", name: "Manali trip", years: 1, people: 6, days: 4 }],
      wrapped: [],
    });
    expect(s.map((x) => x.id)).toEqual(["trip-g1-b3", "pot-p1", "memory-g9-1", "collect-c1-2-0"]);
    expect(s[0]).toMatchObject({ headline: "Goa in 3 days", line: "5 of you, 3 sleeps to go", href: "/groups/g1" });
    expect(s.find((x) => x.kind === "pot")?.headline).toBe("Asha came out ahead by ₹600");
    expect(s.find((x) => x.kind === "memory")?.headline).toBe("A year ago: Manali");
  });
  it("each story is several slides: photos of the place, the countdown, the crew; a game's table and who pays whom", () => {
    const s = buildStories({
      now,
      trips: [{ id: "g1", name: "Goa trip", phase: { kind: "before", days: 3 }, people: 3, photos: ["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg"], crew: ["You", "Asha", "Ravi"], mood: "beach" }],
      games: [
        {
          id: "p1", groupId: "pg", name: "Diwali night", winner: "Asha", won: "₹600", finishedAt: new Date("2026-10-26T20:00:00Z"), photos: ["/cards.jpg"],
          table: [{ name: "Asha", net: "+₹600", up: true, even: false, share: 1 }, { name: "Ravi", net: "−₹600", up: false, even: false, share: 1 }],
          pays: ["Ravi → Asha  ₹600"], toSettle: "₹600",
        },
      ],
      squared: [], collections: [], memories: [], wrapped: [],
    });
    const trip = s.find((x) => x.kind === "trip")!;
    expect(trip.frames.length).toBeGreaterThanOrEqual(5);
    expect(trip.frames.filter((f) => f.kind === "photo").map((f) => (f.kind === "photo" ? f.photo : ""))).toEqual(["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg"]);
    expect(trip.frames.some((f) => f.kind === "poster" && f.big === "3")).toBe(true);
    expect(trip.frames.some((f) => f.kind === "list" && f.kicker === "The crew")).toBe(true);
    const pot = s.find((x) => x.kind === "pot")!;
    // Game nights get designed artwork (felt, gold, the cards), never a stock photo.
    expect(pot.photo).toBeUndefined();
    expect(pot.art).toBe("pot");
    expect(pot.frames.map((f) => (f.kind === "art" ? `art:${f.art}` : f.kicker))).toEqual(["art:pot", "The table", "Who pays whom", "Still to settle", "art:pot"]);
    expect(pot.frames.some((f) => f.kind === "photo")).toBe(false);
    // No photos at all: still a proper story (posters), never empty.
    const bare = buildStories({ now, trips: [{ id: "g2", name: "Weekend away", phase: { kind: "before", days: 5 }, people: 2 }], games: [], squared: [], collections: [], memories: [], wrapped: [] });
    expect(bare[0].frames.length).toBeGreaterThan(0);
    expect(bare[0].frames.every((f) => f.kind !== "photo")).toBe(true);
  });
});

describe("All square numbers", () => {
  it("spent together, how many, how long", () => {
    const d = (s: string) => new Date(s);
    expect(
      squareNumbers({ expenses: [{ amount: 300000, createdAt: d("2026-10-01") }, { amount: 100000, kind: "pot", createdAt: d("2026-10-03") }], payments: [1, 2], people: 4, tripStart: "2026-10-01", tripEnd: "2026-10-04" }),
    ).toEqual({ spent: 300000, expenses: 2, payments: 2, people: 4, days: 4, each: 75000 });
  });
});

describe("Trip Wrapped and fun titles", () => {
  const at = (h: number, day = 12) => new Date(Date.UTC(2026, 9, day, h - 6, 30)); // IST h:00
  const e = (description: string, amount: number, paidById: string, category: string, created: Date, createdById = paidById) => ({ description, amount, paidById, category, createdAt: created, spentAt: created, createdById });
  const expenses = [
    e("Villa", 1800000, "a", "accommodation", at(11, 10)),
    e("Dinner", 480000, "b", "food", at(23, 10)),
    e("Snacks", 60000, "b", "food", at(16, 11)),
    e("Cab", 150000, "c", "transport", at(9, 11)),
    e("Cab back", 120000, "c", "transport", at(18, 12)),
    e("Late pizza", 90000, "b", "food", at(23, 12)),
  ];
  it("titles: one each, about habits", () => {
    const t = funTitles(expenses, ["a", "b", "c"], "Asia/Kolkata", "INR");
    expect(t.map((x) => [x.memberId, x.title])).toEqual([["a", "The Banker"], ["b", "Snack Lord"], ["c", "The Driver"]]);
    expect(funTitles(expenses.slice(0, 3), ["a", "b", "c"], "Asia/Kolkata", "INR")).toEqual([]); // too few to judge
  });
  it("titles: everyone gets one, never about who paid less", () => {
    const t = funTitles(expenses, ["a", "b", "c", "d", "e"], "Asia/Kolkata", "INR");
    expect(t.map((x) => [x.memberId, x.title])).toEqual([["a", "The Banker"], ["b", "Snack Lord"], ["c", "The Driver"], ["d", "Smooth Operator"], ["e", "Chief Vibe Officer"]]);
    expect(t.every((x) => !/had it covered|paid nothing|didn.t pay/i.test(x.why))).toBe(true);
    // A big group: still one each, and no title twice.
    const many = funTitles(expenses, ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], "Asia/Kolkata", "INR");
    expect(many).toHaveLength(10);
    expect(new Set(many.map((x) => x.title)).size).toBe(10);
    // A tie goes to whoever got there first.
    const tie = [e("Lunch", 1000, "x", "food", at(12, 10)), e("Tea", 1000, "y", "food", at(16, 10)), e("Dinner", 1000, "y", "food", at(20, 10)), e("Snack", 1000, "x", "food", at(21, 10))];
    expect(funTitles(tie, ["x", "y"], "Asia/Kolkata", "INR").map((x) => [x.memberId, x.title])).toEqual([["y", "The Banker"], ["x", "Snack Lord"]]);
  });
  it("slides: total, top category, the big day, the splurge, awards, and how it ends", () => {
    const { slides, total } = wrapSlides({ name: "Goa trip", currency: "INR", tz: "Asia/Kolkata", people: [{ id: "a", name: "Asha" }, { id: "b", name: "Ravi" }, { id: "c", name: "Dev" }], expenses, tripStart: "2026-10-10", tripEnd: "2026-10-12", stillToSettle: 0, myId: "a" });
    expect(total).toBe(2700000);
    expect(slides.map((s) => s.kind)).toEqual(["intro", "total", "category", "day", "splurge", "awards", "outro"]);
    expect(slides[0].line).toBe("3 days, 3 of you, 6 expenses");
    expect(slides[1].headline).toBe("₹27,000 spent together");
    expect(slides[2].headline).toBe("Beds & Bunks took 67%");
    expect(slides[3].headline).toBe("Saturday 10 Oct was the big one");
    expect(slides[4]).toMatchObject({ headline: "The splurge: Villa", line: "₹18,000, paid by You" });
    expect(slides[6].headline).toBe("All square");
  });
});

describe("Reactions", () => {
  it("counts in a fixed order, and which one is mine", () => {
    expect(reactionSummary([{ emoji: "🔥", memberId: "a" }, { emoji: "😂", memberId: "b" }, { emoji: "🔥", memberId: "c" }], "c")).toEqual({
      counts: [{ emoji: "🔥", count: 2 }, { emoji: "😂", count: 1 }],
      mine: "🔥",
    });
    // More behind "+", and the group's favourites come first in the quick row.
    expect(quickReactions([{ emoji: "🍻" }, { emoji: "🍻" }, { emoji: "🔥" }, { emoji: "nope" }])).toEqual(["🍻", "🔥", "😂", "😭", "🙄", "😍"]);
    expect(quickReactions([])).toEqual(["😂", "🔥", "😭", "🙄", "😍", "👏"]);
    expect(reactionSummary([], "a")).toEqual({ counts: [], mine: "" });
  });
});

describe("Day-end pulse and memory lane", () => {
  it("one playful line for the day", () => {
    expect(pulseText({ place: "Goa", day: 2, of: 4, spent: 620000, currency: "INR", count: 5, topPayer: "Ravi", topShare: 0.7 })).toBe("Day 2 in Goa: ₹6,200 gone, Ravi’s carrying the team 😅");
    expect(pulseText({ place: "Goa", day: 1, of: 1, spent: 50000, currency: "INR", count: 1, topShare: 1, topPayer: "Asha" })).toBe("Goa today: ₹500 gone, one expense. Restrained 🧘");
    expect(pulseText({ place: "Goa", day: 3, of: 4, spent: 900000, currency: "INR", count: 9, topShare: 0.3 })).toBe("Day 3 in Goa: ₹9,000 gone, 9 expenses. Busy day 🔥");
  });
  it("a year ago today", () => {
    expect(memoryText({ place: "Manali", years: 1, people: 6, days: 4 })).toBe("A year ago today: Manali, 6 of you, 4 days 🌴 Tap to relive it");
    expect(memoryText({ place: "Goa", years: 2, people: 3, days: 1 })).toBe("2 years ago today: Goa, 3 of you 🌴 Tap to relive it");
  });
});

import { visibleBadges, type Badge } from "@/lib/passport";
describe("R1 item 13: badges show only earned ones plus the next one", () => {
  const b = (id: string, have: number, need: number): Badge => ({ id, emoji: "", title: id, why: "", earned: have >= need, have: Math.min(have, need), need });
  it("one earned (1 of 1), the closest unearned is 2 of 3, the 0 of 3 wall is hidden", () => {
    const list = [b("a", 1, 1), b("b", 0, 3), b("c", 2, 3), b("d", 0, 5)];
    expect(visibleBadges(list).map((x) => x.id)).toEqual(["a", "c"]);
  });
  it("nothing earned: just the next one (ties go to the first in the list)", () => {
    expect(visibleBadges([b("a", 0, 3), b("b", 0, 3)]).map((x) => x.id)).toEqual(["a"]);
  });
  it("everything earned: all of them, no extra", () => {
    expect(visibleBadges([b("a", 1, 1), b("b", 3, 3)]).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

// Someone who left a trip's group before its first day didn't go on it: no stamp, on Home or in the passport (one rule, passport.ts).
describe("who went on a trip, and which day its stamp is", () => {
  it("wentOnTrip: only leaving BEFORE the start day means they didn't go (start 2026-03-10)", () => {
    expect(wentOnTrip("2026-03-10", null, "UTC")).toBe(true);
    expect(wentOnTrip("2026-03-10", new Date("2026-03-09T23:59:59Z"), "UTC")).toBe(false);
    expect(wentOnTrip("2026-03-10", new Date("2026-03-10T00:00:00Z"), "UTC")).toBe(true);
    expect(wentOnTrip("2026-03-10", new Date("2026-03-20T12:00:00Z"), "UTC")).toBe(true);
    expect(wentOnTrip("", new Date("2026-03-01T12:00:00Z"), "UTC")).toBe(true);
  });
  it("wentOnTrip reads the day they left in their own time zone (hand-worked: India is UTC+5:30)", () => {
    // 20:30 UTC on 9 March is 02:00 on 10 March in India: that is the start day, so they went.
    expect(wentOnTrip("2026-03-10", new Date("2026-03-09T20:30:00Z"), "Asia/Kolkata")).toBe(true);
    // 18:29:59 UTC is 23:59:59 on 9 March in India: the day before, so they didn't.
    expect(wentOnTrip("2026-03-10", new Date("2026-03-09T18:29:59Z"), "Asia/Kolkata")).toBe(false);
    // Midday UTC on 9 March is still 9 March in every zone from UTC-12 to UTC+11 (zones at +12 and beyond are already on the 10th).
    for (const tz of ["UTC", "Asia/Kolkata", "America/New_York", "Europe/London", "Asia/Tokyo", "Australia/Sydney"]) {
      expect(wentOnTrip("2026-03-10", new Date("2026-03-09T12:00:00Z"), tz)).toBe(false);
    }
  });
  it("passportZone: the owner's own zone, the default when it is empty or not a real zone", () => {
    expect(passportZone({ timeZone: "Europe/London" })).toBe("Europe/London");
    expect(passportZone({ timeZone: "" })).toBe("Asia/Kolkata");
    expect(passportZone({ timeZone: "Not/AZone" })).toBe("Asia/Kolkata");
    expect(passportZone(null)).toBe("Asia/Kolkata");
  });

  const trip = { type: "trip", deletedAt: null as Date | null, tripStart: "2026-10-01", leftAt: null as Date | null, undated: null as { count: number; day: string } | null };
  it("stampDay (today 2026-11-15): dated trips are stamped on their start day", () => {
    expect(stampDay(trip, "2026-11-15", "UTC")).toBe("2026-10-01");
    expect(stampDay({ ...trip, tripStart: "2026-12-01" }, "2026-11-15", "UTC")).toBeNull(); // not started yet
    expect(stampDay({ ...trip, leftAt: new Date("2026-09-30T10:00:00Z") }, "2026-11-15", "UTC")).toBeNull(); // left the day before it began
    expect(stampDay({ ...trip, leftAt: new Date("2026-10-01T10:00:00Z") }, "2026-11-15", "UTC")).toBe("2026-10-01");
  });
  it("stampDay: a trip without dates is stamped on the day of its latest spending the person may see, once there is some", () => {
    const undated = { ...trip, tripStart: "", undated: { count: 3, day: "2026-10-05" } };
    // No real start day, so leaving earlier than the spending doesn't lose the stamp.
    expect(stampDay({ ...undated, leftAt: new Date("2026-10-01T12:00:00Z") }, "2026-11-15", "UTC")).toBe("2026-10-05");
    expect(stampDay({ ...undated, leftAt: new Date("2026-10-06T12:00:00Z") }, "2026-11-15", "UTC")).toBe("2026-10-05");
    expect(stampDay({ ...undated, undated: null }, "2026-11-15", "UTC")).toBeNull();
    expect(stampDay({ ...undated, undated: { count: 0, day: "2026-10-05" } }, "2026-11-15", "UTC")).toBeNull();
  });

  // Undated trips: what a person may see decides the stamp (hand-worked). Ada left 5 Oct 2024 12:00 UTC.
  //   Lunch: added 1 Oct 08:00 UTC, dated 1 Oct, paid by Ada, Ada + Bea in it.   Taxi: added 8 Oct 09:00 UTC, dated 8 Oct, only Bea.
  describe("undatedFacts", () => {
    const at = (iso: string) => new Date(iso);
    const row = (o: Partial<Parameters<typeof undatedFacts>[0][number]> & { id: string; createdAt: Date; paidById: string; shares: { memberId: string }[] }) => ({ spentAt: null as Date | null, deletedAt: null as Date | null, kind: "expense", ...o });
    const lunch = row({ id: "lunch", createdAt: at("2024-10-01T08:00:00Z"), spentAt: at("2024-10-01T12:00:00Z"), paidById: "ada", shares: [{ memberId: "ada" }, { memberId: "bea" }] });
    const taxi = row({ id: "taxi", createdAt: at("2024-10-08T09:00:00Z"), spentAt: at("2024-10-08T12:00:00Z"), paidById: "bea", shares: [{ memberId: "bea" }] });
    const ada = { id: "ada", leftAt: at("2024-10-05T12:00:00Z") };
    const bea = { id: "bea", leftAt: null };
    it("Ada sees only Lunch; Bea sees both and the latest is Taxi", () => {
      expect(undatedFacts([lunch, taxi], ada, "Asia/Kolkata")).toEqual({ count: 1, day: "2024-10-01" });
      expect(undatedFacts([lunch, taxi], bea, "Asia/Kolkata")).toEqual({ count: 2, day: "2024-10-08" });
    });
    it("only Taxi exists: nothing Ada may see, so no stamp", () => {
      expect(undatedFacts([taxi], ada, "Asia/Kolkata")).toBeNull();
    });
    it("a card-game result and a deleted expense don't count", () => {
      expect(undatedFacts([row({ ...taxi, id: "pot", kind: "pot" })], bea, "UTC")).toBeNull();
      expect(undatedFacts([row({ ...taxi, id: "gone", deletedAt: at("2024-10-09T00:00:00Z") })], bea, "UTC")).toBeNull();
    });
    it("spending added after she left but with her in it counts", () => {
      const dinner = row({ id: "dinner", createdAt: at("2024-10-09T10:00:00Z"), paidById: "bea", shares: [{ memberId: "bea" }, { memberId: "ada" }] });
      expect(undatedFacts([lunch, taxi, dinner], ada, "Asia/Kolkata")).toEqual({ count: 2, day: "2024-10-09" });
    });
    it("no chosen date: the day it was added, in the owner's time zone (1 Oct 20:00 UTC is 2 Oct in India, 1 Oct in London)", () => {
      const late = row({ id: "late", createdAt: at("2024-10-01T20:00:00Z"), paidById: "bea", shares: [{ memberId: "bea" }] });
      expect(undatedFacts([late], bea, "Asia/Kolkata")?.day).toBe("2024-10-02");
      expect(undatedFacts([late], bea, "Europe/London")?.day).toBe("2024-10-01");
      expect(undatedTripDay({ spentAt: null, createdAt: at("2024-10-01T20:00:00Z") }, "Asia/Kolkata")).toBe("2024-10-02");
      // A chosen day is that day for everyone.
      expect(undatedTripDay({ spentAt: at("2024-10-01T12:00:00Z"), createdAt: at("2024-10-03T00:00:00Z") }, "Pacific/Auckland")).toBe("2024-10-01");
    });
  });
  it("stampDay: a deleted group or one that is not a trip has none", () => {
    expect(stampDay({ ...trip, deletedAt: new Date("2026-11-01T00:00:00Z") }, "2026-11-15", "UTC")).toBeNull();
    expect(stampDay({ ...trip, type: "home" }, "2026-11-15", "UTC")).toBeNull();
  });
  it("Home has no copy of the stamp rule: its passport card (back on 16 Nov, founder's choice) uses stampDay from src/lib/passport.ts", () => {
    const src = readFileSync("src/app/(home)/page.tsx", "utf8");
    expect(src).not.toContain("const wentOn");
    expect(src).toMatch(/import \{[^}]*\bstampDay\b[^}]*\} from "@\/lib\/passport"/);
  });
});
