import { countryOf, tripStops } from "./geo";
import { tripEmoji } from "./countdown";
import { continentOf } from "./continents";
import { DEFAULT_TIME_ZONE, dayKey, isTimeZone } from "./dates";
import { expenseInvolves, leaverCut } from "./left-view";

// Your trip passport, like a real one: every Loopin trip leaves its own stamp
// (a city stamp for a trip in your home country, a round country stamp for a
// trip abroad), and countries you add from before Loopin get their own lighter
// "Been there" stamp, kept apart from the trip ones. The counts are of places,
// not stamps: Italy three times is still one country. Pure.

// undated: the trip has no dates of its own (its day was guessed from the spending), so it adds no "days travelled".
export type PassportTrip = { groupId: string; name: string; start: string; end: string; place: string; country: string; people: number; undated?: boolean };
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
// A badge: earned, or how close you are ("2 of 3").
export type Badge = { id: string; emoji: string; title: string; why: string; earned: boolean; have: number; need: number };
// photo: the country's picture, filled in by the server for the passport's index page (never read from photos.json on the phone).
export type IndexRow = { code: string; name: string; flag: string; home: boolean; trips: number; byHand: boolean; cities: string[]; photo?: string };

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

// The time zone a passport's dates are read in: the owner's own (the default when it isn't a real zone).
export const passportZone = (a?: { timeZone?: string } | null): string => (a?.timeZone && isTimeZone(a.timeZone) ? a.timeZone : DEFAULT_TIME_ZONE);

// Did this person go on the trip? Someone who left the group before the trip's first day (in their own time zone) didn't.
// (No start day, or never left: they did.)
export const wentOnTrip = (start: string, leftAt: Date | null, tz: string): boolean => !leftAt || !start || dayKey(leftAt, tz) >= start;

// The day an undated trip happened: around its latest (non-game) spending, not when the group was made (a flight booked months
// early isn't a stamp yet). The one rule the passport and Home both use. Spending with a chosen day is that day for everyone;
// otherwise the day it was added, in the owner's time zone.
export function undatedTripDay(latest: { spentAt: Date | null; createdAt: Date }, tz: string): string {
  return dayKey(latest.spentAt ?? latest.createdAt, tz);
}

// Is this trip over, as a friend may see it (a trip happening now would say where its owner is today)? With an end day: once that day
// has passed. With a start but no end: 3 days after the later of the start and the latest spending (the same rule as an undated trip),
// so a week-long trip with the end left blank isn't shown from its second day (SB-14). With no dates: 3 days after the latest
// spending, or straight away when there is none. `spendingDay`: the day of the latest spending the owner may see, if any.
export function tripOver(trip: { tripStart: string; tripEnd: string }, spendingDay: string | undefined, today: string): boolean {
  if (trip.tripEnd) return trip.tripEnd < today;
  const after3 = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10) < today;
  if (trip.tripStart) return after3(spendingDay && spendingDay > trip.tripStart ? spendingDay : trip.tripStart);
  return !spendingDay || after3(spendingDay);
}

export type SpendingRow = {
  createdAt: Date;
  spentAt: Date | null;
  deletedAt: Date | null;
  kind: string;
  id?: string;
  paidById: string;
  payers?: string | null;
  shares: { memberId: string }[];
};

// What an undated trip's stamp rests on: the spending this person may see (not deleted, not a card-game result, and, for someone who
// left, added on or before the day they left or with them in it), how many rows there are and the day of the latest. Null when none.
// Pure: the database version (passport-db.ts) asks the same question with a count and a findFirst.
export function undatedFacts(
  rows: SpendingRow[],
  me: { id: string; leftAt: Date | null; removedAt?: Date | null },
  tz: string,
): { count: number; day: string } | null {
  const cut = leaverCut(me);
  const kept = rows.filter(
    (r) => !r.deletedAt && r.kind !== "pot" && (!cut || r.createdAt.getTime() <= cut.leftAt.getTime() || expenseInvolves({ id: r.id ?? "", createdAt: r.createdAt, paidById: r.paidById, payers: r.payers, shares: r.shares }, me.id)),
  );
  if (!kept.length) return null;
  const latest = [...kept].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (b.id ?? "").localeCompare(a.id ?? ""))[0];
  return { count: kept.length, day: undatedTripDay(latest, tz) };
}

