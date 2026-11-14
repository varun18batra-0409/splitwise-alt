import { describe, expect, it } from "vitest";
import { buildPassport, type PassportTrip, type Stamp } from "@/lib/passport";
import { beenCards, beenStats, shownCards, titleFit, tripDates } from "@/lib/passport-cards";

const TODAY = "2026-11-13";
const trip = (groupId: string, name: string, start: string, end: string, people: number, place = "", country = ""): PassportTrip => ({ groupId, name, start, end, place, country, people });
const build = (trips: PassportTrip[], hand: { c: string }[] = []) => {
  const p = buildPassport(trips, hand, "IN", TODAY);
  return { trips, stamps: p.stamps, been: p.been, stats: p.stats };
};

describe("Been cards: the founder's picture", () => {
  // Thailand 5–10 May 2026 (6 days) and Goa 13–15 Mar 2026 (3 days): 2 countries, 2 trips, 9 days away.
  const p = build([trip("goa", "Goa trip", "2026-03-13", "2026-03-15", 4), trip("thai", "Thailand", "2026-05-05", "2026-05-10", 6, "Bangkok, Phuket", "TH")]);
  const { stats, cards } = beenCards(p, { thai: { names: ["Nupur", "Riya", "Dev", "Extra"] } }, TODAY);

  it("the numbers row says 2 countries, 2 trips, 9 days away", () => {
    expect(stats).toEqual([
      { n: 2, label: "countries" },
      { n: 2, label: "trips" },
      { n: 9, label: "days away" },
    ]);
  });
  it("the newest trip comes first, with its place, cities, dates and days", () => {
    expect(cards.map((c) => c.id)).toEqual(["thai", "goa"]);
    expect(cards[0]).toMatchObject({ kind: "trip", title: "Thailand", cities: ["Bangkok", "Phuket"], dates: "5–10 May 2026", days: 6 });
    expect(cards[1]).toMatchObject({ kind: "trip", title: "Goa", dates: "13–15 Mar 2026", days: 3 });
  });
  it("the faces are the first letters of up to 3 others, and the words count everyone", () => {
    expect(cards[0].initials).toEqual(["N", "R", "D"]);
    expect(cards[0].peopleLabel).toBe("6 people, one good trip");
    expect(cards[1].friendsLabel).toBe("With 3 friends"); // 4 people: 3 friends
  });
  it("Relive this trip points at that trip's own group", () => {
    expect(cards[0].reliveHref).toBe("/groups/thai/report");
    expect(cards[1].reliveHref).toBe("/groups/goa/report");
  });
  it("the stamp on the photo is the country and the month of the trip", () => {
    expect(cards[0].stamp).toMatchObject({ kind: "country", name: "Thailand", when: "2026-05-05", byHand: false });
    // A trip in the home country gets its city's stamp (GOA), as "Trips here get city stamps" says.
    expect(cards[1].stamp).toMatchObject({ kind: "city", name: "Goa", when: "2026-03-13", byHand: false });
  });
  it("see our moments appears only when there are moments you can see", () => {
    expect(cards[0].momentsHref).toBeUndefined();
    const withMoments = beenCards(p, { thai: { names: [], moments: 3 } }, TODAY).cards;
    expect(withMoments[0].momentsHref).toBe("/groups/thai/moments");
    expect(withMoments[1].momentsHref).toBeUndefined();
  });
});

describe("Been cards: countries added by hand", () => {
  const p = build([trip("goa", "Goa trip", "2026-03-13", "2026-03-15", 4)], [{ c: "JP" }, { c: "FR" }]);
  const { stats, cards } = beenCards(p, {}, TODAY);
  it("come after the trips, by name, with no dates, no days, no Relive and no moments link", () => {
    expect(cards.map((c) => [c.kind, c.title])).toEqual([["trip", "Goa"], ["hand", "France"], ["hand", "Japan"]]);
    for (const c of cards.filter((x) => x.kind === "hand")) {
      expect(c.dates).toBe("");
      expect(c.days).toBe(0);
      expect(c.reliveHref).toBeUndefined();
      expect(c.momentsHref).toBeUndefined();
      expect(c.stamp.byHand).toBe(true);
    }
  });
  it("count as countries (India, France, Japan = 3), but add no trip or day", () => {
    expect(stats).toEqual([
      { n: 3, label: "countries" },
      { n: 1, label: "trip" },
      { n: 3, label: "days away" },
    ]);
  });
});

