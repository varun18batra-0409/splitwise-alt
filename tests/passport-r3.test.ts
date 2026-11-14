import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPassport, daysAway, passportCounts, stampPages, tripDays, type PassportTrip, type Stamp } from "@/lib/passport";
import { beenCards, tripDatesShort } from "@/lib/passport-cards";
import { COUNTRY_SLOT, cardPhoto, countryPhoto } from "@/lib/country-photos";
import { STAMP_INKS, StampArt, stampMonth } from "@/components/stamps/StampArt";

// Batch R3: the passport as mockup 14. The numbers are worked out by hand in each test.
const TODAY = "2026-11-13";
const trip = (groupId: string, name: string, start: string, end: string, place = "", country = "", people = 3): PassportTrip => ({ groupId, name, start, end, place, country, people });
const src = (f: string) => readFileSync(f, "utf8");

describe("R3: the card's words", () => {
  const goa = trip("goa", "Goa trip", "2026-03-13", "2026-03-15"); // 13, 14, 15 Mar = 3 days
  const thai = trip("thai", "Thailand", "2026-05-05", "2026-05-10", "Bangkok, Phuket", "TH"); // 5..10 May = 6 days
  const p = buildPassport([goa, thai], [], "IN", TODAY);
  const full = { trips: [goa, thai], stamps: p.stamps, been: p.been, stats: p.stats };
  const { cards, stats } = beenCards(full, {}, TODAY, {});

  it("Thailand 5–10 May 2026: '5–10 May · 6 days' and the stamp THAILAND / MAY 2026", () => {
    expect(tripDays("2026-05-05", "2026-05-10")).toBe(6);
    expect(tripDatesShort("2026-05-05", "2026-05-10")).toBe("5–10 May");
    const c = cards.find((x) => x.id === "thai")!;
    expect(`${c.dates} · ${c.days} days`).toBe("5–10 May · 6 days");
    expect([c.countryName.toUpperCase(), stampMonth(c.stampWhen)]).toEqual(["THAILAND", "MAY 2026"]);
  });
  it("Goa 13–15 Mar 2026 is 3 days, and its stamp names the country: INDIA / MAR 2026", () => {
    const c = cards.find((x) => x.id === "goa")!;
    expect(`${c.dates} · ${c.days} days`).toBe("13–15 Mar · 3 days");
    expect([c.countryName.toUpperCase(), stampMonth(c.stampWhen)]).toEqual(["INDIA", "MAR 2026"]);
  });
  it("together: 2 countries, 2 trips, 9 days travelled (6 + 3)", () => {
    expect(stats).toEqual([
      { n: 2, label: "countries" },
      { n: 2, label: "trips" },
      { n: 9, label: "days travelled" },
    ]);
  });
  it("overlapping trips count each day once: 1–5 Jun (5) + 4–8 Jun (5) = days 1..8 = 8, not 10", () => {
    expect(daysAway([{ start: "2026-06-01", end: "2026-06-05" }, { start: "2026-06-04", end: "2026-06-08" }], TODAY)).toBe(8);
  });
  it("30 Dec 2026 – 2 Jan 2027 is 4 days and reads '30 Dec – 2 Jan' with DEC 2026 on the stamp", () => {
    expect(tripDays("2026-12-30", "2027-01-02")).toBe(4); // 30, 31, 1, 2
    expect(tripDatesShort("2026-12-30", "2027-01-02")).toBe("30 Dec – 2 Jan");
    expect(stampMonth("2026-12-30")).toBe("DEC 2026");
  });
});

