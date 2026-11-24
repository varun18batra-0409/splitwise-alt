import { DEFAULT_TIME_ZONE } from "../dates";
import { cleanTimeZone } from "../local-time";

// The time zone a group's budget month is read in: the most common zone among the people still in the group.
// Someone with no zone yet (or an unusable one) counts as India, and a tie goes to India, so a group never flips on a coin toss.
// The same zone is used by the budget screen, the 80% / over-budget thresholds and the once-a-month alert key.
// Hand-worked: two people in Los Angeles and one in India: America/Los_Angeles (2 of 3). One in LA and one in India: tie, so India.
export function groupZone(zones: (string | null | undefined)[]): string {
  const count = new Map<string, number>();
  for (const z of zones) {
    const tz = cleanTimeZone(z) ?? DEFAULT_TIME_ZONE;
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
