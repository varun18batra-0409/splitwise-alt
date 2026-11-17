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

// When the day-end trip message goes to someone whose phone has told us its zone.
//
// Two crons: the evening run at 16:00 UTC and the morning run at 00:30 UTC (vercel.json), 8h30 apart. For one zone they
// fall at two local times, so each zone is given exactly ONE of the two runs (never both, never neither), chosen by
// where the evening run falls on their clock:
//  - A run is usable only when it is 06:00-21:59 their time (never at night: nothing is sent from 22:00 to 05:59).
//  - Sent at 16:00-21:59 it tells their "today" (the evening); sent at 06:00-15:59 it tells their "yesterday" (the next morning).
//  - If both runs are usable, the one nearer the ideal wins: 19:00 for an evening message, 08:00 for a morning one.
// Result for every offset from UTC-12 to UTC+14, including half and quarter hours: all are covered, none at night.
//  - UTC-12 to UTC-10:15 and UTC-6:30 to UTC-2:45: the morning run. The second group gets its evening, 18:00-21:45 local, "today".
//    The first gets 12:30-14:15 local, "yesterday".
//  - UTC-10 to UTC-6:45: the evening run, at 06:00-09:15 local, "yesterday".
//  - UTC-2:30 to UTC-1: the evening run at 13:30-15:00 local, "yesterday". Their morning run would land at
//    22:00-23:30, too late at night, so these zones get it in the afternoon of the next day (the least bad).
//  - UTC+0 to UTC+5:15: the evening run, 16:00-21:15 local, "today".
//  - UTC+5:30 to UTC+13:45: the morning run, 06:00-14:15 local, "yesterday".
//  - UTC+14: the evening run, at 06:00 local the next day, "yesterday".
// (The table test in tests/b5-clocks.test.ts lists twelve offsets by hand and checks every quarter hour.)
// A zone that changes its clock (summer time) between the two runs can in rare cases get it twice or not that day;
// each person is only ever sent a day once (the claim key), so at worst one message is late.
export const PULSE_FIRST_MINUTE = 6 * 60; // local time (inclusive): no message before 06:00
export const PULSE_LAST_MINUTE = 22 * 60; // local time (not including): none from 22:00
export const PULSE_EVENING_FROM = 16 * 60; // from here a message tells "today"; before it, "yesterday"
const PULSE_EVENING_IDEAL = 19 * 60;
const PULSE_MORNING_IDEAL = 8 * 60;
const EVENING_TO_MORNING_RUN = 8 * 60 + 30; // 16:00Z to 00:30Z the next day

export type PulseRun = "morning" | "evening";

const usable = (m: number) => m >= PULSE_FIRST_MINUTE && m < PULSE_LAST_MINUTE;
const off = (m: number) => Math.abs(m - (m >= PULSE_EVENING_FROM ? PULSE_EVENING_IDEAL : PULSE_MORNING_IDEAL));

// Which run (morning 00:30Z or evening 16:00Z) tells this zone, given the local minute of day at the evening run (16:00Z).
export function pulseRunFor(eveningRunLocalMinutes: number): PulseRun {
  const e = ((eveningRunLocalMinutes % 1440) + 1440) % 1440;
  const m = (e + EVENING_TO_MORNING_RUN) % 1440;
  if (!usable(m)) return "evening";
  if (!usable(e)) return "morning";
  return off(e) <= off(m) ? "evening" : "morning";
}

// Which day a person with a zone is told about on this run (their local minute of day and local date now), or null when
// this run is not theirs.
export function pulseDayFor(run: PulseRun, localMinutesNow: number, localToday: string): { day: string; when: "today" | "yesterday" } | null {
  const e = run === "evening" ? localMinutesNow : (localMinutesNow - EVENING_TO_MORNING_RUN + 1440) % 1440;
  if (pulseRunFor(e) !== run || !usable(localMinutesNow)) return null;
  if (localMinutesNow >= PULSE_EVENING_FROM) return { day: localToday, when: "today" };
  return { day: addDays(localToday, -1), when: "yesterday" };
}
