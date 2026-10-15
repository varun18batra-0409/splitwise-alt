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

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// A chosen expense day is stored as exactly 12:00:00.000 UTC.
export function isDayMarker(d: Date): boolean {
  return d.getUTCHours() === 12 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

// "2026-10-14" for a moment, in the given time zone. A chosen expense day is
// that same day everywhere (even in New Zealand or Samoa).
export function dayKey(d: Date, tz: string = DEFAULT_TIME_ZONE): string {
  if (isDayMarker(d)) return d.toISOString().slice(0, 10);
  return d.toLocaleDateString("en-CA", { timeZone: isTimeZone(tz) ? tz : DEFAULT_TIME_ZONE });
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
