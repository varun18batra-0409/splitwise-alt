import { climateFor, tripMonth, weatherWords } from "../climate";
import { happeningsFor } from "../happenings";
import type { TripPhase } from "../countdown";
import type { Season } from "./banner";
import type { CoverId } from "../covers";

// The cards that slide by at the top of Home, picked for you: what's useful
// right now comes first (the trip you're on, the next trip's weather and
// what's on there, a trip just over, postcards waiting, a bill due), then your
// month, a festival where you live, and a few always-good ones to fill in.
// Between 4 and 7 cards; never a card with nothing to say.

export type HighlightTone = "trip" | "sky" | "warm" | "teal" | "rose" | "night" | "paper";
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
      photo?: string; // a place photo on the right
      cover?: CoverId; // or one of Loopin's own pictures
      art?: "sun" | "rain" | "cloud" | "snow" | "postcard" | "passport" | "switch" | "bill";
    };

export type HighlightTrip = {
  id: string;
  name: string; // "Goa"
  phase: TripPhase;
  start: string; // "2026-11-22"
  end?: string | null;
  stops: { city: string; country: string }[];
  photo?: string;
  photo2?: string; // a second photo of the place
  todaySpent?: string; // "₹4,200" while on the trip
};

export type HighlightInput = {
  trips: HighlightTrip[]; // coming up (within a year) or happening, soonest first
  justBack: { id: string; name: string; endedDaysAgo: number; payments: number; photo?: string; abroad: boolean }[];
  hasMonth: boolean;
  season: Season | null;
  postcardsNew: number;
  billsDue: { groupId: string; billId: string; name: string; group: string; inDays: number; amount: string }[];
  passportCountries: number;
  groups: number;
  fahrenheit?: boolean;
  max?: number;
};

