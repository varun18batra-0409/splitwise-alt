import { countryOf, tripStops } from "./geo";

// Your trip passport, like a real one: every Loopin trip leaves its own stamp
// (a city stamp for a trip in your home country, a round country stamp for a
// trip abroad), and countries you add from before Loopin get their own lighter
// "Been there" stamp, kept apart from the trip ones. The counts are of places,
// not stamps: Italy three times is still one country. Pure.

export type PassportTrip = { groupId: string; name: string; start: string; end: string; place: string; country: string; people: number };
export type HandPlace = { c: string };
export type Stamp = {
  id: string;
  kind: "city" | "country"; // city = a trip at home; country = abroad (or "Been there")
  code: string; // the country
  name: string; // the city, or the country
  flag: string;
  when: string; // the trip's start ("" for Been there)
  cities: string[]; // abroad: the cities that trip went to
  groupId?: string;
  byHand: boolean;
};
export type IndexRow = { code: string; name: string; flag: string; home: boolean; trips: number; byHand: boolean; cities: string[] };

// Countries only (cities come from real trips). Older lists may have a city: it's dropped.
export function parseHandPlaces(json: string): HandPlace[] {
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    const seen = new Set<string>();
    const out: HandPlace[] = [];
    for (const p of v) {
      if (!p || typeof p.c !== "string" || !countryOf(p.c)) continue;
      const c = p.c.toUpperCase();
      if (seen.has(c)) continue;
      seen.add(c);
      out.push({ c });
    }
    return out.slice(0, 300);
  } catch {
    return [];
  }
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function buildPassport(trips: PassportTrip[], hand: HandPlace[], home: string, today: string) {
  const look = (code: string) => countryOf(code) ?? { code, name: code, flag: "🏳️" };
  const stamps: Stamp[] = [];
  const index = new Map<string, IndexRow>();
  const row = (code: string) => {
    const c = look(code);
    const r = index.get(c.code) ?? { code: c.code, name: c.name, flag: c.flag, home: c.code === home, trips: 0, byHand: false, cities: [] };
    index.set(c.code, r);
    return r;
  };
  const cityTrips = new Map<string, number>(); // "IN|goa" → trips

  // Trips that have started (a trip still to come isn't a stamp yet), oldest first, like the pages of a passport.
  const started = trips.filter((x) => x.start && x.start <= today).sort((a, b) => a.start.localeCompare(b.start) || a.groupId.localeCompare(b.groupId));
  for (const t of started) {
    const byCountry = new Map<string, string[]>();
    for (const s of tripStops(t.name, t.place, t.country)) {
      const code = (s.country || home).toUpperCase();
      if (!code) continue;
      const list = byCountry.get(code) ?? [];
      if (s.city && !list.some((x) => same(x, s.city))) list.push(s.city);
      byCountry.set(code, list);
    }
    for (const [code, cities] of byCountry) {
      const r = row(code);
      r.trips++;
      for (const city of cities) {
        if (!r.cities.some((x) => same(x, city))) r.cities.push(city);
        const k = `${r.code}|${city.toLowerCase()}`;
        cityTrips.set(k, (cityTrips.get(k) ?? 0) + 1);
      }
      if (r.home) {
        // At home: a stamp for each city the trip went to (or the country, if we only know that).
        for (const city of cities.length ? cities : [r.name])
          stamps.push({ id: `${t.groupId}-${r.code}-${city.toLowerCase()}`, kind: "city", code: r.code, name: city, flag: r.flag, when: t.start, cities: [], groupId: t.groupId, byHand: false });
      } else stamps.push({ id: `${t.groupId}-${r.code}`, kind: "country", code: r.code, name: r.name, flag: r.flag, when: t.start, cities, groupId: t.groupId, byHand: false });
    }
  }

  // From before Loopin: their own stamp, even where a Loopin trip went too.
  const been: Stamp[] = [];
  for (const h of hand) {
    const r = row(h.c);
    r.byHand = true;
    been.push({ id: `been-${r.code}`, kind: "country", code: r.code, name: r.name, flag: r.flag, when: "", cities: [], byHand: true });
  }
  been.sort((a, b) => a.name.localeCompare(b.name, "en"));

  const rows = [...index.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
  const year = today.slice(0, 4);
  const abroad = rows.filter((r) => !r.home);
  const stats = {
    cities: [...cityTrips.keys()].length,
    countries: rows.length,
    abroad: abroad.length,
    trips: started.length,
    thisYear: new Set(started.filter((t) => t.start.startsWith(year)).map((t) => t.groupId)).size,
  };

  // Milestones worth showing off.
  const milestones: string[] = [];
  if (abroad.some((r) => r.trips > 0)) milestones.push("First trip abroad ✈️");
  if (abroad.length >= 3) milestones.push(`${abroad.length} countries 🌍`);
  for (const r of rows) for (const city of r.cities) {
    const n = cityTrips.get(`${r.code}|${city.toLowerCase()}`) ?? 0;
    if (n >= 3) milestones.push(`${city} ×${n} 🔁`);
  }
  if (stats.thisYear >= 3) milestones.push(`${stats.thisYear} trips this year 🔥`);
  if (stats.trips >= 10) milestones.push("10 trips club 🏅");

  return { stamps, been, index: rows, stats, milestones };
}

// The booklet's pages: a few stamps each, Loopin trips first, then the ones from before.
export function stampPages(stamps: Stamp[], been: Stamp[], per = 6) {
  const pages: { title: string; stamps: Stamp[] }[] = [];
  for (let i = 0; i < stamps.length; i += per) pages.push({ title: "Trips", stamps: stamps.slice(i, i + per) });
  for (let i = 0; i < been.length; i += per) pages.push({ title: "Before Loopin", stamps: been.slice(i, i + per) });
  return pages;
}