describe("R3: one set of numbers", () => {
  // Home India. A Goa trip, a Thailand trip (Bangkok, Phuket), and Italy added by hand.
  const trips = [trip("goa", "Goa trip", "2026-03-13", "2026-03-15"), trip("thai", "Thailand", "2026-05-05", "2026-05-10", "Bangkok, Phuket", "TH")];
  const p = buildPassport(trips, [{ c: "IT" }], "IN", TODAY);
  const counts = passportCounts({ trips, stamps: p.stamps, been: p.been, stats: p.stats }, TODAY);
  it("countries 3 (India, Thailand, Italy), trips 2, days 9, stamps 3 (Goa, Thailand, Italy), cities 3 (Goa, Bangkok, Phuket)", () => {
    expect(counts).toEqual({ countries: 3, trips: 2, days: 9, stamps: 3, cities: 3 });
  });
  it("the stats row is made from the same object", () => {
    const { stats } = beenCards({ trips, stamps: p.stamps, been: p.been, stats: p.stats }, {}, TODAY, {});
    expect(stats.map((s) => s.n)).toEqual([counts.countries, counts.trips, counts.days]);
  });
  it("the page, the book (cover and page 1) and the share picture all read passportCounts", () => {
    expect(src("src/app/passport/page.tsx")).toContain("passportCounts(p, today)");
    expect(src("src/app/passport/page.tsx")).toContain("counts={counts}");
    expect(src("src/app/passport/friends/[accountId]/page.tsx")).toContain("counts={passportCounts(p, today)}");
    const book = src("src/components/PassportBook.tsx");
    expect(book).toContain("data-cover-counts={`${counts.countries}|${counts.stamps}`}");
    expect(book).toContain("data-passport-counts={`${counts.countries}|${counts.stamps}|${counts.trips}`}");
    for (const second of ["stats.countries", "stats.cities", "stats.trips"]) expect(book).not.toContain(second); // no second source of the numbers
    const route = src("src/app/passport/image/route.tsx");
    expect(route).toContain("passportCounts(p, today)");
    expect(route).not.toContain("p.stats.");
  });
});

describe("R3: book pages", () => {
  const stamp = (i: number): Stamp => ({ id: `s${i}`, kind: "country", code: "TH", name: "Thailand", flag: "", when: "2026-05-05", cities: [], byHand: false });
  it("7 stamps are 6 on the first page and 1 on the next", () => {
    const pages = stampPages(Array.from({ length: 7 }, (_, i) => stamp(i)), []);
    expect(pages.map((x) => x.stamps.length)).toEqual([6, 1]);
  });
  it("no stamps, no pages", () => expect(stampPages([], [])).toEqual([]));
  it("trip stamps come before 'Been there' ones, on the same run of pages", () => {
    const pages = stampPages([stamp(1)], [{ ...stamp(2), byHand: true }]);
    expect(pages).toHaveLength(1);
    expect(pages[0].stamps.map((s) => s.byHand)).toEqual([false, true]);
  });
});

describe("R3: country photos", () => {
  const have = { "place-thailand": { src: "/photos/place-thailand.jpg" }, "cover-beach": { src: "/photos/cover-beach.jpg" }, "cover-friends": { src: "/photos/cover-friends.jpg" } };
  it("a known country with a photo gives its /photos address, whatever the case", () => {
    expect(countryPhoto("TH", have)).toBe("/photos/place-thailand.jpg");
    expect(countryPhoto("th", have)).toBe("/photos/place-thailand.jpg");
  });
  it("an unknown code, or a country whose photo didn't download, gives null (the drawn stamp is used)", () => {
    expect(countryPhoto("ZZ", have)).toBeNull();
    expect(countryPhoto("IT", have)).toBeNull(); // Italy has a slot, but no photo here
    expect(COUNTRY_SLOT.IT).toBe("country-it");
  });
  it("every country the plan names has a slot, the sixteen with photos reusing the app's own", () => {
    for (const c of "TH ID AE SG MV VN LK JP GB NP US GR BT CH FR IN".split(" ")) expect(COUNTRY_SLOT[c]).toBeTruthy();
    expect(COUNTRY_SLOT.FR).toBe("cover-paris");
    expect(COUNTRY_SLOT.IN).toBe("cover-taj");
    expect(Object.keys(COUNTRY_SLOT)).toHaveLength(16 + 48); // 16 reused + 48 country-xx slots = 64
  });
  it("a 'been there' card never gets a mood photo (beach, friends…): its own country's photo, or none", () => {
    const hand = { kind: "hand" as const, groupName: "Italy", place: "", title: "Italy", cities: [] as string[], code: "IT", countryName: "Italy" };
    expect(cardPhoto(hand, have)).toBeUndefined();
    expect(cardPhoto({ ...hand, groupName: "Thailand", title: "Thailand", code: "TH", countryName: "Thailand" }, have)).toBe("/photos/place-thailand.jpg");
  });
  it("a trip card with no place photo uses its country's photo before any mood photo", () => {
    const t = { kind: "trip" as const, groupName: "Boys trip", place: "", title: "Malaysia", cities: [] as string[], code: "MY", countryName: "Malaysia" };
    expect(cardPhoto(t, { ...have, "country-my": { src: "/photos/country-my.jpg" } })).toBe("/photos/country-my.jpg");
  });
});

