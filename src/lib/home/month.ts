import { dayKey, DEFAULT_TIME_ZONE } from "../dates";

// Months for Home & Couple groups: "2026-10" keys, worked out in the
// group's time zone (a bill due on the 1st adds on the 1st in India, not
// on the 31st in UTC).

export function monthKey(d: Date, tz: string = DEFAULT_TIME_ZONE): string {
  return dayKey(d, tz).slice(0, 7);
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// The day a bill is due: day 1–31 (clamped to the month), or the last day.
export function dueKey(key: string, day: number | "last"): string {
  const last = daysInMonth(key);
  const d = day === "last" || day <= 0 ? last : Math.min(day, last);
  return `${key}-${String(d).padStart(2, "0")}`;
}

// As a chosen-day marker (12:00 UTC that day), the way expense days are stored.
export function dueDate(key: string, day: number | "last"): Date {
  return new Date(`${dueKey(key, day)}T12:00:00.000Z`);
}

// Days left in this month after today (0 on the last day).
export function daysLeft(now: Date, tz: string = DEFAULT_TIME_ZONE): number {
  const today = dayKey(now, tz);
  return daysInMonth(today.slice(0, 7)) - Number(today.slice(8, 10));
}

// Rent for part of a month (rounded down; the caller hands the rest to others).
export function prorate(amount: number, daysIn: number, daysTotal: number): number {
  if (daysTotal <= 0) return 0;
  return Math.floor((amount * Math.max(0, Math.min(daysIn, daysTotal))) / daysTotal);
}
