import { describe, expect, it } from "vitest";
import { climateFor, tripMonth, usesFahrenheit, weatherWords } from "@/lib/climate";
import { happeningsFor } from "@/lib/happenings";
import { beforeYouGo, homeHighlights, type HighlightInput, type HighlightTrip } from "@/lib/home/highlights";
import { seasonNow } from "@/lib/home/banner";

const base: HighlightInput = { hasMonth: false, postcardsNew: 0, billsDue: [] };
const titles = (h: ReturnType<typeof homeHighlights>) => h.map((x) => (x.kind === "month" ? "month" : `${x.eyebrow} | ${x.title}`));
const trip = (id: string, over: Partial<HighlightTrip> = {}): HighlightTrip => ({ id, name: "Thailand", phase: { kind: "before", days: 25 }, start: "2026-12-10", end: "2026-12-15", stops: [{ city: "", country: "TH" }], countryName: "Thailand", ...over });

describe("Usual weather for a trip", () => {
  it("knows the season: Goa in November is dry, Lonavala in July is monsoon, Manali in January is freezing", () => {
    const goa = climateFor("Goa", "IN", 10)!;
    expect(goa.rain).toBe(0);
    expect(weatherWords(goa).line).toBe("Usually 33° by day, 23° at night. Dry and sunny.");
    expect(weatherWords(climateFor("Lonavala", "IN", 6)!).sky).toMatch(/Monsoon/);
    expect(weatherWords(climateFor("Lonavala", "IN", 6)!).tip).toMatch(/rain jacket/);
    expect(weatherWords(climateFor("Manali", "IN", 0)!).tip).toMatch(/Snow|jacket/);
    expect(weatherWords(climateFor("Bali", "ID", 0)!).sky).toMatch(/Monsoon/);
  });
  it("falls back to the country, but never guesses for India or the US as a whole", () => {
    expect(climateFor("Some village", "TH", 3)).not.toBeNull();
    expect(climateFor("", "IN", 3)).toBeNull();
    expect(climateFor("", "US", 3)).toBeNull();
  });
  it("Fahrenheit for Americans", () => {
    expect(usesFahrenheit("US")).toBe(true);
    expect(usesFahrenheit("IN")).toBe(false);
    expect(weatherWords(climateFor("Miami", "US", 6)!, true).temps).toBe("Usually 91° by day, 79° at night");
  });
  it("a trip across two months uses the middle", () => {
    expect(tripMonth("2026-11-28", "2026-12-06")).toBe(11);
    expect(tripMonth("2026-11-28")).toBe(10);
  });
});

describe("What's on where you're going", () => {
  it("finds festivals during the trip dates and nothing outside them", () => {
    expect(happeningsFor([{ city: "Bangkok", country: "TH" }], "2027-04-12", "2027-04-16")[0].name).toBe("Songkran");
    expect(happeningsFor([{ city: "Bangkok", country: "TH" }], "2027-05-12", "2027-05-16")).toEqual([]);
    expect(happeningsFor([{ city: "Goa", country: "IN" }], "2026-12-28", "2027-01-02")[0].name).toMatch(/New Year/);
    expect(happeningsFor([{ city: "Kyoto", country: "JP" }], "2026-11-20", "2026-11-24")[0].name).toBe("Autumn leaves");
    expect(happeningsFor([{ city: "Reykjavik", country: "IS" }], "2027-01-10")[0].name).toMatch(/Northern lights/);
  });
});

describe("The sliding cards under Before you go: only the useful ones", () => {
  it("nothing to say: no cards at all (so Home draws no row)", () => {
    expect(homeHighlights(base)).toEqual([]);
  });
  it("postcards waiting, a bill due soon and the month, in that order; never more than 3", () => {
    const all = homeHighlights({ ...base, hasMonth: true, postcardsNew: 2, billsDue: [{ groupId: "f", billId: "b", name: "Rent", group: "Flat 402", inDays: 2, amount: "₹42,000" }] });
    expect(all.map((h) => h.id)).toEqual(["postcards", "bill-b", "month"]);
    expect(titles(all)).toEqual(["In your letterbox | 2 postcards are waiting", "Flat 402 | Rent is due in 2 days", "month"]);
    expect(homeHighlights({ ...base, postcardsNew: 1 }).map((h) => (h.kind === "card" ? h.title : ""))).toEqual(["A postcard is waiting"]);
  });
  it("a bill is only a card from today to 5 days away, and the nearest one wins", () => {
    const bill = (billId: string, inDays: number) => ({ groupId: "f", billId, name: billId, group: "Flat", inDays, amount: "" });
    expect(homeHighlights({ ...base, billsDue: [bill("late", -1), bill("far", 6)] })).toEqual([]);
    expect(homeHighlights({ ...base, billsDue: [bill("a", 5), bill("b", 0), bill("c", 3)] }).map((h) => h.id)).toEqual(["bill-b"]);
    expect(titles(homeHighlights({ ...base, billsDue: [bill("b", 0)] }))).toEqual(["Flat | b is due today"]);
  });
  it("no trip photo cards, passport or postcard fillers, festival or 'just back' cards remain", () => {
    const ids = homeHighlights({ ...base, hasMonth: true, postcardsNew: 3, billsDue: [{ groupId: "f", billId: "b", name: "Rent", group: "Flat", inDays: 1, amount: "" }] }).map((h) => h.id);
    for (const id of ids) expect(id).not.toMatch(/^(on-|on-there-|back-|stamp-|plan-|weather-|season-|fill-)/);
    // Trips never make a sliding card: the soonest one is Before you go, and the one under way is Coming up.
    expect(Object.keys(base)).not.toContain("trips");
  });
  it("seasons follow where you live, all year", () => {
    expect(seasonNow(new Date("2027-03-15T10:00:00Z"), "Asia/Kolkata", "IN")?.id).toBe("holi-2027");
    expect(seasonNow(new Date("2027-01-10T10:00:00Z"), "Australia/Sydney", "AU")?.id).toBe("summer-south");
  });
});

