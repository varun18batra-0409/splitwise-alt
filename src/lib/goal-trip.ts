import { db } from "./db";
import { isDuplicateKey, previousResult } from "./once";
import { RESTORE_DAYS } from "./group-data";

// "Start a trip from this goal", once per goal. The same request-key pattern as making a group:
// - the first tap claims the key, makes the trip, and stores the trip's id on the key;
// - a second tap (or a retry) is sent to the trip the first one made (`existing`), or told it is still being made (`busy`);
// - if making the trip fails, the key is given back so trying again works.
// The request key is cleaned up after a few days, so the answer is also kept for good in NotifyLog (never cleaned up):
// `trip-from-goal:<goal>` is the same claim the older code wrote (a goal that became a trip before request keys exists only
// there, with no trip id), and `trip-from-goal-made:<goal>:<trip>` says which trip. `existing` is "" when only the old claim is known.
export type GoalTrip<T extends { id: string }> =
  | { trip: T }
  | { existing: string /* the trip's id; "" = made earlier, trip not known */ }
  | { deleted: string /* the trip was deleted and can still be restored: send them to Recently deleted */ }
  | { busy: true };

export async function tripFromGoalOnce<T extends { id: string }>(goalId: string, make: () => Promise<T>): Promise<GoalTrip<T>> {
  const key = `trip-from-goal:${goalId}`;
  const madeKey = `trip-from-goal-made:${goalId}:`;
  // What became of the trip we know about: still there, deleted (can be restored for 30 days), or gone for good (erased).
  const state = async (id: string): Promise<"live" | "deleted" | "gone"> => {
    const g = await db.group.findUnique({ where: { id }, select: { deletedAt: true } });
    if (!g) return "gone";
    if (!g.deletedAt) return "live";
    return Date.now() - g.deletedAt.getTime() < RESTORE_DAYS * 86_400_000 ? "deleted" : "gone";
  };
  // Before anything else: a goal that already became a trip (the old claim, or the durable record) never makes a second one,
  // unless that trip is gone for good, in which case the old record is released and a fresh trip can be made.
  const logged = await db.notifyLog.findUnique({ where: { key }, select: { key: true } });
  const made = logged ? await db.notifyLog.findFirst({ where: { key: { startsWith: madeKey } }, select: { key: true } }) : null;
  const prev = await previousResult(key);
  const knownId = made ? made.key.slice(madeKey.length) : prev || "";
  if (logged || prev !== null) {
    if (!knownId) return logged ? { existing: "" } : { busy: true }; // old claim with no trip id: can't tell, go to the group; or still being made
    const s = await state(knownId);
    if (s === "live") return { existing: knownId };
    if (s === "deleted") return { deleted: knownId };
    // Erased: release every record of the old trip so a new one can be made (and the person isn't bounced back forever).
    await db.notifyLog.deleteMany({ where: { OR: [{ key }, { key: { startsWith: madeKey } }] } });
    // Only the old trip's own record: a tap arriving at the same moment that already claimed the key keeps its claim.
    await db.requestKey.deleteMany({ where: { key, result: knownId } });
  }
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