describe("R3: the stamp drawing", () => {
  const html = (props: Parameters<typeof StampArt>[0]) => renderToStaticMarkup(createElement(StampArt, props));
  it("the card stamp is COUNTRY over MON YEAR with the test hooks", () => {
    const h = html({ variant: "card", code: "TH", country: "Thailand", when: "2026-05-05" });
    expect(h).toContain('data-country-stamp="TH"');
    expect(h).toContain('data-by-hand="0"');
    expect(h).toContain("THAILAND");
    expect(h).toContain("MAY 2026");
    expect(h).toContain("data:image/svg+xml"); // the waves postmark
  });
  it("a country added by hand says BEEN THERE and is dashed", () => {
    const h = html({ variant: "card", code: "IT", country: "Italy", when: "", byHand: true });
    expect(h).toContain('data-by-hand="1"');
    expect(h).toContain("BEEN THERE");
    expect(h).toContain("dashed");
  });
  it("a page stamp: a boxed ARRIVED for a city at home, a round VISITED ring for a country abroad", () => {
    const city = html({ s: { id: "a", kind: "city", code: "IN", name: "Goa", flag: "", when: "2026-03-13", cities: [], byHand: false } });
    expect(city).toContain("ARRIVED");
    expect(city).toContain("MAR 2026");
    const abroad = html({ s: { id: "b", kind: "country", code: "TH", name: "Thailand", flag: "", when: "2026-05-05", cities: [], byHand: false } });
    expect(abroad).toContain("VISITED");
    expect(abroad).toContain('data-country-stamp="TH"');
  });
  it("the inks are never green", () => {
    for (const ink of STAMP_INKS) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
      expect(g > r && g > b, ink).toBe(false);
    }
  });
});

describe("R3: no green (it's for money owed to you)", () => {
  const green = /\bGREEN\b|#2f7d4f|#6fe3a8|#7fb59a|rgba\(111,\s*227,\s*168/;
  for (const f of ["src/components/stamps/StampArt.tsx", "src/components/PassportBook.tsx", "src/app/passport/image/route.tsx", "src/components/PassportCompare.tsx", "src/components/BeenCard.tsx"])
    it(`${f} has none`, () => expect(src(f)).not.toMatch(green));
});

describe("R3: the passport page follows mockup 14", () => {
  const page = src("src/app/passport/page.tsx");
  const tabs = src("src/components/PassportTabs.tsx");
  it("the art opens the book, with a 44 px target, smaller (not hidden) on the narrowest phones", () => {
    expect(tabs).toContain('href="/passport?book=1" aria-label="Open your passport book"');
    expect(tabs).toContain("h-[76px] w-[70px]");
    expect(tabs).not.toMatch(/className="[^"]*\bhidden\b/);
  });
  it("the subtitle, the two tabs, and the order: stats, stamps, cards, then Add | Share, question, settings", () => {
    expect(page).toContain("A personal travel log of your trips and places.");
    expect(page).not.toContain("just for you");
    expect(tabs).toContain('{ id: "want", label: "Want to go" }');
    const base = page.indexOf("<PassportStats");
    const at = (s: string) => page.indexOf(s, base);
    const order = ["<PassportStats", "Your stamps", "<StampCard", "<CountryPicker", "<ShareSheet", "data-passport-ask", 'id="settings"'].map(at);
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("the settings are one 'Passport settings' row that opens for open=who, open=settings or a saved choice", () => {
    expect(page).toContain("Passport settings");
    expect(page).toContain('open={sp.open === "who" || sp.open === "settings" || Boolean(sp.shared)}');
    expect(page).toContain('data-row="who"');
    expect(page).toContain('data-row="home"');
  });
  it("the sharing question and the settings sit below the stamp cards", () => {
    expect(page.indexOf("data-passport-ask")).toBeGreaterThan(page.indexOf("<StampCard"));
  });
  it("one card design with one outline button; no arrows after button words", () => {
    const card = src("src/components/BeenCard.tsx");
    expect(card).toContain("{c.cta.label}");
    expect(card).not.toMatch(/Relive trip\s*→|View memories\s*→|→/);
    expect(card).toContain('data-been-card={hand ? "hand" : "trip"}');
  });
});
