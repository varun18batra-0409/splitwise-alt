import { db } from "./db";
import { isDuplicateKey, previousResult } from "./once";

// "Start a trip from this goal", once per goal. The same request-key pattern as making a group:
// - the first tap claims the key, makes the trip, and stores the trip's id on the key;
// - a second tap (or a retry) is sent to the trip the first one made (`existing`), or told it is still being made (`busy`);
// - if making the trip fails, the key is given back so trying again works.
// The request key is cleaned up after a few days, so the answer is also kept for good in NotifyLog (never cleaned up):
// `trip-from-goal:<goal>` is the same claim the older code wrote (a goal that became a trip before request keys exists only
// there, with no trip id), and `trip-from-goal-made:<goal>:<trip>` says which trip. `existing` is "" when only the old claim is known.
export type GoalTrip<T extends { id: string }> = { trip: T } | { existing: string /* the trip's id; "" = made earlier, trip not known */ } | { busy: true };

export async function tripFromGoalOnce<T extends { id: string }>(goalId: string, make: () => Promise<T>): Promise<GoalTrip<T>> {
  const key = `trip-from-goal:${goalId}`;
  const madeKey = `trip-from-goal-made:${goalId}:`;
  // Before anything else: a goal that already became a trip (the old claim, or the durable record) never makes a second one.
  if (await db.notifyLog.findUnique({ where: { key }, select: { key: true } })) {
    const made = await db.notifyLog.findFirst({ where: { key: { startsWith: madeKey } }, select: { key: true } });
    return { existing: made ? made.key.slice(madeKey.length) : "" };
  }
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
  // The durable record (same claim key the old code used, plus which trip).
  await db.notifyLog.create({ data: { key } }).catch(() => undefined);
  await db.notifyLog.create({ data: { key: `${madeKey}${trip.id}` } }).catch(() => undefined);
  return { trip };
}
