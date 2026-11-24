import { db } from "./db";
import { settlingIn, squareSettlers, writeQueuedLines } from "./settling-db";

// For steps that end a reason to keep someone settling at exactly 0 without touching a payment or an expense (a bill skipped, stopped, deleted,
// or a month added by a bill run): anyone settling up only who is square and has nothing left holding them is moved out again, in one
// transaction of its own. Cheap when nobody is settling (one query). Safe to repeat: it writes only if someone is still settling and square.
export async function squareSettlersNow(groupId: string): Promise<void> {
  if (!(await settlingIn(db, groupId)).size) return;
  await db.$transaction(async (tx) => {
    await squareSettlers(tx, groupId);
    await writeQueuedLines(tx); // this step writes no line of its own, so the "moved out again" line is written here
  });
}
