import { formatMoney } from "./money";
import { addDays } from "./local-time";

// The words for the day-end pulse (a trip's day, told playfully) and memory
// lane ("a year ago today"). Pure, so they can be tested.

export function pulseText(o: { place: string; day: number; of: number; spent: number; currency: string; count: number; topPayer?: string; topShare: number; when?: "today" | "yesterday" }): string {
  const money = formatMoney(o.spent, o.currency);
  const head = o.of > 1 ? `Day ${o.day} in ${o.place}: ${money} gone` : `${o.place} ${o.when === "yesterday" ? "yesterday" : "today"}: ${money} gone`;
  const tail =
    o.count === 1
      ? "one expense. Restrained 🧘"
      : o.topPayer && o.topShare >= 0.6
        ? `${o.topPayer}’s carrying the team 😅`
        : o.count >= 8
          ? `${o.count} expenses. Busy day 🔥`
          : `${o.count} expenses, shared fair and square 🤝`;
  return `${head}, ${tail}`;
}

export function memoryText(o: { place: string; years: number; people: number; days: number }): string {
  const when = o.years === 1 ? "A year ago today" : `${o.years} years ago today`;
  return `${when}: ${o.place}, ${o.people} of you${o.days > 1 ? `, ${o.days} days` : ""} 🌴 Tap to relive it`;
}

// When the day-end trip message goes to someone whose phone has told us its zone (the crons run at 00:30 and 16:00 UTC, so two
// windows reach every zone from UTC-10 to UTC+14). Change the four hours here to move them.
export const PULSE_EVENING_FROM = 16; // local hour (inclusive): the day just ended, tell "today"
export const PULSE_EVENING_TO = 22; // local hour (not including)
export const PULSE_MORNING_FROM = 6; // local hour (inclusive): tell "yesterday"
export const PULSE_MORNING_TO = 14; // local hour (not including)

// Which day a person with a zone is told about at this hour, or null when this is not their time.
export function pulseDayFor(localHourNow: number, localToday: string): { day: string; when: "today" | "yesterday" } | null {
  if (localHourNow >= PULSE_EVENING_FROM && localHourNow < PULSE_EVENING_TO) return { day: localToday, when: "today" };
  if (localHourNow >= PULSE_MORNING_FROM && localHourNow < PULSE_MORNING_TO) return { day: addDays(localToday, -1), when: "yesterday" };
  return null;
}

