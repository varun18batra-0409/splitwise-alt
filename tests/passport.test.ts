import { describe, expect, it } from "vitest";
import { tripStops, countryOf } from "@/lib/geo";
import { buildPassport, parseHandPlaces } from "@/lib/passport";
import { buildStories } from "@/lib/home/stories";
import { squareNumbers } from "@/lib/square";

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
  it("cities at home, countries abroad, hand-added places lighter, trips to come not yet", () => {
    const p = buildPassport(
      [trip("a", "Goa trip", "2024-03-01"), trip("b", "Goa again", "2025-01-01"), trip("c", "Goa 3", "2026-02-01"), trip("d", "Thailand", "2026-05-01", "Bangkok, Phuket"), trip("e", "Manali", "2027-05-01")],
      [{ c: "JP" }, { c: "IN", city: "Jaipur" }],
      "IN",
      "2026-10-27",
    );
    expect(p.countries.map((c) => c.code)).toEqual(["IN", "TH", "JP"]);
    expect(p.countries[0].cities.map((c) => [c.city, c.trips, c.byHand])).toEqual([["Goa", 3, false], ["Jaipur", 0, true]]);
    expect(p.countries[2].byHand).toBe(true);
    expect(p.stats).toEqual({ cities: 4, countries: 3, abroad: 2, trips: 4, thisYear: 2 });
    expect(p.milestones).toEqual(["First trip abroad ✈️", "Goa ×3 🔁"]);
  });
  it("hand-added places are checked", () => {
    expect(parseHandPlaces('[{"c":"th","city":" Krabi "},{"c":"XX"},"junk"]')).toEqual([{ c: "TH", city: "Krabi" }]);
    expect(parseHandPlaces("nope")).toEqual([]);
  });
});

describe("Stories on Home", () => {
  const now = new Date("2026-10-27T10:00:00Z");
  it("a trip coming up, last night's game and a year ago; old games and far trips left out", () => {
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
    expect(s.map((x) => x.id)).toEqual(["trip-g1-b3", "pot-p1", "memory-g9-1", "collect-c1-2"]);
    expect(s[0]).toMatchObject({ headline: "Goa in 3 days", line: "5 of you, 3 sleeps to go", href: "/groups/g1" });
    expect(s.find((x) => x.kind === "pot")?.headline).toBe("Asha won ₹600");
    expect(s.find((x) => x.kind === "memory")?.headline).toBe("A year ago: Manali");
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
