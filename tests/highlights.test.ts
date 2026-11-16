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

describe("Home's one sliding row, in order: weather, month, bill, postcard, passport, festival", () => {
  const bill = (billId: string, inDays: number, amount = "") => ({ groupId: "f", billId, name: billId, group: "Flat", inDays, amount });
  const season = { id: "christmas", eyebrow: "Christmas is coming", title: "Holiday plans?", text: "Secret Santa, a trip or a big dinner: one group, split fairly.", button: "Start a group", href: "/groups/new?type=other" };
  const weather = beforeYouGo([trip("th")])!;
  const cardOf = (all: ReturnType<typeof homeHighlights>, id: string) => {
    const c = all.find((h) => h.id === id);
    if (!c || c.kind !== "card") throw new Error(`no card ${id}`);
    return c;
  };

  it("no trip, no postcards, nothing else: Send a postcard, the passport and the month (festival only in its window)", () => {
    expect(homeHighlights({ ...base, hasMonth: true }).map((h) => h.id)).toEqual(["month", "fill-postcard", "fill-passport"]);
    expect(homeHighlights({ ...base, hasMonth: true, season }).map((h) => h.id)).toEqual(["month", "fill-postcard", "fill-passport", "season-christmas"]);
    // No season passed (outside its dates): no festival card.
    expect(homeHighlights({ ...base, hasMonth: true, season: null }).map((h) => h.id)).not.toContain("season-christmas");
  });
  it("a next trip puts its weather FIRST, then everything else in order", () => {
    const all = homeHighlights({ ...base, hasMonth: true, weather, billsDue: [bill("b", 2, "₹42,000")], postcardsNew: 2, season });
    expect(all.map((h) => h.id)).toEqual(["weather-th", "month", "bill-b", "postcards", "fill-passport", "season-christmas"]);
    const w = cardOf(all, "weather-th");
    expect(w.eyebrow).toBe("THAILAND · SEASONAL WEATHER");
    expect(w.title).toBe("Usually 31° by day, 22° at night");
    expect(w.art).toBe("sun");
    expect(w.href).toBe("/groups/th");
  });
  it("no next trip with known weather: no weather card", () => {
    expect(homeHighlights({ ...base, weather: beforeYouGo([trip("nostops", { stops: [] })]) }).map((h) => h.id)).not.toContain("weather-nostops");
    expect(homeHighlights({ ...base, weather: null }).some((h) => h.id.startsWith("weather-"))).toBe(false);
  });
  it("postcards waiting replace 'Send a postcard' (never both)", () => {
    const none = homeHighlights(base).map((h) => h.id);
    expect(none).toContain("fill-postcard");
    expect(none).not.toContain("postcards");
    const one = homeHighlights({ ...base, postcardsNew: 1 });
    expect(one.map((h) => h.id)).toContain("postcards");
    expect(one.map((h) => h.id)).not.toContain("fill-postcard");
    expect(cardOf(one, "postcards").title).toBe("A postcard is waiting");
    expect(cardOf(homeHighlights({ ...base, postcardsNew: 3 }), "postcards").title).toBe("3 postcards are waiting");
    expect(cardOf(homeHighlights(base), "fill-postcard").title).toBe("Send a postcard");
  });
  it("the postcard card shows the real photo with the keepsake when we have the photos; else drawn art", () => {
    const plain = cardOf(homeHighlights(base), "fill-postcard");
    expect(plain.photo).toBeUndefined();
    expect(plain.art).toBe("postcard");
    const withPhotos = cardOf(homeHighlights({ ...base, scenes: { postcards: "/p.jpg", postcardPhoto: "/q.jpg" } }), "fill-postcard");
    expect(withPhotos.photo).toBe("/p.jpg");
    expect(withPhotos.scene).toBe(true);
    expect(withPhotos.keepsake).toEqual({ kind: "postcard", photo: "/q.jpg" });
  });
  it("the passport card: 'Where have you been?' with no country, '1 country and counting' with one, 'N countries and counting' with more, linking to /passport, with your own stamps (at most 2)", () => {
    expect(cardOf(homeHighlights(base), "fill-passport").title).toBe("Where have you been?");
    const one = cardOf(homeHighlights({ ...base, passportCountries: 1 }), "fill-passport");
    expect(one.title).toBe("1 country and counting");
    expect(one.text).toContain("Flip through your stamps");
    const c = cardOf(homeHighlights({ ...base, passportCountries: 5, passportAbroad: 4 }), "fill-passport");
    expect(c.title).toBe("5 countries and counting");
    expect(c.text).toBe("4 abroad, plus home. Flip through your stamps, or see where friends who share theirs have been.");
    expect(c.href).toBe("/passport");
    const st = (code: string) => ({ code, country: code, when: "2026-10-01" });
    const photo = cardOf(homeHighlights({ ...base, scenes: { passport: "/pp.jpg", stamps: [st("TH"), st("JP"), st("FR")] } }), "fill-passport");
    expect(photo.keepsake).toEqual({ kind: "passport", stamps: [st("TH"), st("JP")] });
  });
  it("a bill is only a card from today to 5 days away, the nearest one wins, and it sits right after the month", () => {
    const ids = (billsDue: ReturnType<typeof bill>[]) => homeHighlights({ ...base, billsDue }).map((h) => h.id);
    expect(ids([bill("late", -1), bill("far", 6)])).not.toContain("bill-late");
    expect(ids([bill("late", -1), bill("far", 6)])).not.toContain("bill-far");
    expect(ids([bill("a", 5), bill("b", 0), bill("c", 3)]).filter((i) => i.startsWith("bill-"))).toEqual(["bill-b"]);
    expect(titles(homeHighlights({ ...base, billsDue: [bill("b", 0)] })).find((t) => t.startsWith("Flat"))).toBe("Flat | b is due today");
    expect(homeHighlights({ ...base, hasMonth: true, billsDue: [bill("b", 1)] }).map((h) => h.id).slice(0, 2)).toEqual(["month", "bill-b"]);
  });
  it("the festival card is drawn art, no photo, and comes last", () => {
    const all = homeHighlights({ ...base, hasMonth: true, season });
    const card = cardOf(all, "season-christmas");
    expect(card.art).toBe("festive");
    expect(card.photo).toBeUndefined();
    expect(all[all.length - 1].id).toBe("season-christmas");
    expect(seasonNow(new Date("2026-12-05T06:00:00Z"), "Asia/Kolkata", "IN")?.id).toBe("christmas");
    expect(seasonNow(new Date("2026-12-28T06:00:00Z"), "Asia/Kolkata", "IN")?.id).toBe("new-year");
    expect(seasonNow(new Date("2026-11-20T06:00:00Z"), "Asia/Kolkata", "IN")?.id).not.toBe("thanksgiving-2026"); // US-only festival
  });
  it("the old cards stay gone: no trip photos, on-there, just back, fill-trip or fill-group", () => {
    const ids = homeHighlights({ ...base, hasMonth: true, weather, postcardsNew: 3, billsDue: [bill("b", 1)], season }).map((h) => h.id);
    for (const id of ids) expect(id).not.toMatch(/^(on-|on-there-|back-|stamp-|plan-|fill-trip|fill-group|memories)/);
    expect(Object.keys(base)).not.toContain("trips");
  });
  it("seasons follow where you live, all year", () => {
    expect(seasonNow(new Date("2027-03-15T10:00:00Z"), "Asia/Kolkata", "IN")?.id).toBe("holi-2027");
    expect(seasonNow(new Date("2027-01-10T10:00:00Z"), "Australia/Sydney", "AU")?.id).toBe("summer-south");
  });
});

