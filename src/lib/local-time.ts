import { dayKey, formatter, isTimeZone } from "./dates";

// Nudges in each person's own time zone: what day it is for them, whether it is
// daytime there, and whether a zone sent by a phone is fit to be saved.

export const NUDGE_FIRST_HOUR = 6; // phone nudges go out from 06:00 ...
export const NUDGE_LAST_HOUR = 22; // ... until 22:00 (not including) their time

// The hour of the day (0-23) in that zone.
export function localHour(now: Date, tz: string): number {
  return Number(formatter("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now));
}

export function isNudgeHour(now: Date, tz: string): boolean {
  const h = localHour(now, tz);
  return h >= NUDGE_FIRST_HOUR && h < NUDGE_LAST_HOUR;
}

// "2026-11-16" plus n days (a plain calendar day, no clock involved).
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Yesterday, today and tomorrow where that person is.
export function localDays(now: Date, tz: string): { yesterday: string; today: string; tomorrow: string } {
  const today = dayKey(now, tz);
  return { yesterday: addDays(today, -1), today, tomorrow: addDays(today, 1) };
}

// A zone name sent by a phone, or null if it isn't one we should keep: only
// real zone names, short, with plain characters.
export function cleanTimeZone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tz = raw.trim();
  if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return null;
  return isTimeZone(tz) ? tz : null;
}
