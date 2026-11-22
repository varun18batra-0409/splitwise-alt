import { db } from "./db";
import { prepareDirectSave } from "./direct-db";
import { getMyMemberId } from "./identity";
import { allow } from "./rate-limit";
import { PAIR_REFUSED } from "./offline/words";

// The checks that come BEFORE an expense is saved, in one place so the two doors into saving stay equal:
//   - the Add screen's server action (`addExpense` in src/app/actions.ts), and
//   - an expense added offline and sent later (`POST /api/offline/add`).
// Everything about the expense itself (who may add, closed or left, amounts, rates, duplicates) is decided by `saveExpense`, which both
// doors then call. Anything new that must hold for every new expense goes here or in saveExpense, never in only one door.
export const TOO_MANY_CHANGES = "Too many changes in a short time. Wait a few minutes.";

export type ChecksIn = { ip: string; groupId: string; currency: string; editing: boolean; offline?: boolean };
export type ChecksOut = { ok: true; isPair: boolean } | { ok: false; error: string; busy?: boolean; pair?: boolean };

export async function addExpenseChecks(i: ChecksIn): Promise<ChecksOut> {
  // 300 an hour per network address.
  if (!(await allow(`expense:${i.ip}`, 300, 3600))) return { ok: false, error: TOO_MANY_CHANGES, busy: true };
  // A pair (expenses with one person): refused when either has blocked the other; an empty pair may take the currency of its first expense.
  // (Done before the rate lookup, which reads the pair's currency.) An expense added offline is never saved into a pair in version 1.
  const kind = await db.group.findUnique({ where: { id: i.groupId }, select: { type: true } });
  const isPair = kind?.type === "direct";
  if (isPair) {
    if (i.offline) return { ok: false, error: PAIR_REFUSED, pair: true };
    const mine = await getMyMemberId(i.groupId);
    const refused = mine ? await prepareDirectSave(i.groupId, mine, i.currency, i.editing) : null;
    if (refused) return { ok: false, error: refused };
  }
  return { ok: true, isPair };
}
