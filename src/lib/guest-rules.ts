import { db } from "./db";

// Who may do what when a person joined a group WITHOUT an account (a "guest": their member row has no accountId).
// ONE file decides it. A guest may do their own things; changing things for the whole group needs a sign-in, so everyone can
// see who changed what. "Guest" means the member row in THAT group has no account, not "this phone is signed out": a signed-in
// phone can still hold guest names.
//
// Rules, per action (ACTION_RULES below lists every exported server action; tests/guest-rules.test.ts scans the code for them):
//   open  - a guest may do it
//   own   - a guest may do it only on their own things (the refusal is the sign-in note)
//   acct  - needs an account (a guest gets the sign-in note); some are admin-only as well, which stays as it was
//   done  - already needs an account today (unchanged)
//
// A refusal is ALWAYS one of two fixed sentences, so the screen can turn it into the sign-in sheet (signinKeyOf) and a hand-made
// request still gets a calm answer. A refusal changes nothing.

export * from "./guest-words";
import { GUEST_REFUSAL, expenseRefusal } from "./guest-words";

export async function isGuestMember(memberId: string | undefined | null): Promise<boolean> {
  if (!memberId) return false;
  const m = await db.member.findUnique({ where: { id: memberId }, select: { accountId: true } });
  return Boolean(m) && m!.accountId === null;
}

// "needs an account": the refusal when the acting person is a guest in their group, otherwise null.
export async function gateGuest(memberId: string | undefined | null): Promise<string | null> {
  return (await isGuestMember(memberId)) ? GUEST_REFUSAL : null;
}

// Own expenses: "own" = createdById is the acting member (not paidById: "Dinner, paid by Ben", added by Asha, is Asha's).
// Older rows have createdById "" and count as not-own. `ownerName` is who added it, when known.
export function expenseEditRefusal(guest: boolean, actingMemberId: string, expense: { createdById: string }, ownerName?: string): string | null {
  if (!guest || (expense.createdById && expense.createdById === actingMemberId)) return null;
  // The first name ("Asha Kumar" -> "Asha"): "Sign in to change Asha’s expense".
  const first = ownerName?.trim().split(/\s+/)[0];
  return first ? expenseRefusal(first) : GUEST_REFUSAL;
}

// Payments between two people: a guest may record one only if they are the payer or the person paid.
export function paymentPartyRefusal(guest: boolean, actingMemberId: string, fromId: string, toId: string): string | null {
  if (!guest || fromId === actingMemberId || toId === actingMemberId) return null;
  return GUEST_REFUSAL;
}

// Changing a name: your own is fine, someone else's needs an account.
export function renameRefusal(guest: boolean, actingMemberId: string, memberId: string): string | null {
  return !guest || memberId === actingMemberId ? null : GUEST_REFUSAL;
}

// Card game buy-in or cash-out: a guest may only do it for themselves.
export function ownPlayerRefusal(guest: boolean, actingMemberId: string, memberIds: string[]): string | null {
  return !guest || (memberIds.length > 0 && memberIds.every((id) => id === actingMemberId)) ? null : GUEST_REFUSAL;
}

// The same rule for Undo: a guest may undo only their own lines.
export function undoRefusal(guest: boolean, actingMemberId: string, eventActorId: string | undefined): string | null {
  return !guest || (eventActorId !== undefined && eventActorId === actingMemberId) ? null : GUEST_REFUSAL;
}

export type Rule = "open" | "own" | "acct" | "done";
// `marks`: text that must appear in the action's own code (or in `via`, a helper in the same file) so a refusal can't be forgotten.
export type RuleEntry = { rule: Rule; marks?: string[]; via?: string; note?: string };

// What a gate looks like in code (the scan test checks an action, or the helper it goes through, contains one).
export const GATE_MARKS = ["gateGuest(", "guestRules", "isGuestMember(", "Refusal(", "GUEST_REFUSAL"];

