import { saveExpense, type SaveExpenseInput } from "../save-expense";
import { cleanKey } from "../once";
import { asDuplicate, earlierSave, originalKeyOf, sameAsTyped } from "./earlier";
import { niceDate } from "../format";
import type { RateAnswer } from "../rate-cache";
import { NOT_SIGNED_IN, NO_RATE, OTHER_PERSON } from "./words";
import { refusalCodeOf } from "./refusal";
import type { AddAnswer, DraftInput } from "./types";

// Sends one expense that was added offline through saveExpense: the very same function the Add screen uses. The phone sent only what was
// typed; the splitting, the rate, the card fee, the duplicate question and every refusal happen here, on the server, in the same order as
// an online save. A refusal writes nothing (not even the one-time key), so the draft can be opened, fixed and sent again with the same key.
export type SendOpts = {
  dryRun?: boolean;
  allowDuplicate?: boolean;
  // The rate on the expense's own day. It must NEVER answer with another day's rate (see getRateOn).
  rateOn: (from: string, to: string, day: string) => Promise<RateAnswer>;
  now?: Date;
};

export async function sendDraft(draft: DraftInput, me: string | undefined, o: SendOpts): Promise<AddAnswer> {
  // Who is asking must be the person who saved it. Not signed in here: it keeps waiting. Someone else: never saved as them.
  if (!me) return { status: "later", reason: NOT_SIGNED_IN };
  if (me !== draft.memberId) return { status: "refused", code: "other-person", reason: OTHER_PERSON };
  const key = cleanKey(draft.key);
  if (!key) return { status: "refused", code: "invalid", reason: "That expense wasn’t readable, so it wasn’t added." };

  // "Save on this phone" after an online save whose reply was lost keeps the draft as `off-` + that save's key K. If that save did commit:
  //   - the same expense (same amount, currency and name), in this group: it is already added;
  //   - changed since (say ₹1,200 became ₹1,500): the sheet asks, the draft is never dropped; "Different, keep both" then adds it;
  //   - K belongs to something in another group, or to nothing that exists: it has nothing to do with this draft, a normal save.
  const earlier = await earlierSave(key);
  const there = earlier.expense && earlier.expense.groupId === draft.groupId ? earlier.expense : null;
  if (there && sameAsTyped(there, draft)) return { status: "added", id: there.id };
  if (there && o.allowDuplicate !== true) return { status: "duplicate", dup: await asDuplicate(there) };
  // K is claimed together with the phone's own key only when nothing has used it, so a save still in flight online and this copy can't both land.
  const alsoKey = earlier.taken ? undefined : originalKeyOf(key);

  let noRate: RateAnswer | null = null;
  const lookup = async (from: string, to: string) => {
    const r = await o.rateOn(from, to, draft.day);
    if (!r.ok) noRate = r;
    return r;
  };
  const input: SaveExpenseInput = {
    groupId: draft.groupId,
    name: draft.name,
    amount: draft.amount,
    currency: draft.currency,
    category: draft.category,
    paidById: draft.paidById,
    multiPay: draft.multiPay,
    payers: draft.payers,
    forMode: draft.forMode,
    selected: draft.selected,
    onePersonId: draft.onePersonId,
    splitType: draft.splitType,
    exact: draft.exact,
    percent: draft.percent,
    shares: draft.shares,
    kind: draft.kind,
    paymentMethod: draft.paymentMethod,
    markupChoice: draft.markupChoice,
    markupCustom: draft.markupCustom,
    notes: draft.notes,
    date: draft.day,
    rateMode: draft.rateMode,
    manualRate: draft.manualRate,
    allowDuplicate: o.allowDuplicate === true,
    requestKey: key,
  };
  const result = await saveExpense(input, me, lookup, {
    requestKey: key,
    alsoKey,
    checkDuplicate: true,
    guestRules: true,
    dryRun: o.dryRun === true,
    now: o.now,
    expect: { currency: draft.seen.baseCurrency, cardMarkupBp: draft.seen.cardMarkupBp, memberIds: draft.seen.activeMemberIds },
  });
  if (result.ok) return o.dryRun && !result.id ? { status: "ok" } : { status: "added", id: result.id };
  if (result.duplicateOf) return { status: "duplicate", dup: result.duplicateOf };
  // The rate service could not be reached (a passing problem): keep waiting and try again. Only "there is no rate for that day" is a refusal.
  if (noRate && (noRate as RateAnswer & { ok: false }).reason === "offline") return { status: "later", reason: (noRate as RateAnswer & { ok: false }).message };
  if (noRate) return { status: "refused", code: "no-rate", reason: NO_RATE(niceDate(draft.day)) };
  return { status: "refused", code: refusalCodeOf(result.error), reason: result.error };
}
