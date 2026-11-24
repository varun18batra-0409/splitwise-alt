import { DEFAULT_TIME_ZONE } from "../dates";
import { cleanTimeZone } from "../local-time";

// The time zone a group's budget month is read in: the most common KNOWN zone among the people still in the group who have joined.
// The caller passes only the zones of people who have joined (names nobody has joined as don't vote). A joined person with no zone yet
// (or an unusable one) counts as India, and a tie goes to India, so a group never flips on a coin toss.
// The same zone is used by the budget screen, the 80% / over-budget thresholds and the once-a-month alert key (budgets-db.ts).
// Hand-worked: two people in Los Angeles and one in India: America/Los_Angeles (2 of 3). One in LA and one in India: tie, so India.
// One in London and two names nobody has joined as yet: London (only the joined vote). One in London and three joined with no zone: India (3 of 4).

// Old names of the same place, so "Asia/Calcutta" and "Asia/Kolkata" are one vote (phones report either).
const ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Dacca": "Asia/Dhaka",
  "US/Pacific": "America/Los_Angeles",
  "US/Eastern": "America/New_York",
  "US/Central": "America/Chicago",
  "US/Mountain": "America/Denver",
  "US/Alaska": "America/Anchorage",
  "US/Hawaii": "Pacific/Honolulu",
  "Europe/Kiev": "Europe/Kyiv",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Australia/ACT": "Australia/Sydney",
  "Australia/NSW": "Australia/Sydney",
  "Australia/Victoria": "Australia/Melbourne",
  "Pacific/Samoa": "Pacific/Pago_Pago",
};

// A usable zone in its one canonical spelling, or null.
export function canonicalZone(raw: string | null | undefined): string | null {
  const tz = cleanTimeZone(raw);
  if (!tz) return null;
  // Where the runtime knows the canonical name it says so (e.g. US/Pacific); where it doesn't it hands the name back unchanged. Either
  // way the answer goes back through the table, so a runtime that answers with an OLD name (Asia/Calcutta for Asia/Kolkata,
  // Europe/Kiev for Europe/Kyiv) still ends on the one spelling used here.
  let resolved = tz;
  try {
    resolved = new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone || tz;
  } catch {
    resolved = tz;
  }
  return ALIASES[resolved] ?? ALIASES[tz] ?? resolved;
}

export function groupZone(zones: (string | null | undefined)[]): string {
  const count = new Map<string, number>();
  for (const z of zones) {
    const tz = canonicalZone(z) ?? DEFAULT_TIME_ZONE; // someone who has joined but has no known zone counts as India
    count.set(tz, (count.get(tz) ?? 0) + 1);
  }
  let best = 0;
  let winners: string[] = [];
  for (const [tz, n] of count) {
    if (n > best) {
      best = n;
      winners = [tz];
    } else if (n === best) winners.push(tz);
  }
  return winners.length === 1 ? winners[0] : DEFAULT_TIME_ZONE;
}