const when = (days: number) => (days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`);
const place = (t: HighlightTrip) => t.stops.find((s) => s.city)?.city || t.name;

export function homeHighlights(x: HighlightInput): Highlight[] {
  const max = Math.min(7, Math.max(4, x.max ?? 7));
  const out: Highlight[] = [];
  const add = (h: Highlight | null | false | undefined) => {
    if (h && out.length < max && !out.some((o) => o.id === h.id)) out.push(h);
  };

  // 1. The trip you're on: today there, and a postcard from it.
  for (const t of x.trips.filter((t) => t.phase.kind === "today" || t.phase.kind === "during").slice(0, 2)) {
    const day = t.phase.kind === "during" ? t.phase.day : 1;
    const where = place(t);
    add({
      id: `on-${t.id}`,
      kind: "card",
      tone: "trip",
      eyebrow: `Day ${day} in ${where}`,
      title: t.todaySpent ? `${t.todaySpent} spent today` : "Wish they were here?",
      text: t.todaySpent ? "Send a postcard from here: your photo, a stamp and a wax seal." : "Turn today’s photo into a postcard, with a stamp and a wax seal.",
      button: "Send a postcard",
      href: `/postcards/new?group=${t.id}`,
      photo: t.photo,
    });
  }

  // 2. The next trips: the usual weather on those dates, and what's on there.
  const coming = x.trips.filter((t) => t.phase.kind === "before" && t.phase.days <= 60).slice(0, 2);
  for (const [i, t] of coming.entries()) {
    if (t.phase.kind !== "before") continue;
    const stop = t.stops[0];
    const c = stop ? climateFor(stop.city, stop.country, tripMonth(t.start, t.end)) : null;
    const where = place(t);
    if (c) {
      const w = weatherWords(c, x.fahrenheit);
      add({
        id: `weather-${t.id}`,
        kind: "card",
        tone: "sky",
        eyebrow: `${where} ${when(t.phase.days)}`,
        title: w.temps,
        text: `${w.sky} ${w.tip}`,
        button: "Open the trip",
        href: `/groups/${t.id}`,
        photo: t.photo,
        art: w.icon as "sun" | "rain" | "cloud" | "snow",
      });
    }
    const on = happeningsFor(t.stops, t.start, t.end, 1)[0];
    if (on)
      add({
        id: `on-there-${t.id}`,
        kind: "card",
        tone: "night",
        eyebrow: `While you’re in ${where}`,
        title: on.name,
        text: on.line,
        button: "Open the trip",
        href: `/groups/${t.id}`,
        photo: c ? t.photo2 ?? t.photo : t.photo,
      });
    if (i === 0 && !c && !on) {
      // A trip we know nothing about the weather of still gets a nudge to plan.
      add({ id: `plan-${t.id}`, kind: "card", tone: "trip", eyebrow: `${where} ${when(t.phase.days)}`, title: "Who’s booking what?", text: "Add the stays and tickets as they’re booked, so nobody pays twice.", button: "Open the trip", href: `/groups/${t.id}`, photo: t.photo });
    }
  }

  // 3. A trip just over: square up, then the new stamp.
  for (const b of x.justBack.slice(0, 1)) {
    if (b.payments > 0)
      add({
        id: `back-${b.id}`,
        kind: "card",
        tone: "warm",
        eyebrow: b.endedDaysAgo <= 1 ? `${b.name} is over` : `Back from ${b.name}`,
        title: b.payments === 1 ? "One payment squares it" : `${b.payments} payments square it`,
        text: "Settle now, while everyone still remembers the trip fondly.",
        button: "Settle up",
        href: `/groups/${b.id}?tab=balances`,
        photo: b.photo,
      });
    else
      add({
        id: `stamp-${b.id}`,
        kind: "card",
        tone: "paper",
        eyebrow: `Back from ${b.name}`,
        title: b.abroad ? "A new stamp in your passport" : "Another one for the passport",
        text: "Your trip passport stamped itself. Flip through it, or send a postcard to the crew.",
        button: "Open your passport",
        href: "/passport",
        art: "passport",
      });
  }

  // 4. Postcards waiting for you.
  if (x.postcardsNew > 0)
    add({
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

  // 5. A bill due in the next few days.
  const bill = [...x.billsDue].filter((b) => b.inDays >= 0 && b.inDays <= 5).sort((a, b) => a.inDays - b.inDays)[0];
  if (bill)
    add({
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

  // 6. Your month in numbers.
  if (x.hasMonth) add({ id: "month", kind: "month" });

  // 7. A festival or holiday where you live.
  if (x.season)
    add({ id: `season-${x.season.id}`, kind: "card", tone: "night", eyebrow: x.season.eyebrow, title: x.season.title, text: x.season.text, button: x.season.button, href: x.season.href, cover: x.season.cover });

  // Always-good ones, to make up at least four.
  const fillers: Highlight[] = [
    {
      id: "fill-postcard",
      kind: "card",
      tone: "rose",
      eyebrow: "Postcards",
      title: "Send someone a postcard",
      text: "A trip photo, a real-looking stamp and a wax seal. In Loopin or on WhatsApp.",
      button: "Write one",
      href: "/postcards/new",
      art: "postcard",
    },
    {
      id: "fill-passport",
      kind: "card",
      tone: "paper",
      eyebrow: "Your trip passport",
      title: x.passportCountries > 1 ? `${x.passportCountries} countries and counting` : "Where have you been?",
      text: x.passportCountries > 1 ? "Flip through your stamps, or see where your friends have been." : "Tick the countries you’ve been to and get your stamps.",
      button: "Open your passport",
      href: "/passport",
      art: "passport",
    },
    ...(x.trips.length === 0
      ? [{ id: "fill-trip", kind: "card" as const, tone: "trip" as const, eyebrow: "Nothing booked yet", title: "Where to next?", text: "Start a trip group now. The countdown, the stories and the split come with it.", button: "Plan a trip", href: "/groups/new?type=trip", cover: "beach" as CoverId }]
      : []),
    ...(x.groups <= 3
      ? [{ id: "fill-switch", kind: "card" as const, tone: "teal" as const, eyebrow: "Switching to Loopin?", title: "Coming from another app?", text: "Bring a group over in about a minute. Same balances.", button: "Bring a group over", href: "/switching", art: "switch" as const }]
      : []),
  ];
  for (const f of fillers) {
    if (out.length >= 4) break;
    add(f);
  }
  return out;
}