describe("The weather card: the soonest trip that has not started", () => {
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
  it("no upcoming trips: nothing, so Home draws no weather card", () => {
    expect(beforeYouGo([])).toBeNull();
  });
  it("a trip in your home country is headed by the place (GOA), not the country (INDIA); abroad it is still the country", () => {
    const goa = trip("goa", { name: "Goa", stops: [{ city: "Goa", country: "IN" }], countryName: "India", start: "2026-12-26", end: "2026-12-31" });
    expect(beforeYouGo([goa], false, "IN")?.eyebrow).toBe("GOA · SEASONAL WEATHER");
    expect(beforeYouGo([goa], false, "in")?.eyebrow).toBe("GOA · SEASONAL WEATHER");
    expect(beforeYouGo([goa], false, "US")?.eyebrow).toBe("INDIA · SEASONAL WEATHER");
    expect(beforeYouGo([trip("th")], false, "IN")?.eyebrow).toBe("THAILAND · SEASONAL WEATHER");
  });
  it("with no country name known, the eyebrow names the place instead, still in capitals", () => {
    expect(beforeYouGo([trip("c", { countryName: undefined, stops: [{ city: "Chiang Mai", country: "TH" }] })])?.eyebrow).toBe("CHIANG MAI · SEASONAL WEATHER");
  });
});
