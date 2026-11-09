// Trip countdown: "Goa in 12 days 🌴". Trip groups can have a start (and end)
// day; Home and the group show how long is left, and phones get a nudge a
// month, a week and a day before, and on the morning itself.
// Days are "YYYY-MM-DD" in the group's own sense (no time zone maths needed).

export type TripPhase =
  | { kind: "before"; days: number } // days ≥ 1
  | { kind: "today" }
  | { kind: "during"; day: number; of: number } // day ≥ 2
  | { kind: "after" };

const DAY = 86_400_000;
const toMs = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(toMs(d)).toISOString().slice(0, 10) === d;
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY);

// Checks dates typed in the form: a real start day, an end on or after it, a trip of at most 60 days.
export function cleanTripDates(start: string, end: string, today: string): { ok: true; start: string; end: string } | { ok: false; error: string } {
  const s = start.trim();
  const e = end.trim();
  if (!s && !e) return { ok: true, start: "", end: "" };
  if (!isDay(s)) return { ok: false, error: "Pick the day the trip starts." };
  if (e && !isDay(e)) return { ok: false, error: "Pick a real day for the trip’s end." };
  if (e && e < s) return { ok: false, error: "The trip can’t end before it starts." };
  if (e && daysBetween(s, e) > 60) return { ok: false, error: "A trip can be up to 60 days long." };
  if (daysBetween(today, s) > 730) return { ok: false, error: "Pick a start day in the next two years." };
  return { ok: true, start: s, end: e };
}

export function tripPhase(start: string, end: string, today: string): TripPhase | null {
  if (!start) return null;
  const left = daysBetween(today, start);
  if (left > 0) return { kind: "before", days: left };
  if (left === 0) return { kind: "today" };
  const last = end || start;
  if (today > last) return { kind: "after" };
  return { kind: "during", day: 1 - left, of: daysBetween(start, last) + 1 };
}

// An emoji from the trip's name: beach, mountains, snow, a city… or a plane.
const EMOJI: [RegExp, string][] = [
  [/goa|beach|bali|maldives|phuket|andaman|gokarna|varkala|pondi|coast|island|thailand|krabi|sea/i, "🌴"],
  [/snow|ski|gulmarg|auli|swiss|switzerland|iceland|lapland|winter/i, "❄️"],
  [/manali|ladakh|leh|spiti|kasol|himachal|uttarakhand|rishikesh|trek|hike|mountain|hills|nepal|darjeeling|sikkim|munnar|ooty|coorg/i, "🏔️"],
  [/camp|forest|jungle|safari|ranthambore|jim corbett|kabini/i, "🏕️"],
  [/wedding|shaadi|sangeet/i, "💍"],
  [/concert|festival|fest|sunburn|gig/i, "🎶"],
  [/paris|london|europe|rome|tokyo|japan|new york|nyc|dubai|singapore|bangkok|vegas/i, "🌆"],
  [/road ?trip|drive/i, "🚗"],
];
export function tripEmoji(name: string): string {
  for (const [re, e] of EMOJI) if (re.test(name)) return e;
  return "✈️";
}

