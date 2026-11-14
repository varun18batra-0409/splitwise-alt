import { countryOf } from "./geo";
import { passportCounts, tripDays, type PassportTrip, type Stamp } from "./passport";
import { cardPhoto } from "./country-photos";

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
  dates: string; // "5–10 May" (no year: the stamp has it; "" for a country added by hand or a trip without dates)
  days: number; // 0 = not shown
  people: number;
  countryName: string; // the stamp always names the country: a trip to Goa is "INDIA / MAR 2026"
  stampWhen: string; // the trip's start day ("" = been there)
  cta?: { label: "Relive trip" | "View memories"; href: string }; // the one button; none for a country added by hand
  photo?: string; // the picture on the left; none = the drawn stamp on cream paper
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

// The same without the year, for a card (the stamp carries it): 5–10 May · 28 Feb – 1 Mar · 30 Dec – 2 Jan · 5 May.
export function tripDatesShort(start: string, end: string): string {
  if (!ok(start)) return "";
  if (!ok(end) || end <= start) return dm(start);
  if (end.slice(0, 4) === start.slice(0, 4) && end.slice(5, 7) === start.slice(5, 7)) return `${Number(start.slice(8, 10))}–${dm(end)}`;
  return `${dm(start)} – ${dm(end)}`;
}

// The number row. Anything that is 0 is left out.
// The days are the real total of trip days (a trip that has started counts all its days); the label stays short so it fits one line at 320 px.
export function beenStats(countries: number, trips: number, days: number, _inProgress = false): { n: number; label: string }[] {
  void _inProgress;
  return [
    { n: countries, label: countries === 1 ? "country" : "countries" },
    { n: trips, label: trips === 1 ? "trip" : "trips" },
    { n: days, label: days === 1 ? "day travelled" : "days travelled" },
  ].filter((s) => s.n > 0);
}

export function beenCards(
  p: { trips: PassportTrip[]; stamps: Stamp[]; been: Stamp[]; stats: { countries: number; trips: number; cities?: number } },
  extras: Record<string, TripExtras> = {},
  today: string,
  have?: Record<string, { src: string } | undefined>, // the downloaded photos (tests hand in their own)
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
    const days = t.undated ? 0 : tripDays(t.start, t.end);
    const card: BeenCardData = {
      id: t.groupId,
      kind: "trip",
      title,
      cities,
      code,
      flag: first.flag,
      groupId: t.groupId,
      groupName: t.name,
      place: t.place,
      dates: t.undated ? "" : tripDatesShort(t.start, t.end),
      days,
      people: t.people,
      countryName: country,
      stampWhen: t.start,
      // One button: your moments if there are any to see, otherwise the trip's story.
      cta: x?.moments ? { label: "View memories", href: `/groups/${t.groupId}/moments` } : { label: "Relive trip", href: `/groups/${t.groupId}/report` },
    };
    card.photo = cardPhoto(card, have);
    cards.push(card);
  }
  // Countries added by hand: no dates, no button; only a photo that is really that country.
  for (const s of p.been) {
    const card: BeenCardData = { id: s.id, kind: "hand", title: s.name, cities: [], code: s.code, flag: s.flag, groupName: s.name, place: "", dates: "", days: 0, people: 0, countryName: s.name, stampWhen: "" };
    card.photo = cardPhoto(card, have);
    cards.push(card);
  }
  const c = passportCounts({ trips: p.trips, stamps: p.stamps, been: p.been, stats: { countries: p.stats.countries, trips: p.stats.trips, cities: p.stats.cities ?? 0 } }, today);
  return { stats: beenStats(c.countries, c.trips, c.days), cards };
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
