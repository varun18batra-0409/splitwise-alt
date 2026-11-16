import { climateFor, tripMonth, weatherWords } from "../climate";
import type { TripPhase } from "../countdown";
import type { Season } from "./banner";

// The sliding row on Home (founder, 16 Nov: ONE row; the separate "Before you go" section is gone). Pure, so tests can check it.
// In this order, each only when it has something to say:
//  1. The usual weather for your next trip (beforeYouGo: the soonest trip that has not started; while on a trip, the next one's). No such trip with known weather: no card.
//  2. Your month in numbers.
//  3. A bill due in the next 5 days (right after the month).
//  4. A postcard: "A postcard is waiting" when some are, otherwise the "Send a postcard" card (real photo and keepsake when we have the photo).
//  5. Your trip passport ("N countries and counting", "1 country and counting" / "Where have you been?" with none), with your own stamps.
//  6. The festival or holiday for the visitor's country, only inside its dates (seasonNow in banner.ts).
// Memories is its own section on Home, not a card here. No trip photos, "just back" or group cards.

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
      art: "postcard" | "bill" | "festive" | "passport" | "sun" | "rain" | "cloud" | "snow";
      photo?: string; // a real photo fills the card behind a dark wash (the passport and postcard cards)
      scene?: boolean;
      // The object on top of that photo: a passport with your own stamps, a postcard with a photo taped on.
      keepsake?: { kind: "passport"; stamps: KeepsakeStamp[] } | { kind: "postcard"; photo?: string };
    };

// A stamp on the Home passport card: one of your own countries abroad and the month you went ("" = ticked by hand).
export type KeepsakeStamp = { code: string; country: string; when: string; byHand?: boolean };

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
  // The weather for the next trip (from beforeYouGo), null/none: no weather card.
  weather?: BeforeYouGo | null;
  passportCountries?: number;
  passportAbroad?: number; // of those, outside your home country
  // Real photos for the passport and postcard cards; none: the drawn art stays. stamps: your latest countries abroad (at most 2).
  scenes?: { passport?: string; postcards?: string; stamps?: KeepsakeStamp[]; postcardPhoto?: string };
};

const when = (days: number) => (days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`);
const place = (t: HighlightTrip) => t.stops.find((s) => s.city)?.city || t.name;

// The sliding cards, in the order described at the top. Between 1 and 6; never a card with nothing to say.
export function homeHighlights(x: HighlightInput): Highlight[] {
  const out: Highlight[] = [];

  // 1. The usual weather for your next trip.
  if (x.weather)
    out.push({ id: `weather-${x.weather.id}`, kind: "card", tone: "teal", eyebrow: x.weather.eyebrow, title: x.weather.title, text: x.weather.text, button: x.weather.button, href: x.weather.href, art: x.weather.icon });

  // 2. Your month in numbers.
  if (x.hasMonth) out.push({ id: "month", kind: "month" });

  // 3. A bill due in the next few days.
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

  // 4. A postcard: the ones waiting for you, else the invitation to send one.
  const postcardPhoto = x.scenes?.postcards
    ? { photo: x.scenes.postcards, scene: true, keepsake: { kind: "postcard" as const, photo: x.scenes.postcardPhoto } }
    : {};
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
      ...postcardPhoto,
    });
  else
    out.push({
      id: "fill-postcard",
      kind: "card",
      tone: "rose",
      eyebrow: "Postcards",
      title: "Send a postcard",
      text: "A trip photo, a real-looking stamp and a wax seal. In Loopin or on WhatsApp.",
      button: "Write one",
      href: "/postcards/new",
      art: "postcard",
      ...postcardPhoto,
    });

  // 5. Your trip passport, with your own stamps.
  const n = x.passportCountries ?? 0;
  out.push({
    id: "fill-passport",
    kind: "card",
    tone: "teal",
    eyebrow: "Your trip passport",
    title: n > 1 ? `${n} countries and counting` : n === 1 ? "1 country and counting" : "Where have you been?",
    text:
      n >= 1
        ? `${x.passportAbroad !== undefined && x.passportAbroad < n ? `${x.passportAbroad} abroad, plus home. ` : ""}Flip through your stamps, or see where friends who share theirs have been.`
        : "Tick the countries you’ve been to and get your stamps.",
    button: "Open your passport",
    href: "/passport",
    art: "passport",
    ...(x.scenes?.passport ? { photo: x.scenes.passport, scene: true, keepsake: { kind: "passport" as const, stamps: (x.scenes.stamps ?? []).slice(0, 2) } } : {}),
  });

  // 6. The festival or season for where you are, only inside its dates (the drawn lantern, never a trip photo).
  if (x.season)
    out.push({ id: `season-${x.season.id}`, kind: "card", tone: "rose", eyebrow: x.season.eyebrow, title: x.season.title, text: x.season.text, button: x.season.button, href: x.season.href, art: "festive" });

  return out;
}

// "Before you go": the soonest trip that has not started (phase "before", earliest start, no day limit), with its usual weather on those dates.
// A trip that is under way is skipped; so is one whose climate we don't know (the next is tried). None left: null, and Home shows no weather card.
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
// homeCountry ("IN"): a trip inside it is headed by the place ("GOA · SEASONAL WEATHER"), not the country ("INDIA").
export function beforeYouGo(trips: HighlightTrip[], fahrenheit = false, homeCountry = ""): BeforeYouGo | null {
  const upcoming = trips.filter((t) => t.phase.kind === "before" && t.start).sort((a, b) => a.start.localeCompare(b.start));
  for (const t of upcoming) {
    const stop = t.stops[0];
    const c = stop ? climateFor(stop.city, stop.country, tripMonth(t.start, t.end)) : null;
    if (!c) continue;
    const w = weatherWords(c, fahrenheit);
    const athome = Boolean(homeCountry) && (stop?.country ?? "").toUpperCase() === homeCountry.toUpperCase();
    return {
      id: t.id,
      eyebrow: `${(!athome && t.countryName) || place(t)} · SEASONAL WEATHER`.toUpperCase(),
      title: w.temps,
      text: `${typically(w.sky)} ${w.tip}`,
      href: `/groups/${t.id}`,
      button: "Open the trip",
      icon: w.icon as BeforeYouGo["icon"],
    };
  }
  return null;
}
