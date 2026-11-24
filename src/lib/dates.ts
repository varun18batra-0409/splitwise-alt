// Dates in each person's own time zone.
//
// - "Moments" (when something was added or paid) are shown in the viewer's
//   time zone (remembered from their phone in a small "tz" cookie).
// - Expense days ("2026-10-14") are stored as noon UTC that day, which is the
//   calendar day for everyone (dayKey reads it as a plain day), so a dinner
//   never slips to another day when a friend abroad looks at it.

export const DEFAULT_TIME_ZONE = "Asia/Kolkata";
/** @deprecated use DEFAULT_TIME_ZONE */
export const TIME_ZONE = DEFAULT_TIME_ZONE;

const zoneOk = new Map<string, boolean>();
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  const known = zoneOk.get(tz);
  if (known !== undefined) return known;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    ok = true;
  } catch {
    ok = false;
  }
  if (zoneOk.size < 500) zoneOk.set(tz, ok);
  return ok;
}

// A chosen expense day is stored as exactly 12:00:00.000 UTC.
// "18 Nov": the day a payment was marked paid, as the reader sees it in their zone `tz`.
export function paidOnLabel(d: Date, tz: string): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: tz }).replace("Sept", "Sep");
}

export function isDayMarker(d: Date): boolean {
  return d.getUTCHours() === 12 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

// Date formatters are slow to create, so each one is made once and reused.
const formatters = new Map<string, Intl.DateTimeFormat>();
export function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

// "2026-10-14" for a moment, in the given time zone. A chosen expense day is
// that same day everywhere (even in New Zealand or Samoa).
export function dayKey(d: Date, tz: string = DEFAULT_TIME_ZONE): string {
  if (isDayMarker(d)) return d.toISOString().slice(0, 10);
  return formatter("en-CA", { timeZone: isTimeZone(tz) ? tz : DEFAULT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function todayKey(now = new Date(), tz: string = DEFAULT_TIME_ZONE): string {
  return dayKey(now, tz);
}

// "2026-10-14" → noon UTC that day. Null if it isn't a real date, is before
// 2000, or is more than a day and a half in the future.
export function parseDay(input: string, now = new Date()): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.trim()) return null; // e.g. 31 Feb
  if (d.getUTCFullYear() < 2000) return null;
  if (d.getTime() > now.getTime() + 36 * 60 * 60 * 1000) return null;
  return d;
}

// When an expense happened: the chosen day, or when it was added.
export function expenseDate(e: { spentAt?: Date | null; createdAt: Date }): Date {
  return e.spentAt ?? e.createdAt;
}

// The same day number some months or years on, but never spilling into the next month: 31 Jan + 1 month is 28 (or 29) Feb, not 3 Mar,
// and 29 Feb + 1 year is 28 Feb.
export function sameDayLater(from: Date, addMonths: number): Date {
  const first = new Date(from.getFullYear(), from.getMonth() + addMonths, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(from.getDate(), last));
}

// ---------- The first moment of a calendar day in a time zone ----------

// The calendar day ("2027-03-14") a moment falls on in `tz`, read straight from the zone (never the noon-UTC day marker rule of dayKey).
function localDayAt(ms: number, tz: string): string {
  return formatter("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

// How far the zone's clock is ahead of UTC at that moment, in milliseconds (whole seconds).
function offsetAt(ms: number, tz: string): number {
  const parts = formatter("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(ms));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// The very first moment of the calendar day `day` ("YYYY-MM-DD") on the clocks of `tz`; null if `day` isn't a real date.
// Start from midnight as if the zone were UTC, take away the zone's offset, then work the offset out AGAIN at that moment (the offset
// can be different there: on the day clocks change, the offset at noon is not the offset at midnight), and check the answer really is
// the first moment of that day. If the check fails (a zone whose clocks skip midnight, e.g. Santiago on 5 Sep 2027, jumps from
// 23:59 to 01:00) it is found by searching, and is the first moment that is on that day.
// Hand-worked: 2027-03-14 New York: clocks go forward at 02:00 that day, so midnight is still on -5:00 = 05:00Z (not 04:00Z).
export function startOfDayIn(day: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(guess) || new Date(guess).toISOString().slice(0, 10) !== day) return null;
  const zone = isTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
  const first = (ms: number) => localDayAt(ms, zone) === day && localDayAt(ms - 1000, zone) < day;
  const once = guess - offsetAt(guess, zone);
  const twice = guess - offsetAt(once, zone);
  if (first(twice)) return new Date(twice);
  if (first(once)) return new Date(once);
  // Search whole seconds for the first moment whose local day is `day` or later (offsets are never beyond 14 hours, so 27 hours either side is enough).
  let lo = Math.floor((guess - 27 * 3_600_000) / 1000);
  let hi = Math.floor((guess + 27 * 3_600_000) / 1000);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDayAt(mid * 1000, zone) >= day) hi = mid;
    else lo = mid;
  }
  return new Date(hi * 1000);
}