// The day a group's stamp is dated, or null when it earns none: not a trip, deleted, not started yet (or, with no dates, nothing
// spent yet), or this person left before the trip began. A trip with dates is stamped on its start day; one without, on the day of
// its latest spending (`undated`, from undatedFacts). Pure, and the one rule Home and the passport both use.
export function stampDay(
  g: { type: string; deletedAt: Date | null; tripStart: string; leftAt: Date | null; undated: { count: number; day: string } | null },
  today: string,
  tz: string,
): string | null {
  if (g.type !== "trip" || g.deletedAt) return null;
  if (g.tripStart) return g.tripStart > today || !wentOnTrip(g.tripStart, g.leftAt, tz) ? null : g.tripStart;
  return g.undated?.count ? g.undated.day : null;
}

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
    continents: new Set(rows.map((r) => continentOf(r.code)).filter(Boolean)).size,
  };
  const marks = passportMarks(stats, abroad.some((r) => r.trips > 0 || r.byHand));

  // Milestones worth showing off.
  const milestones: string[] = [];
  if (abroad.some((r) => r.trips > 0)) milestones.push("First trip abroad");
  const top = (ladder: Mark["ladder"]) => marks.filter((m) => m.ladder === ladder).pop();
  const countriesMark = top("countries");
  if (countriesMark) milestones.push(countriesMark.chip);
  else if (abroad.length >= 3) milestones.push(`${abroad.length} countries abroad`);
  const continentsMark = top("continents");
  if (continentsMark && continentsMark.n >= 3) milestones.push(continentsMark.chip);
  for (const r of rows) for (const city of r.cities) {
    const n = cityTrips.get(`${r.code}|${city.toLowerCase()}`) ?? 0;
    if (n >= 3) milestones.push(`${city} ×${n}`);
  }
  if (stats.thisYear >= 3) milestones.push(`${stats.thisYear} trips this year`);
  if (stats.trips >= 10) milestones.push("10 trips club");

  // Badges: about where you go and how, never about money.
  const mood = (t: PassportTrip) => tripEmoji(`${t.name} ${t.place}`);
  const count = (f: (t: PassportTrip) => boolean) => started.filter(f).length;
  const abroadTrips = started.filter((t) => {
    const stops = tripStops(t.name, t.place, t.country);
    return stops.some((x) => (x.country || home) && (x.country || home).toUpperCase() !== home);
  }).length;
  const badge = (id: string, emoji: string, title: string, why: string, have: number, need: number): Badge => ({ id, emoji, title, why, earned: have >= need, have: Math.min(have, need), need });
  const badges: Badge[] = [
    badge("first-abroad", "✈️", "First trip abroad", "A trip abroad with Loopin", abroadTrips, 1),
    badge("beach", "🏖️", "Beach bum", "3 beach trips", count((t) => mood(t) === "🌴"), 3),
    badge("hills", "🏔️", "Mountain goat", "3 trips to the hills or snow", count((t) => ["🏔️", "❄️", "🏕️"].includes(mood(t))), 3),
    badge("city", "🌆", "City slicker", "3 big-city trips", count((t) => mood(t) === "🌆"), 3),
    badge("cities", "🏙️", "10 cities club", "10 different cities", stats.cities, 10),
    badge("countries", "🌍", "Globetrotter", "10 countries", rows.length, 10),
    badge("frequent", "🛫", "Frequent flyer", "5 trips abroad", abroadTrips, 5),
    badge("year", "🔥", "On a roll", "3 trips in one year", stats.thisYear, 3),
    badge("trips", "🏅", "10 trips club", "10 trips with Loopin", stats.trips, 10),
  ];

  return { stamps, been, index: rows, stats, milestones, badges, marks };
}