describe("Been cards: zero numbers are hidden", () => {
  it("nothing yet: no numbers at all", () => expect(beenStats(0, 0, 0)).toEqual([]));
  it("only countries from before Loopin: just the countries", () => expect(beenStats(4, 0, 0)).toEqual([{ n: 4, label: "countries" }]));
  it("singular words for 1", () => expect(beenStats(1, 1, 1)).toEqual([{ n: 1, label: "country" }, { n: 1, label: "trip" }, { n: 1, label: "day away" }]));
  it("a trip still to come has no card and adds nothing", () => {
    const p = build([trip("later", "Goa trip", "2026-12-20", "2026-12-25", 3)]);
    const r = beenCards(p, {}, TODAY);
    expect(r.cards).toEqual([]);
    expect(r.stats).toEqual([]);
  });
  it("a trip without dates shows no dates and no days", () => {
    const p = build([{ ...trip("u", "Goa trip", "2026-05-05", "", 2), undated: true }]);
    const [c] = beenCards(p, {}, TODAY).cards;
    expect(c).toMatchObject({ dates: "", days: 0 });
  });
});

describe("Been cards: long names arrive whole (the layout is checked in screenshots)", () => {
  const stamp = (over: Partial<Stamp>): Stamp => ({ id: "x", kind: "country", code: "IN", name: "India", flag: "", when: "2026-05-05", cities: [], groupId: "g", byHand: false, ...over });
  it("a country with a long name", () => {
    const p = { trips: [trip("g", "Balkans", "2026-05-05", "2026-05-10", 3)], stamps: [stamp({ code: "BA", name: "Bosnia and Herzegovina", cities: ["Sarajevo", "Mostar"] })], been: [], stats: { countries: 1, trips: 1 } };
    const [c] = beenCards(p, {}, TODAY).cards;
    expect(c.title).toBe("Bosnia and Herzegovina");
    expect(c.cities).toEqual(["Sarajevo", "Mostar"]);
  });
  it("two long city stops at home are joined, not cut", () => {
    const p = {
      trips: [trip("g", "South", "2026-05-05", "2026-05-10", 3)],
      stamps: [stamp({ id: "a", kind: "city", name: "Thiruvananthapuram" }), stamp({ id: "b", kind: "city", name: "Kanyakumari" })],
      been: [],
      stats: { countries: 1, trips: 1 },
    };
    expect(beenCards(p, {}, TODAY).cards[0].title).toBe("Thiruvananthapuram · Kanyakumari");
  });
});

describe("dates, written by hand", () => {
  it("same month", () => expect(tripDates("2026-05-05", "2026-05-10")).toBe("5–10 May 2026"));
  it("across months", () => expect(tripDates("2026-02-28", "2026-03-01")).toBe("28 Feb – 1 Mar 2026"));
  it("across years", () => expect(tripDates("2026-12-30", "2027-01-02")).toBe("30 Dec 2026 – 2 Jan 2027"));
  it("one day, or no end date", () => {
    expect(tripDates("2026-05-05", "")).toBe("5 May 2026");
    expect(tripDates("2026-05-05", "2026-05-05")).toBe("5 May 2026");
  });
  it("no start, nothing", () => expect(tripDates("", "")).toBe(""));
});

describe("See all", () => {
  const six = Array.from({ length: 6 }, (_, i) => i);
  it("6 or fewer cards: all shown, nothing hidden", () => expect(shownCards(six, false)).toEqual({ shown: six, hidden: 0 }));
  it("8 cards: the first 6, and 2 behind See all", () => {
    const eight = [...six, 6, 7];
    expect(shownCards(eight, false)).toEqual({ shown: six, hidden: 2 });
    expect(shownCards(eight, true)).toEqual({ shown: eight, hidden: 0 });
  });
});

describe("Been: days away (counted so far for a trip still going), and long names", () => {
  it("a trip still going counts its days up to today and says plain 'days away' (short enough for 320 px)", () => {
    // Today is 13 Nov. A trip 10–16 Nov is in progress: it counts 10, 11, 12, 13 = 4 days so far (not its 7).
    const going = build([trip("now", "Phuket", "2026-11-10", "2026-11-16", 3, "Phuket", "TH")]);
    expect(beenCards(going, {}, TODAY).stats).toEqual([
      { n: 1, label: "country" },
      { n: 1, label: "trip" },
      { n: 4, label: "days away" },
    ]);
    const done = build([trip("old", "Goa trip", "2026-03-13", "2026-03-15", 4)]);
    expect(beenCards(done, {}, TODAY).stats.at(-1)).toEqual({ n: 3, label: "days away" });
    expect(beenStats(2, 1, 1, true).at(-1)).toEqual({ n: 1, label: "day away" });
  });
  it("a long single word steps the type down by its own width; short names keep full size", () => {
    // 18 letters at 0.6 em: 100 / (18 × 0.6) = 9.2 of the box's width, never below 14 px.
    expect(titleFit("Thiruvananthapuram", 22)).toBe("max(14px, min(22px, 9.2cqw))");
    // Only the longest word counts, and "·" is a break: "Thiruvananthapuram · Kanyakumari" is still 18.
    expect(titleFit("Thiruvananthapuram · Kanyakumari", 22)).toBe("max(14px, min(22px, 9.2cqw))");
    // 3 letters: 100 / 1.8 = 55.5, far above 22 px, so the 22 px cap rules.
    expect(titleFit("Goa", 22)).toBe("max(14px, min(22px, 55.5cqw))");
  });
});
