import { countryOf } from "./geo";
import { daysAway, tripDays, type PassportTrip, type Stamp } from "./passport";

// The "Been" tab of the passport: one card per trip (newest first), then one small card for each
// country added by hand. Pure: the page draws it, this decides what it says.

export type TripExtras = {
  names: string[]; // first names of other people who went (up to 3)
  moments?: number; // moments you can see in that group (the Moments part fills this in)
};

export type BeenCardData = {
  id: string;
  kind: "trip" | "hand";
  title: string; // "Thailand", "Goa", or a long one in full ("Thiruvananthapuram · Kanyakumari")
  cities: string[]; // abroad: the cities that trip went to
  code: string;
  flag: string;
  groupId?: string;
  groupName: string; // for choosing the picture
  place: string; // "Where to?" as typed, for choosing the picture
  dates: string; // "5–10 May 2026" ("" for a country added by hand or a trip without dates)
  days: number; // 0 = not shown
  people: number;
  initials: string[]; // up to 3
  peopleLabel: string; // under the big card: "6 people, one good trip"
  friendsLabel: string; // on a small card: "With 3 friends"
  reliveHref?: string;
  momentsHref?: string;
  stamp: Stamp; // the one drawn on the photo: the place and the month
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1] ?? ""}`;

// Written by hand, so the phone and the server always agree.
// 5–10 May 2026 · 28 Feb – 1 Mar 2026 · 30 Dec 2026 – 2 Jan 2027 · 5 May 2026 (one day).
export function tripDates(start: string, end: string): string {
  if (!ok(start)) return "";
  const y = start.slice(0, 4);
  if (!ok(end) || end <= start) return `${dm(start)} ${y}`;
  if (end.slice(0, 4) !== y) return `${dm(start)} ${y} – ${dm(end)} ${end.slice(0, 4)}`;
  if (end.slice(5, 7) === start.slice(5, 7)) return `${Number(start.slice(8, 10))}–${dm(end)} ${y}`;
  return `${dm(start)} – ${dm(end)} ${y}`;
}

const initialOf = (name: string) => ([...name.trim()][0] ?? "").toUpperCase();

// The number row. Anything that is 0 is left out.
// With a trip still going, the days are counted up to today only; the label stays short ("days away") so it fits one line at 320 px.
export function beenStats(countries: number, trips: number, days: number, _inProgress = false): { n: number; label: string }[] {
  void _inProgress;
  return [
    { n: countries, label: countries === 1 ? "country" : "countries" },
    { n: trips, label: trips === 1 ? "trip" : "trips" },
    { n: days, label: days === 1 ? "day away" : "days away" },
  ].filter((s) => s.n > 0);
}

export function beenCards(
  p: { trips: PassportTrip[]; stamps: Stamp[]; been: Stamp[]; stats: { countries: number; trips: number } },
  extras: Record<string, TripExtras> = {},
  today: string,
): { stats: { n: number; label: string }[]; cards: BeenCardData[] } {
  const cards: BeenCardData[] = [];
  // A trip that has started has stamps; a trip still to come has none and no card.
  const trips = p.trips
    .filter((t) => p.stamps.some((s) => s.groupId === t.groupId))
    .sort((a, b) => b.start.localeCompare(a.start) || a.groupId.localeCompare(b.groupId));
  for (const t of trips) {
    const own = p.stamps.filter((s) => s.groupId === t.groupId);
    const first = own[0];
    const code = first.code;
    const country = countryOf(code)?.name ?? code;
    const abroad = own.filter((s) => s.kind === "country");
    // Abroad: the country (or countries) and the cities under it. At home: the cities themselves.
    const title = abroad.length ? abroad.map((s) => s.name).join(" · ") : own.map((s) => s.name).join(" · ");
    const cities = abroad.length ? abroad.flatMap((s) => s.cities) : [];
    const x = extras[t.groupId];
    const names = (x?.names ?? []).slice(0, 3);
    const days = t.undated ? 0 : tripDays(t.start, t.end);
    const others = Math.max(0, t.people - 1);
    cards.push({
      id: t.groupId,
      kind: "trip",
      title,
      cities,
      code,
      flag: first.flag,
      groupId: t.groupId,
      groupName: t.name,
      place: t.place,
      dates: t.undated ? "" : tripDates(t.start, t.end),
      days,
      people: t.people,
      initials: names.map(initialOf).filter(Boolean),
      peopleLabel: t.people > 1 ? `${t.people} people, one good trip` : "Just you",
      friendsLabel: others > 0 ? `With ${others} ${others === 1 ? "friend" : "friends"}` : "Just you",
      reliveHref: `/groups/${t.groupId}/report`,
      momentsHref: x?.moments ? `/groups/${t.groupId}/moments` : undefined,
      // Abroad: the country's stamp. At home: the city's own stamp (PUNE, GOA), as "Trips here get city stamps" says.
      stamp: abroad.length ? { id: `card-${t.groupId}`, kind: "country", code, name: country, flag: first.flag, when: t.start, cities: [], groupId: t.groupId, byHand: false } : { ...first, id: `card-${t.groupId}`, when: t.start },
    });
  }
  // Countries added by hand: no dates, no Relive.
  for (const s of p.been) {
    cards.push({
      id: s.id,
      kind: "hand",
      title: s.name,
      cities: [],
      code: s.code,
      flag: s.flag,
      groupName: s.name,
      place: "",
      dates: "",
      days: 0,
      people: 0,
      initials: [],
      peopleLabel: "",
      friendsLabel: "",
      stamp: s,
    });
  }
  const inProgress = p.trips.some((t) => !t.undated && ok(t.start) && t.start <= today && ok(t.end) && t.end > today);
  return { stats: beenStats(p.stats.countries, p.stats.trips, daysAway(p.trips, today), inProgress), cards };
}

// The first few cards, with the rest behind "See all".
export function shownCards<T>(cards: T[], all: boolean, max = 6): { shown: T[]; hidden: number } {
  if (all || cards.length <= max) return { shown: cards, hidden: 0 };
  return { shown: cards.slice(0, max), hidden: cards.length - max };
}

// A title never breaks inside a word: it wraps only at spaces and "·". When its longest word would be wider than the line, the type
// steps down (never below `min` px) for that card. `cqw` is a share of the width of the title's own box (a container), so the same
// number works at 320 and at 390. 0.6 em is a generous width for one letter of the display type.
export function titleFit(title: string, max: number, min = 14): string {
  const longest = Math.max(1, ...title.split(/[\s·]+/).map((w) => [...w].length));
  const cqw = Math.floor((100 / (longest * 0.6)) * 10) / 10;
  return `max(${min}px, min(${max}px, ${cqw}cqw))`;
}
