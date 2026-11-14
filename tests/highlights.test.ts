import { describe, expect, it } from "vitest";
import { climateFor, tripMonth, usesFahrenheit, weatherWords } from "@/lib/climate";
import { happeningsFor } from "@/lib/happenings";
import { homeHighlights, type HighlightInput } from "@/lib/home/highlights";
import { seasonNow } from "@/lib/home/banner";

const base: HighlightInput = { trips: [], justBack: [], hasMonth: false, season: null, postcardsNew: 0, billsDue: [], passportCountries: 0, groups: 2 };
const titles = (h: ReturnType<typeof homeHighlights>) => h.map((x) => (x.kind === "month" ? "month" : `${x.eyebrow} | ${x.title}`));

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

describe("Home highlights", () => {
  it("never fewer than 4, never more than 7; the \"Coming from another app?\" card is gone", () => {
    expect(homeHighlights(base).length).toBe(4);
    expect(homeHighlights(base).map((h) => h.id)).toEqual(["fill-postcard", "fill-passport", "fill-trip", "fill-group"]);
    expect(homeHighlights({ ...base, groups: 1 }).some((h) => h.id === "fill-switch")).toBe(false);
    // Postcards and the passport stay on Home.
    expect(homeHighlights(base).some((h) => "href" in h && h.href === "/postcards/new")).toBe(true);
    expect(homeHighlights(base).some((h) => "href" in h && h.href === "/passport")).toBe(true);
    const busy = homeHighlights({
      ...base,
      hasMonth: true,
      postcardsNew: 2,
      season: seasonNow(new Date("2026-12-10T10:00:00Z"), "Asia/Kolkata", "IN"),
      trips: [
        { id: "t1", name: "Goa", phase: { kind: "before", days: 12 }, start: "2026-12-26", end: "2026-12-31", stops: [{ city: "Goa", country: "IN" }] },
        { id: "t2", name: "Bangkok", phase: { kind: "during", day: 2, of: 5 }, start: "2026-12-09", end: "2026-12-13", stops: [{ city: "Bangkok", country: "TH" }], todaySpent: "₹4,200" },
      ],
      justBack: [{ id: "t3", name: "Manali", endedDaysAgo: 3, payments: 2, abroad: false }],
      billsDue: [{ groupId: "f", billId: "b", name: "Rent", group: "Flat 402", inDays: 2, amount: "₹42,000" }],
    });
    expect(busy.length).toBe(7);
    // The trip you're on comes first, then the next trip's weather and what's on.
    expect(titles(busy).slice(0, 3)).toEqual([
      "In Bangkok now | ₹4,200 spent today",
      "Goa in 12 days | Usually 33° by day, 21° at night",
      "While you’re in Goa | Christmas & New Year in Goa",
    ]);
  });
  it("a trip just over with money left asks to settle; once square, shows the stamp", () => {
    const owe = homeHighlights({ ...base, justBack: [{ id: "x", name: "Bali", endedDaysAgo: 4, payments: 3, abroad: true }] });
    expect(titles(owe)[0]).toBe("Back from Bali | 3 payments square it");
    const square = homeHighlights({ ...base, justBack: [{ id: "x", name: "Bali", endedDaysAgo: 4, payments: 0, abroad: true }] });
    expect(titles(square)[0]).toBe("Back from Bali | A new stamp in your passport");
  });
  it("seasons follow where you live, all year", () => {
    expect(seasonNow(new Date("2027-03-15T10:00:00Z"), "Asia/Kolkata", "IN")?.id).toBe("holi-2027");
    expect(seasonNow(new Date("2027-01-10T10:00:00Z"), "Australia/Sydney", "AU")?.id).toBe("summer-south");
    expect(seasonNow(new Date("2027-07-01T10:00:00Z"), "America/New_York", "US")?.id).toBe("july4");
    expect(seasonNow(new Date("2027-07-01T10:00:00Z"), "Asia/Kolkata", "IN")?.id).toBe("monsoon-in");
  });
});

describe("Home cards after the countdown and needs-you line", () => {
  const goa = { id: "t1", name: "Goa", phase: { kind: "before" as const, days: 12 }, start: "2026-12-26", end: "2026-12-31", stops: [{ city: "Goa", country: "IN" }] };
  it("no weather card for the trip whose weather the countdown already says; another trip keeps its own", () => {
    const manali = { ...goa, id: "t2", name: "Manali", start: "2027-01-05", end: "2027-01-09", stops: [{ city: "Manali", country: "IN" }], phase: { kind: "before" as const, days: 30 } };
    expect(homeHighlights({ ...base, trips: [goa] }).some((h) => h.id === "weather-t1")).toBe(true);
    const ids = homeHighlights({ ...base, trips: [goa, manali], skipWeather: ["t1"] }).map((h) => h.id);
    expect(ids).not.toContain("weather-t1");
    expect(ids).toContain("weather-t2");
  });
  it("passport and postcard cards take a real photo when there is one, and keep the drawn art when there is not", () => {
    const withPhotos = homeHighlights({ ...base, passportCountries: 22, scenes: { passport: "/photos/card-passport.jpg", postcards: "/photos/card-postcards.jpg" } });
    const pass = withPhotos.find((h) => h.id === "fill-passport");
    const post = withPhotos.find((h) => h.id === "fill-postcard");
    expect(pass).toMatchObject({ photo: "/photos/card-passport.jpg", scene: true, title: "22 countries and counting" });
    expect(post).toMatchObject({ photo: "/photos/card-postcards.jpg", scene: true });
    const plain = homeHighlights({ ...base, passportCountries: 22 }).find((h) => h.id === "fill-passport");
    expect(plain).toMatchObject({ art: "passport" });
    expect(plain && "photo" in plain ? plain.photo : undefined).toBeUndefined();
  });
});