// EVERY exported server action. Add a row when you add an action: tests/guest-rules.test.ts fails for an action with no row.
export const ACTION_RULES: Record<string, RuleEntry> = {
  // actions.ts
  createGroup: { rule: "done", note: "needs an account" },
  importFromSplitwise: { rule: "done" },
  addPerson: { rule: "acct", via: "memberContext" },
  invitePeople: { rule: "acct", via: "memberContext" },
  joinAsExisting: { rule: "open", note: "the front door for guests" },
  joinAsNew: { rule: "open", note: "the front door for guests" },
  answerInvitation: { rule: "done" },
  makeNewInviteLink: { rule: "acct", marks: ["gateGuest("], note: "admin as well" },
  addExpense: { rule: "own", marks: ["guestRules"], note: "new is open; editing is own" },
  deleteExpense: { rule: "own", via: "toggleExpense" },
  restoreExpense: { rule: "own", via: "toggleExpense" },
  removePayment: { rule: "open", note: "already only the payer or the person paid" },
  restorePayment: { rule: "open", note: "already only the payer or the person paid" },
  undoChange: { rule: "own", marks: ["guestRules"] },
  lookupRate: { rule: "open" },
  saveNotifyPrefs: { rule: "open", note: "just me" },
  updateSharingSettings: { rule: "acct", via: "signinIfGuest" },
  updateGroupSettings: { rule: "acct", via: "signinIfGuest" },
  saveGroupSettings: { rule: "acct", via: "signinIfGuest" },
  convertGroupCurrency: { rule: "acct", via: "signinIfGuest", note: "admin as well" },
  setGroupClosed: { rule: "acct", via: "signinIfGuest" },
  settleAcrossGroups: { rule: "own", marks: ["settleAcrossCore("], note: "settleAcrossCore already refuses a part the person is not in (cross-settle-db.ts)" },
  recordCustomPayment: { rule: "own", marks: ["guestRules"] },
  renamePerson: { rule: "own", marks: ["renameRefusal("] },
  removePerson: { rule: "acct", marks: ["GUEST_REFUSAL"], note: "admin as well" },
  setPersonLeft: { rule: "own", marks: ["Refusal("] },
  releaseGuestNameAction: { rule: "own", marks: ["releaseGuestName("], note: "the admin (with an account) or the guest on their own name; checked in releaseGuestName" },
  settleEverything: { rule: "acct", via: "signinIfGuest" },
  pushPublicKey: { rule: "open" },
  savePushSubscription: { rule: "open" },
  removePushSubscription: { rule: "open" },
  requestCode: { rule: "open" },
  confirmGuestMove: { rule: "open" },
  cancelGuestMove: { rule: "open" },
  moveGuestGroups: { rule: "done" },
  verifyCode: { rule: "open" },
  saveMyName: { rule: "done" },
  signOutOtherPhonesAction: { rule: "done" },
  signOutThisPhone: { rule: "open" },
  deleteMyAccount: { rule: "done" },
  deleteGroup: { rule: "acct", via: "signinIfGuest", note: "admin as well" },
  restoreGroup: { rule: "acct", marks: ["gateGuest("], note: "admin as well" },
  invitePersonByEmail: { rule: "acct", via: "memberContext" },
  cancelInvite: { rule: "acct", via: "memberContext" },
  removeMyPasskey: { rule: "done" },
  // moment-actions.ts
  deleteMomentAction: { rule: "own", marks: ["canDeleteMoment("], note: "the author, or the person who looks after the group (moments-access.ts)" },
  reactMomentAction: { rule: "open" },
  removeReportedMomentAction: { rule: "done", note: "operator only" },
  // direct-actions.ts
  startDirectWith: { rule: "done" },
  inviteDirect: { rule: "done" },
  // collect-actions.ts
  createCollectionAction: { rule: "done" },
  markPaidAction: { rule: "done" },
  undoPaidAction: { rule: "done" },
  organiserActionForm: { rule: "done" },
  setCollectPush: { rule: "done" },
  // countdown-actions.ts
  shareCountdownInLoopin: { rule: "open", note: "decided: a guest's own line, 3 a day per person; it changes no money" },
  // postcard-actions.ts
  sendPostcardAction: { rule: "done" },
  reactPostcardAction: { rule: "done" },
  // notify-pref-actions.ts
  setNotifyPref: { rule: "done" },
  // safety-actions.ts
  reportAction: { rule: "done" },
  blockAction: { rule: "done" },
  unblockAction: { rule: "done" },
  resolveReportAction: { rule: "done" },
  contactSupportAction: { rule: "done" },
  // pay-link-actions.ts
  iPaidAction: { rule: "open", note: "the link needs no sign-in" },
  undoIPaidAction: { rule: "open", note: "the link needs no sign-in" },
  // passport-actions.ts
  addPlacesAction: { rule: "done" },
  removePlaceAction: { rule: "done" },
  setHomeCountryAction: { rule: "done" },
  setPassportShareAction: { rule: "done" },
  answerPassportQuestionAction: { rule: "done" },
  nudgePassportAction: { rule: "done" },
  // pot-actions.ts
  startGameAction: { rule: "acct", via: "me" },
  removeMoveAction: { rule: "acct", via: "me" },
  adjustAction: { rule: "acct", via: "me" },
  finishGameAction: { rule: "acct", via: "me" },
  reopenGameAction: { rule: "acct", via: "me" },
  deleteGameAction: { rule: "acct", via: "me" },
  addPlayerAction: { rule: "acct", via: "me" },
  buyInAction: { rule: "own", marks: ["ownPlayerRefusal("] },
  cashOutAction: { rule: "own", marks: ["ownPlayerRefusal("] },
  countOutAction: { rule: "acct", via: "me" },
  renamePlayerAction: { rule: "acct", via: "me" },
  markGamePaidAction: { rule: "acct", via: "me" },
  // reaction-actions.ts
  reactAction: { rule: "open" },
  // ai-actions.ts
  readLineAction: { rule: "open", note: "decided: consent and rate limit already work per phone for a name with no account (ai-consent.ts)" },
  getAiConsentAction: { rule: "open" },
  setAiConsentAction: { rule: "open" },
  saveAiConsentForm: { rule: "open" },
  // arrive/actions.ts, passport/send/actions.ts
  confirmArrival: { rule: "done" },
  sendPassportAction: { rule: "done" },
  // wish-actions.ts
  addWishesAction: { rule: "done" },
  removeWishAction: { rule: "done" },
  shareWishesAction: { rule: "done" },
  planTogetherAction: { rule: "done" },
  // pay-actions.ts
  savePayWays: { rule: "done" },
  confirmPaymentAction: { rule: "open", note: "only the person paid" },
  rejectPaymentAction: { rule: "open", note: "only the person paid" },
  markAllPaidAction: { rule: "acct", marks: ["gateGuest("] },
  // bill-actions.ts
  saveBill: { rule: "acct", via: "me" },
  changeBill: { rule: "acct", via: "me" },
  toggleMissedDay: { rule: "acct", via: "me" },
  listAdd: { rule: "open", note: "shopping list" },
  listToggle: { rule: "open", note: "shopping list" },
  listRemove: { rule: "open", note: "shopping list" },
  listBuy: { rule: "open", note: "shopping list" },
  listGoingShopping: { rule: "open", note: "shopping list" },
  saveBudgets: { rule: "acct", via: "me" },
  setMoveIn: { rule: "acct", via: "me" },
  moveOutAction: { rule: "acct", via: "me" },
  saveDeposit: { rule: "acct", via: "me" },
  returnDeposit: { rule: "acct", via: "me" },
  saveGoal: { rule: "acct", via: "me" },
  addGoalEntry: { rule: "acct", via: "me" },
  deleteGoal: { rule: "acct", via: "me" },
  tripFromGoal: { rule: "acct", via: "me" },
};

// Routes that change data (not server actions): the rule for each.
export const ROUTE_RULES: Record<string, RuleEntry> = {
  "src/app/api/moment/route.ts": { rule: "open", note: "guest moments (section 2f)" },
  "src/app/api/receipt/route.ts": { rule: "open" },
  "src/app/api/group-photo/[id]/route.ts": { rule: "acct", marks: ["gateGuest("] },
  "src/app/api/push/route.ts": { rule: "open" },
  "src/app/api/tz/route.ts": { rule: "open" },
};