// The numbers of one passport, worked out once. The stats row, the book's cover and first page, and the share picture all read
// this one object, so they can never disagree. `countries` counts places (Italy three times is one), `trips` the trips that have
// started, `days` the distinct days of those trips (overlaps count once), `stamps` what is drawn in the book (trip stamps plus
// "Been there" ones), `cities` the different cities. Pure.
export type PassportCounts = { countries: number; trips: number; days: number; stamps: number; cities: number };
export function passportCounts(p: { trips: { start: string; end: string; undated?: boolean }[]; stamps: unknown[]; been: unknown[]; stats: { countries: number; trips: number; cities: number } }, today: string): PassportCounts {
  return { countries: p.stats.countries, trips: p.stats.trips, days: daysAway(p.trips, today), stamps: p.stamps.length + p.been.length, cities: p.stats.cities };
}

// Which badges to show: the ones earned, plus the next one to win (the unearned one closest to done; a tie goes to the first in the
// list). No wall of "0 of 3": once everything is earned, only the earned ones show. Pure.
export function visibleBadges(badges: Badge[]): Badge[] {
  const next = badges
    .filter((b) => !b.earned)
    .sort((a, b) => b.have / b.need - a.have / a.need)[0];
  return badges.filter((b) => b.earned || b === next);
}

const DAY_MS = 86_400_000;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const dayNo = (s: string) => Math.round(Date.parse(`${s}T00:00:00Z`) / DAY_MS);

// How many days a trip lasts, both ends counted: 5–10 May is 6. No end date: 1. Not dated: 0.
export function tripDays(start: string, end: string): number {
  if (!isDay(start)) return 0;
  if (!isDay(end) || end <= start) return 1;
  return Math.min(366, dayNo(end) - dayNo(start) + 1);
}

// "Days travelled": the distinct days of the trips that have started, the whole trip (a 5-day trip on its second day is 5, so the
// number never sits below the card it is above). Trips that overlap count each day once; a trip without dates counts 0, a trip
// with no end date 1; a trip that hasn't started counts 0. Pure.
export function daysAway(trips: { start: string; end: string; undated?: boolean }[], today: string): number {
  const days = new Set<number>();
  for (const t of trips) {
    if (t.undated || !isDay(t.start) || t.start > today) continue;
    const last = isDay(t.end) && t.end > t.start ? t.end : t.start;
    const from = dayNo(t.start);
    const to = Math.min(dayNo(last), from + 365);
    for (let d = from; d <= to; d++) days.add(d);
  }
  return days.size;
}

// Passport moments: crossing 5, 10, 25… countries, a new continent, 10 cities.
// Each has an id so it's celebrated once (an alert), never again. Never about money.
export type Mark = { id: string; ladder: "abroad" | "countries" | "continents" | "cities" | "trips"; n: number; chip: string; title: string; body: string };
const LADDERS = {
  countries: [5, 10, 15, 20, 25, 30, 40, 50, 75, 100],
  continents: [2, 3, 4, 5, 6, 7],
  cities: [10, 25, 50, 100],
  trips: [5, 10, 25, 50, 100],
};
export function passportMarks(stats: { countries: number; continents: number; cities: number; trips: number }, beenAbroad: boolean): Mark[] {
  const out: Mark[] = [];
  if (beenAbroad) out.push({ id: "abroad-1", ladder: "abroad", n: 1, chip: "Been abroad", title: "Your first stamp from abroad", body: "Your passport has its first country beyond home. Open it to see the stamp." });
  for (const n of LADDERS.countries.filter((x) => stats.countries >= x))
    out.push({ id: `countries-${n}`, ladder: "countries", n, chip: `${n} countries`, title: `${n} countries`, body: `Your passport just reached ${n} countries. Open it to see every stamp.` });
  for (const n of LADDERS.continents.filter((x) => stats.continents >= x))
    out.push({ id: `continents-${n}`, ladder: "continents", n, chip: `${n} continents`, title: n === 7 ? "All seven continents" : `${n} continents`, body: n === 7 ? "Every continent on Earth. Very few passports can say that." : `You’ve now been to ${n} continents. Your map is filling in.` });
  for (const n of LADDERS.cities.filter((x) => stats.cities >= x))
    out.push({ id: `cities-${n}`, ladder: "cities", n, chip: `${n} cities`, title: `${n} cities`, body: `${n} different cities on your Loopin trips. Open your passport to see them all.` });
  for (const n of LADDERS.trips.filter((x) => stats.trips >= x))
    out.push({ id: `trips-${n}`, ladder: "trips", n, chip: `${n} trips`, title: `${n} trips with Loopin`, body: `That’s ${n} trips split and settled. Here’s to the next one.` });
  return out;
}