// "Goa trip 2026" → "Goa": the place, for lines like "Goa in 12 days".
export function placeOf(name: string): string {
  const t = name
    .replace(/\b(road|bike|weekend|girls|boys|family|friends)\s+(trip|tour|getaway)\b/gi, "")
    .replace(/\b(trip|tour|holiday|vacation|getaway|outing|plan|plans|gang|squad|group)\b/gi, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/[-–—:|·,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t || name.trim();
}

// The words on the countdown: big part (number or word) and the line around it.
export function countdownWords(name: string, p: TripPhase): { big: string; small: string; line: string } | null {
  const place = placeOf(name);
  const e = tripEmoji(name);
  switch (p.kind) {
    case "before":
      if (p.days === 1) return { big: "1", small: "sleep to go", line: `${place} tomorrow ${e}` };
      if (p.days <= 7) return { big: String(p.days), small: "sleeps to go", line: `${p.days} sleeps to ${place} ${e}` };
      if (p.days >= 60 && p.days % 7 === 0) return { big: String(p.days / 7), small: "weeks to go", line: `${place} in ${p.days / 7} weeks ${e}` };
      return { big: String(p.days), small: "days to go", line: `${place} in ${p.days} days ${e}` };
    case "today":
      return { big: "Today", small: "it’s happening", line: `It’s ${place} day ${e}` };
    case "during":
      return { big: `Day ${p.day}`, small: `of ${p.of}`, line: `Day ${p.day} of ${p.of} in ${place} ${e}` };
    case "after":
      return null;
  }
}

// Phone nudges as the day gets closer: two months, 45 days, a month (about
// every two weeks), then two weeks, a week, three days, the day before and the
// morning itself (and, separately, the day after it
// ends). Several lines for each, picked by trip and step, so it never feels
// like the same message twice.
type Line = (place: string, e: string) => string;
const NUDGES: Record<number, Line[]> = {
  60: [
    (p, e) => `${p} in 60 days ${e} It’s officially happening. Screenshot this.`,
    (p, e) => `Two months to ${p} ${e} Plenty of time to over-plan. Let’s go.`,
    (p, e) => `${p}: 60 days out ${e} Start the savings jar and the group playlist.`,
  ],
  45: [
    (p, e) => `45 days to ${p} ${e} Halfway to the halfway mark. Book the fun stuff.`,
    (p, e) => `${p} in 45 days ${e} Tickets, stays, plans: who’s on what?`,
    (p, e) => `Six-ish weeks to ${p} ${e} Time to send the group the moodboard.`,
  ],
  30: [
    (p, e) => `One month to ${p} ${e} Main character energy starts now.`,
    (p, e) => `${p} is officially a month away ${e} Leave applied? Asking for the group chat.`,
    (p, e) => `30 days to ${p} ${e} The countdown is real. The packing list is not (yet).`,
    (p, e) => `A month to ${p} ${e} Start saving the reels you’ll pretend to recreate.`,
    (p, e) => `${p} in 30 days ${e} Manifesting good weather and zero delays.`,
  ],
  14: [
    (p, e) => `Two weeks to ${p} ${e} Who’s booking what? Sort it before the group chat explodes.`,
    (p, e) => `${p} in 14 days ${e} Outfit planning is now mandatory.`,
    (p, e) => `14 sleeps to ${p} ${e} Start the playlist. The fight for the aux begins.`,
    (p, e) => `Fortnight to ${p} ${e} Your camera roll is about to get very busy.`,
  ],
  7: [
    (p, e) => `${p} in a week ${e} Sunscreen, chargers, and that one friend’s ID. Check.`,
    (p, e) => `7 days to ${p} ${e} The group chat is about to get very loud.`,
    (p, e) => `One week to ${p} ${e} Vibes: packed. Bag: not yet.`,
    (p, e) => `${p} next week ${e} Do-not-disturb mode is loading…`,
  ],
  3: [
    (p, e) => `3 days to ${p} ${e} Pack now, thank yourself later.`,
    (p, e) => `${p} in 72 hours ${e} Plan the outfits, skip the overthinking.`,
    (p, e) => `3 sleeps to ${p} ${e} Someone check the weather. Not it.`,
  ],
  1: [
    (p, e) => `${p} tomorrow ${e} Charge everything. Find your ID. Sleep (you won’t).`,
    (p, e) => `Tomorrow: ${p} ${e} Set three alarms. Trust none of them.`,
    (p, e) => `One sleep to ${p} ${e} If you’re reading this, go pack.`,
    (p, e) => `${p} is tomorrow ${e} Out of office: activated.`,
  ],
  0: [
    (p, e) => `It’s ${p} day ${e} Phones up, worries down.`,
    (p, e) => `Today’s the day: ${p} ${e} Loopin’s got the maths. You’ve got the memories.`,
    (p, e) => `${p} starts today ${e} First photo, first chai, first expense. In that order.`,
    (p, e) => `Wheels up for ${p} ${e} Have the best time. We’ll keep score.`,
  ],
};
export const NUDGE_DAYS = [60, 45, 30, 14, 7, 3, 1, 0];

// The day after the trip: back home, time to square up.
const AFTER: Line[] = [
  (p, e) => `Back from ${p}? ${e} Add the last bills and settle up in one tap.`,
  (p, e) => `${p}: done ✓ Memories saved. Now settle up so the next plan isn’t awkward.`,
  (p, e) => `Post-${p} blues? ${e} Clear the balances in a tap and start planning the next one.`,
];

function pick(seed: string, n: number) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}

export function afterTripNudge(g: { id: string; name: string }): string {
  return AFTER[pick(`${g.id}:after`, AFTER.length)](placeOf(g.name), tripEmoji(g.name));
}

export function countdownNudge(g: { id: string; name: string }, daysLeft: number): string | null {
  const lines = NUDGES[daysLeft];
  if (!lines) return null;
  return lines[pick(`${g.id}:${daysLeft}`, lines.length)](placeOf(g.name), tripEmoji(g.name));
}

// ---------- The countdown card's words, by how far away the trip is ----------
// Each stage of the countdown has its own small heading and one-liner, in several versions. With
// a few trips on Home, trips at the same stage get different versions (never the same words twice
// on one screen), and each trip's words move on day by day. "Boarding" only appears in the last days.
export type CountdownStage = "far" | "w60" | "w45" | "w30" | "w14" | "w7" | "w3" | "w1" | "today" | "first" | "during" | "last";

export function countdownStage(p: TripPhase): CountdownStage | null {
  if (p.kind === "before") return p.days > 60 ? "far" : p.days > 45 ? "w60" : p.days > 30 ? "w45" : p.days > 14 ? "w30" : p.days > 7 ? "w14" : p.days > 3 ? "w7" : p.days > 1 ? "w3" : "w1";
  if (p.kind === "today") return "today";
  if (p.kind === "during") return p.day <= 1 ? "first" : p.day >= p.of ? "last" : "during";
  return null;
}

type Quip = (place: string, e: string) => string;
const STAGE: Record<CountdownStage, { kickers: string[]; quips: Quip[] }> = {
  far: {
    kickers: ["Save the date", "On the horizon", "Locked in", "Something to look forward to", "Future plans", "Coming up", "Dream mode"],
    quips: [(p, e) => `${p} is officially on the calendar ${e}`, (p) => `Plenty of time to over-plan ${p}`, () => `Start the savings jar now`, (p) => `${p}: the group chat's favourite word`, () => `Screenshot this. It's happening.`, (p) => `Daydreaming about ${p} is allowed`, () => `Early birds book the best stays`],
  },
  w60: {
    kickers: ["Two months out", "Mark the calendar", "It's getting real", "Plans in motion", "Countdown on", "Not long now", "The wait begins"],
    quips: [(p, e) => `Two months to ${p} ${e}`, () => `Book the stays before they're gone`, () => `Time to start the group playlist`, (p) => `${p}: who's sorting the tickets?`, () => `Leave applied? Asking for the group`, () => `Moodboard season starts now`, () => `Plans now, receipts later`],
  },
  w45: {
    kickers: ["Six-ish weeks", "Getting closer", "Halfway there", "Plans taking shape", "Countdown mode", "Almost a month", "Heating up"],
    quips: [(p, e) => `Six weeks to ${p} ${e}`, () => `Book the fun stuff now`, () => `Tickets, stays, plans: who's on what?`, (p) => `${p} is closer than you think`, () => `Time to send the moodboard`, () => `Budget talk now saves fights later`, () => `Someone make the shared packing list`],
  },
  w30: {
    kickers: ["Under a month", "It's close", "Weeks, not months", "Getting excited", "Countdown is real", "Nearly there", "Final stretch begins"],
    quips: [(p, e) => `Less than a month to ${p} ${e}`, () => `Outfit planning: officially open`, () => `Start saving the reels you'll recreate`, (p) => `${p} weather check: daily now`, () => `Manifesting zero delays`, () => `The packing list won't write itself`, () => `Add bookings now, settle later`],
  },
  w14: {
    kickers: ["Two weeks", "Almost time", "Nearly here", "So close", "The home stretch", "Pack-list time", "Days, not weeks"],
    quips: [(p, e) => `Two weeks to ${p} ${e}`, () => `The fight for the aux begins`, () => `Your camera roll is about to fill up`, (p) => `${p} outfits: decided?`, () => `Who's booking what? Sort it now`, () => `Chargers, adapters, snacks`, () => `Out-of-office message: drafted`],
  },
  w7: {
    kickers: ["This time next week", "Boarding soon", "One week", "Final countdown", "Almost packing", "Nearly go-time", "So, so close"],
    quips: [(p, e) => `A week to ${p} ${e}`, () => `Sunscreen, chargers, ID. Check.`, () => `The group chat is getting loud`, (p) => `${p} mode: loading…`, () => `Vibes: packed. Bag: not yet.`, () => `Do-not-disturb mode is loading`, () => `Sleep now. You won't on the trip.`],
  },
  w3: {
    kickers: ["Boarding soon", "Bags out", "Any minute now", "Pack tonight", "Last few sleeps", "Final checks", "Nearly there"],
    quips: [(p, e) => `A few sleeps to ${p} ${e}`, () => `Pack now, thank yourself later`, () => `Someone check the weather. Not it.`, () => `Tickets downloaded? Offline too?`, (p) => `${p} playlist: finalised`, () => `Plan the outfits, skip the overthinking`, () => `Charge every power bank you own`],
  },
  w1: {
    kickers: ["Boarding tomorrow", "Tomorrow!", "One sleep", "Last night at home", "Almost go-time", "T-minus one day", "Set the alarm"],
    quips: [(p, e) => `${p} tomorrow ${e}`, () => `Charge everything. Find your ID.`, () => `Sleep. You won't, but try.`, () => `Set two alarms. Maybe three.`, (p) => `${p} is one sleep away`, () => `Bags by the door`, () => `Who's got the tickets? Check twice.`],
  },
  today: {
    kickers: ["Boarding today", "It's go day", "Today's the day", "Wheels up", "We're off", "Departure day", "Here we go"],
    quips: [(p, e) => `It's ${p} day ${e}`, () => `Phone, wallet, ID, charger`, () => `Add the first expense from the road`, (p) => `${p}, here you come`, () => `Holiday mode: on`, () => `The group photo starts now`, () => `Out of office. Officially.`],
  },
  first: {
    kickers: ["Day one", "Just landed", "First day", "Settling in", "Arrived", "It's begun", "Day one energy"],
    quips: [(p, e) => `Day one in ${p} ${e}`, () => `Add as you go, settle at the end`, () => `First meal on the trip: legendary`, (p) => `${p} looks good on you`, () => `Unpack later. Explore now.`, () => `Receipts in, worries out`, () => `Group photo before anyone's tired`],
  },
  during: {
    kickers: ["On the trip", "Living it", "Mid-trip", "Out exploring", "Holiday mode", "In the moment", "Away we are"],
    quips: [(p, e) => `Still in ${p} ${e}`, () => `Keep the receipts coming`, () => `Who's carrying the team today?`, () => `Add it now, settle it later`, (p) => `${p} hits different today`, () => `Sleep is optional on holiday`, () => `Your camera roll says it all`],
  },
  last: {
    kickers: ["Last day", "Final day", "One more day", "Make it count", "Closing night", "Wrap-up day", "Last hurrah"],
    quips: [(p, e) => `Last day in ${p} ${e}`, () => `Make it count`, () => `Settle up before everyone scatters`, () => `One last group photo`, (p) => `Goodbye ${p}, for now`, () => `Stories and Wrapped coming soon`, () => `Pack slowly. Leave slower.`],
  },
};

// The card's small heading and one-liner. `slot`: this trip's place among the trips at the same
// stage on one screen (0, 1, 2…), so each gets its own version.
export function countdownCard(name: string, p: TripPhase, slot = 0): { kicker: string; quip: string } | null {
  const stage = countdownStage(p);
  if (!stage) return null;
  const s = STAGE[stage];
  const turn = p.kind === "before" ? p.days : p.kind === "during" ? p.day : 0; // moves on each day
  const k = (slot + turn) % s.kickers.length;
  const q = (slot + turn) % s.quips.length;
  return { kicker: s.kickers[k], quip: s.quips[q](placeOf(name), tripEmoji(name)) };
}
