import { climateFor, tripMonth, weatherWords } from "../climate";
import type { TripPhase } from "../countdown";
import type { Season } from "./banner";

// The bottom of Home (founder, 15 Nov). Two things, both pure so tests can check them:
// 1. "Before you go": ONE card for the soonest trip that has not started, with its usual weather (beforeYouGo).
// 2. The sliding cards under it, now only the useful ones: new postcards waiting, a bill due soon, and your month in numbers (homeHighlights).
// Plus the festival card for where you are (Diwali, Christmas, New Year, Eid…: seasonNow in banner.ts; founder, 15 Nov: keep it, region-specific).
// No trip photos, passport or postcard fillers or "just back" cards any more. Nothing useful: no card, and no row.

export type HighlightTone = "rose" | "teal";
export type Highlight =
  | { id: string; kind: "month" }
  | {
      id: string;
      kind: "card";
      tone: HighlightTone;
      eyebrow: string;
      title: string;
      text: string;
      button: string;
      href: string;
      art: "postcard" | "bill" | "festive";
    };

export type HighlightTrip = {
  id: string;
  name: string; // "Goa"
  phase: TripPhase;
  start: string; // "2026-11-22"
  end?: string | null;
  stops: { city: string; country: string }[];
  countryName?: string; // "Thailand", for the card's small heading; none known: the place
};

export type HighlightInput = {
  hasMonth: boolean;
  postcardsNew: number;
  billsDue: { groupId: string; billId: string; name: string; group: string; inDays: number; amount: string }[];
  // The festival or season card for this visitor's country and today's date (null: none now).
  season?: Pick<Season, "id" | "eyebrow" | "title" | "text" | "button" | "href"> | null;
};

const when = (days: number) => (days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`);
const place = (t: HighlightTrip) => t.stops.find((s) => s.city)?.city || t.name;

// The sliding cards: postcards first, then a bill due in the next few days, then the festival card, then the month. Between 0 and 4; never a card with nothing to say.
export function homeHighlights(x: HighlightInput): Highlight[] {
  const out: Highlight[] = [];

  // 1. Postcards waiting for you.
  if (x.postcardsNew > 0)
    out.push({
      id: "postcards",
      kind: "card",
      tone: "rose",
      eyebrow: "In your letterbox",
      title: x.postcardsNew === 1 ? "A postcard is waiting" : `${x.postcardsNew} postcards are waiting`,
      text: x.postcardsNew === 1 ? "Turn it over, read it, and press a wax seal back on it." : "Turn them over, read them, and press a wax seal back on each.",
      button: "Open your postcards",
      href: "/postcards",
      art: "postcard",
    });

  // 2. A bill due in the next few days.
  const bill = [...x.billsDue].filter((b) => b.inDays >= 0 && b.inDays <= 5).sort((a, b) => a.inDays - b.inDays)[0];
  if (bill)
    out.push({
      id: `bill-${bill.billId}`,
      kind: "card",
      tone: "teal",
      eyebrow: bill.group,
      title: `${bill.name} is due ${when(bill.inDays)}`,
      text: bill.amount ? `${bill.amount}. Loopin adds it on the day and tells everyone their share.` : "Enter the amount when the bill comes, and everyone sees their share.",
      button: "See the bill",
      href: `/groups/${bill.groupId}/bills/${bill.billId}`,
      art: "bill",
    });

  // 3. The festival or season coming up where you are (drawn art, never a trip photo).
  if (x.season)
    out.push({ id: `season-${x.season.id}`, kind: "card", tone: "rose", eyebrow: x.season.eyebrow, title: x.season.title, text: x.season.text, button: x.season.button, href: x.season.href, art: "festive" });

  // 4. Your month in numbers.
  if (x.hasMonth) out.push({ id: "month", kind: "month" });

  return out;
}

// "Before you go": the soonest trip that has not started (phase "before", earliest start, no day limit), with its usual weather on those dates.
// A trip that is under way is skipped; so is one whose climate we don't know (the next is tried). None left: null, and Home shows no section.
export type BeforeYouGo = {
  id: string; // the trip's group id
  eyebrow: string; // "THAILAND · SEASONAL WEATHER"
  title: string; // "Usually 31° by day, 22° at night"
  text: string; // "Typically dry and sunny. Pack sunscreen, sunglasses and a water bottle."
  href: string;
  button: string;
  icon: "sun" | "rain" | "cloud" | "snow";
};

// "Dry and sunny." reads "Typically dry and sunny."; the rainy lines already say what to expect and stay as they are.
const typically = (sky: string) => sky.replace(/^Dry and/, "Typically dry and").replace(/^Mostly dry/, "Typically dry");
export function beforeYouGo(trips: HighlightTrip[], fahrenheit = false): BeforeYouGo | null {
  const upcoming = trips.filter((t) => t.phase.kind === "before" && t.start).sort((a, b) => a.start.localeCompare(b.start));
  for (const t of upcoming) {
    const stop = t.stops[0];
    const c = stop ? climateFor(stop.city, stop.country, tripMonth(t.start, t.end)) : null;
    if (!c) continue;
    const w = weatherWords(c, fahrenheit);
    return {
      id: t.id,
      eyebrow: `${t.countryName || place(t)} · SEASONAL WEATHER`.toUpperCase(),
      title: w.temps,
      text: `${typically(w.sky)} ${w.tip}`,
      href: `/groups/${t.id}`,
      button: "Open the trip",
      icon: w.icon as BeforeYouGo["icon"],
    };
  }
  return null;
}
