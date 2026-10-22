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

// Phone nudges: a month, a week and a day before, and on the morning. A few
// lines for each, picked by the trip so friends in two trips don't get the same one.
const NUDGES: Record<number, ((place: string, e: string) => string)[]> = {
  30: [
    (p, e) => `One month to ${p} ${e} Start the packing list you’ll ignore till the night before.`,
    (p, e) => `${p} is 30 days away ${e} Time to book the things everyone said “I’ll do it”.`,
    (p, e) => `A month to go for ${p} ${e} Leave applied? Asking for the group.`,
  ],
  7: [
    (p, e) => `${p} in a week ${e} Sunscreen, chargers, and that one friend’s ID. Check.`,
    (p, e) => `7 days to ${p} ${e} The group chat is about to get very loud.`,
    (p, e) => `One week to ${p} ${e} Outfit planning has officially begun.`,
  ],
  1: [
    (p, e) => `${p} tomorrow ${e} Charge everything. Find your ID. Sleep (you won’t).`,
    (p, e) => `Tomorrow: ${p} ${e} Pack now, not at 2 am.`,
    (p, e) => `One sleep to ${p} ${e} Set three alarms.`,
  ],
  0: [
    (p, e) => `It’s ${p} day ${e} Add the first expense when the chai arrives.`,
    (p, e) => `Today’s the day: ${p} ${e} Have the best time. Loopin will keep the maths.`,
    (p, e) => `${p} starts today ${e} Snap the first photo, log the first bill.`,
  ],
};
export const NUDGE_DAYS = [30, 7, 1, 0];

function pick(seed: string, n: number) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}

export function countdownNudge(g: { id: string; name: string }, daysLeft: number): string | null {
  const lines = NUDGES[daysLeft];
  if (!lines) return null;
  return lines[pick(g.id, lines.length)](placeOf(g.name), tripEmoji(g.name));
}
