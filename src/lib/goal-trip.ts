import { db } from "./db";
import { isDuplicateKey, previousResult } from "./once";

// "Start a trip from this goal", once per goal. The same request-key pattern as making a group:
// - the first tap claims the key, makes the trip, and stores the trip's id on the key;
// - a second tap (or a retry) is sent to the trip the first one made (`existing`), or told it is still being made (`busy`);
// - if making the trip fails, the key is given back so trying again works.
export type GoalTrip<T extends { id: string }> = { trip: T } | { existing: string } | { busy: true };

export async function tripFromGoalOnce<T extends { id: string }>(goalId: string, make: () => Promise<T>): Promise<GoalTrip<T>> {
  const key = `trip-from-goal:${goalId}`;
  const prev = await previousResult(key);
  if (prev) return { existing: prev };
  if (prev === "") return { busy: true };
  const claimed = await db.requestKey.create({ data: { key, result: "" } }).then(() => true, (e) => (isDuplicateKey(e) ? false : Promise.reject(e)));
  if (!claimed) return { busy: true };
  let trip: T;
  try {
    trip = await make();
  } catch (err) {
    await db.requestKey.deleteMany({ where: { key, result: "" } }).catch(() => undefined);
    throw err;
  }
  await db.requestKey.update({ where: { key }, data: { result: trip.id } }).catch(() => undefined);
  return { trip };
}
