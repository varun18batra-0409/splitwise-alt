import { MOMENT_CAPTION_MAX } from "./covers";

// The words and the day on a moment. Pure, so the phone's counter and the server use the same rules.

// What people see as one character (an emoji, even a family emoji made of several, is one).
export function graphemeCount(s: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)).length;
  }
  return [...s].length;
}

// Trim, turn line breaks and tabs into spaces, collapse repeated spaces, and drop the characters that flip the direction of
// text (U+202A to U+202E and U+2066 to U+2069). Null when it is over 80 characters. An empty caption is fine.
export function cleanCaption(raw: unknown): string | null {
  const s = String(raw ?? "")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return graphemeCount(s) <= MOMENT_CAPTION_MAX ? s : null;
}

// ---------- The day a moment was taken ----------
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ms = (iso: string) => {
  const m = DAY.exec(iso);
  if (!m) return NaN;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? t : NaN;
};
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

// Every day of the trip, "Day 1" first. No start date: none (the choice is hidden). A start with no end is one day. At most 60.
export function tripDays(start: string, end: string): string[] {
  const s = ms(start);
  if (Number.isNaN(s)) return [];
  const e = ms(end);
  const last = Number.isNaN(e) || e < s ? s : e;
  const out: string[] = [];
  for (let t = s; t <= last && out.length < 60; t += 86_400_000) out.push(iso(t));
  return out;
}

// "" (no day) or one of the trip's days. Anything else is refused (null).
export function cleanTakenOn(raw: unknown, start: string, end: string): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  return tripDays(start, end).includes(v) ? v : null;
}

// "Day 3" for a moment's day, or "" when it has none (or the trip has no dates).
export function dayLabel(takenOn: string, start: string, end: string): string {
  if (!takenOn) return "";
  const i = tripDays(start, end).indexOf(takenOn);
  return i < 0 ? "" : `Day ${i + 1}`;
}

// "just now", "12 min ago", "3 h ago", "2 days ago", then the date ("5 Nov"). `now` is for tests.
export function timeAgo(then: Date, now = new Date()): string {
  const s = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) {
    const d = Math.floor(s / 86_400);
    return `${d} ${d === 1 ? "day" : "days"} ago`;
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${then.getUTCDate()} ${months[then.getUTCMonth()]}`;
}