// Of the moments just reached, the one worth an alert: the rarest (continents,
// then countries, then the rest), the biggest number first.
export function newestMark(marks: Mark[], seen: Set<string>): Mark | undefined {
  const rank = { continents: 0, countries: 1, abroad: 2, cities: 3, trips: 4 } as const;
  return marks.filter((m) => !seen.has(m.id)).sort((a, b) => rank[a.ladder] - rank[b.ladder] || b.n - a.n)[0];
}

// The booklet's pages, a few stamps each. "Stamps" holds the country stamps only (trips abroad first, then the lighter Been there
// ones, on the same run of pages). Trips in your home country (the city stamps) follow on their own pages, "Trips at home · <country>".
// `homeName`: null leaves the home pages out (what a friend and the share picture see: countries only). Pure.
export type StampPage = { title: string; stamps: Stamp[] };
export function stampPages(stamps: Stamp[], been: Stamp[], per = 6, homeName?: string | null): StampPage[] {
  const countries = [...stamps.filter((s) => s.kind === "country"), ...been];
  const pages: StampPage[] = [];
  for (let i = 0; i < countries.length; i += per) pages.push({ title: "Stamps", stamps: countries.slice(i, i + per) });
  if (homeName === null) return pages;
  const home = stamps.filter((s) => s.kind === "city");
  const title = homeName ? `Trips at home · ${homeName}` : "Trips at home";
  for (let i = 0; i < home.length; i += per) pages.push({ title, stamps: home.slice(i, i + per) });
  return pages;
}

// The stamps the share picture holds, newest trips first, then Been there: country stamps only, never a city stamp from a trip at
// home. (The picture says "Stamps"; the home trips live on their own pages of the book.) Pure.
export function shareStamps(stamps: Stamp[], been: Stamp[]): Stamp[] {
  return [...[...stamps].reverse().filter((s) => s.kind === "country"), ...been];
}


// Is this account's passport open to people in its groups? Only if the owner said yes:
// "no recorded choice" (passportChoiceAt empty) counts as hidden, and so does an explicit
// "private". Accounts from before the question existed have no recorded choice, so they
// stay hidden until they answer.
export function passportShared(a: { passportShare: string; passportChoiceAt: Date | null | undefined }): boolean {
  return a.passportShare !== "private" && Boolean(a.passportChoiceAt);
}

// The little lock label next to "Your stamps": the real setting, in the same words everywhere.
export function passportLockLabel(a: { passportShare: string; passportChoiceAt: Date | null | undefined }): "Your groups" | "Only you" {
  return passportShared(a) ? "Your groups" : "Only you";
}

// Should /passport still ask "Show your places to people in your groups?" Only when there is no
// recorded answer. Someone who had already switched it off ("private") has answered: not asked again.
export function passportNeedsAnswer(a: { passportShare: string; passportChoiceAt: Date | null | undefined }): boolean {
  return !a.passportChoiceAt && a.passportShare !== "private";
}