describe("Before you go: the soonest trip that has not started", () => {
  it("Thailand in December, from the real climate table: THAILAND · SEASONAL WEATHER, 31° by day, 22° at night, dry and sunny, sunscreen", () => {
    // TH row, December (index 11): hi 31, lo 22, rain 0 -> "Dry and sunny", and hi >= 29 with no rain -> the sunscreen tip, sun icon.
    const c = beforeYouGo([trip("th")]);
    expect(c).toEqual({
      id: "th",
      eyebrow: "THAILAND · SEASONAL WEATHER",
      title: "Usually 31° by day, 22° at night",
      text: "Typically dry and sunny. Pack sunscreen, sunglasses and a water bottle.",
      href: "/groups/th",
      button: "Open the trip",
      icon: "sun",
    });
  });
  it("Fahrenheit for the US: 31°C is 88°F and 22°C is 72°F (31 x 9/5 + 32 = 87.8, 22 x 9/5 + 32 = 71.6)", () => {
    expect(beforeYouGo([trip("th")], true)?.title).toBe("Usually 88° by day, 72° at night");
  });
  it("skips a trip that is under way (or on its first day), and one that is over", () => {
    const on = trip("on", { phase: { kind: "during", day: 2, of: 5 }, start: "2026-11-12", end: "2026-11-16" });
    const today = trip("today", { phase: { kind: "today" }, start: "2026-11-15", end: "2026-11-20" });
    const over = trip("over", { phase: { kind: "after" }, start: "2026-10-01", end: "2026-10-05" });
    expect(beforeYouGo([on, today, over])).toBeNull();
    expect(beforeYouGo([on, today, over, trip("later")])?.id).toBe("later");
  });
  it("picks the earliest start, whatever order the list is in, with no 60-day limit", () => {
    const goa = trip("goa", { name: "Goa", stops: [{ city: "Goa", country: "IN" }], countryName: "India", start: "2026-12-26", end: "2026-12-31", phase: { kind: "before", days: 41 } });
    const far = trip("far", { start: "2027-06-01", end: "2027-06-05", phase: { kind: "before", days: 198 } });
    expect(beforeYouGo([goa, far, trip("th")])?.id).toBe("th");
    expect(beforeYouGo([far])?.id).toBe("far"); // 198 days away: still shown
    expect(beforeYouGo([goa, trip("th")])?.title).toBe("Usually 31° by day, 22° at night");
    expect(beforeYouGo([goa])?.eyebrow).toBe("INDIA · SEASONAL WEATHER");
    expect(beforeYouGo([goa])?.title).toBe("Usually 33° by day, 21° at night"); // Goa in December
  });
  it("skips a trip whose climate is unknown and tries the next one", () => {
    const unknown = trip("who-knows", { start: "2026-11-20", end: "2026-11-22", stops: [{ city: "Nowhereville", country: "" }], countryName: undefined, phase: { kind: "before", days: 5 } });
    expect(climateFor("Nowhereville", "", 10)).toBeNull();
    expect(beforeYouGo([unknown, trip("th")])?.id).toBe("th");
    expect(beforeYouGo([unknown])).toBeNull();
    // A trip with no stops at all has no climate either.
    expect(beforeYouGo([trip("nostops", { stops: [] })])).toBeNull();
  });
  it("no upcoming trips: nothing, so Home draws no section", () => {
    expect(beforeYouGo([])).toBeNull();
  });
  it("with no country name known, the eyebrow names the place instead, still in capitals", () => {
    expect(beforeYouGo([trip("c", { countryName: undefined, stops: [{ city: "Chiang Mai", country: "TH" }] })])?.eyebrow).toBe("CHIANG MAI · SEASONAL WEATHER");
  });
});
