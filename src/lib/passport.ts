import { COUNTRIES, countryOf, tripStops } from "./geo";

// Your trip passport: a stamp for every place your Loopin trips went (cities in
// your home country, countries abroad), plus places you added by hand from
// before Loopin ("been there", shown lighter). Pure.

export type PassportTrip = { groupId: string; name: string; start: string; end: string; place: string; country: string; people: number };
export type HandPlace = { c: string; city?: string };
export type CityStamp = { city: string; trips: number; first: string; groupId?: string; byHand: boolean };
export type CountryStamp = { code: string; name: string; flag: string; home: boolean; trips: number; first: string; cities: CityStamp[]; byHand: boolean };

export function parseHandPlaces(json: string): HandPlace[] {
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v
      .filter((p): p is HandPlace => p && typeof p.c === "string" && Boolean(countryOf(p.c)))
      .map((p) => ({ c: p.c.toUpperCase(), ...(typeof p.city === "string" && p.city.trim() ? { city: p.city.trim().slice(0, 30) } : {}) }))
      .slice(0, 200);
  } catch {
    return [];
  }
}

export function buildPassport(trips: PassportTrip[], hand: HandPlace[], home: string, today: string) {
  const by = new Map<string, CountryStamp>();
  const country = (code: string, byHand: boolean) => {
    const c = countryOf(code) ?? { code, name: code, flag: "🏳️" };
    const s = by.get(c.code) ?? { code: c.code, name: c.name, flag: c.flag, home: c.code === home, trips: 0, first: "", cities: [], byHand };
    if (!byHand) s.byHand = false;
    by.set(c.code, s);
    return s;
  };
  // Trips that have started (a trip still to come isn't a stamp yet).
  for (const t of trips.filter((x) => x.start && x.start <= today).sort((a, b) => a.start.localeCompare(b.start))) {
    const stops = tripStops(t.name, t.place, t.country);
    const counted = new Set<string>();
    for (const s of stops) {
      const code = s.country || home;
      if (!code) continue;
      const cs = country(code, false);
      if (!counted.has(code)) {
        cs.trips++;
        counted.add(code);
        cs.first ||= t.start;
      }
      if (s.city) {
        const city = cs.cities.find((x) => x.city.toLowerCase() === s.city.toLowerCase());
        if (city) {
          city.trips++;
          city.byHand = false;
        } else cs.cities.push({ city: s.city, trips: 1, first: t.start, groupId: t.groupId, byHand: false });
      }
    }
  }
  for (const h of hand) {
    const cs = country(h.c, true);
    if (h.city && !cs.cities.some((x) => x.city.toLowerCase() === h.city!.toLowerCase())) cs.cities.push({ city: h.city, trips: 0, first: "", byHand: true });
  }
  const countries = [...by.values()].sort((a, b) => Number(b.home) - Number(a.home) || Number(a.byHand) - Number(b.byHand) || (a.first || "9").localeCompare(b.first || "9") || a.name.localeCompare(b.name));
  const cities = countries.reduce((s, c) => s + c.cities.length, 0);
  const abroad = countries.filter((c) => !c.home);
  const year = today.slice(0, 4);
  const thisYear = new Set(trips.filter((t) => t.start.startsWith(year) && t.start <= today).map((t) => t.groupId)).size;
  const tripCount = trips.filter((t) => t.start && t.start <= today).length;

  // Milestones worth showing off.
  const milestones: string[] = [];
  if (abroad.some((c) => !c.byHand)) milestones.push("First trip abroad ✈️");
  if (abroad.length >= 3) milestones.push(`${abroad.length} countries 🌍`);
  for (const c of countries) for (const city of c.cities) if (city.trips >= 3) milestones.push(`${city.city} ×${city.trips} 🔁`);
  if (thisYear >= 3) milestones.push(`${thisYear} trips this year 🔥`);
  if (tripCount >= 10) milestones.push("10 trips club 🏅");

  return { countries, stats: { cities, countries: countries.length, abroad: abroad.length, trips: tripCount, thisYear }, milestones };
}

export const ALL_COUNTRIES = COUNTRIES;
