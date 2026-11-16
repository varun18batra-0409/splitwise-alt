import { parsePayers } from "./payers";
import { chargeLock, chargeLockedText } from "./home/charge-lock";
import { LEFT_ERROR } from "./active";
import { db } from "./db";
import { withRetry } from "./once";
import { diffExpense, expenseState, itemsForState, logEvent, markUndone, parseDetails, parseUndo, touchedByExpense, UndoTaken, type UndoMark, type UndoPayload } from "./events";
import { POT_EDIT_ERROR, setExpenseDeleted, setPaymentDeleted } from "./save-expense";
import { isGameResult } from "./pot-result";
import { NOT_RECEIVED_TEXT_START, onlyReceiverCanBringBack, receiverOnlyText } from "./refused-payment";
import { formatPercent } from "./money";
import { setMember } from "./people";
import { isPairGroup, PAIR_NO_PEOPLE } from "./direct-guard";
import { applySettleAll, setPaymentsDeleted } from "./settle-all";
import { loadOtherMoney, sameOtherMoney, writeOtherMoney } from "./group-changes";
import { isGroupAdmin } from "./group-admin";
import { MOVE_OUT_GONE_FOR_GOOD, MOVE_OUT_LEAVER_FIXABLE, moveOutUndoBlock, undoMoveOut } from "./home/moving-db";
import { lateMoveText, lateRecreateText, lateRemovalText, putBackOpen } from "./put-back";
import { DEFAULT_TIME_ZONE } from "./dates";
import { GroupChanged, groupChangedText, guardGroup, leaverBalanceBreaks, peopleInExpense } from "./money-guard";

// Undo any change in a group. Undoing is itself a logged change that everyone
// is notified about, and it can be undone too ("redo").
//
// Safety rules, so an undo never overwrites newer work:
// - a change to an expense or payment can be undone only while it's the latest
//   change to that expense or payment;
// - a group setting change only while it's the latest change of that kind;
// - a currency change only while no money has changed since;
// - people can only be removed again if they aren't in any expense or payment;
// - putting someone with their own account back (undoing their removal or move-out) works only for whoever made that
//   change, and only within 10 minutes of it (put-back.ts). Their own undo of their own move-out has no time limit.

type EventLike = {
  id: string;
  kind: string;
  undo: string;
  undoneAt: Date | null;
  expenseId: string | null;
  paymentId: string | null;
  createdAt: Date;
  // Optional: with these the "can't undo yet" message can say who changed what (see blockedMessage).
  actorId?: string;
  text?: string;
  details?: string; // the saved lines (JSON); read for old move-outs (see historyCheck)
};

const MONEY_KINDS = new Set([
  "expense_added", "expense_edited", "expense_deleted", "expense_restored",
  "payment_recorded", "payment_deleted", "payment_restored", "currency_changed", "group_settled_closed",
  // Card games and bills add or remove money too.
  "pot_finished", "pot_reopened", "pot_deleted", "bill_changed",
]);

// Close and reopen are one setting; members added/removed are one list.
const settingFamily = (kind: string) =>
  kind === "group_closed" || kind === "group_reopened" || kind === "group_settled_closed" ? "open-state" : kind === "members_added" || kind === "members_removed" ? "members" : kind;

const later = (a: EventLike, b: EventLike) =>
  a.createdAt.getTime() > b.createdAt.getTime() || (a.createdAt.getTime() === b.createdAt.getTime() && a.id > b.id);

// Can this change still be undone? Pure, so the screens can show/hide the Undo button with exactly the server's rules:
// canUndo = viewerRefusal, then historyCheck, then actorRefusal (undoEvent runs the same three, in the same order).
export type CanUndo = { ok: true } | { ok: false; reason: string; blockedBy?: EventLike };

// The person looking or acting. `members` is the FULL member list of the group (not the leaver-scoped one).
export type UndoViewer = {
  id: string;
  isAdmin: boolean; // await isGroupAdmin(groupId, id)
  closed: boolean; // the group is closed right now (most undos of money are refused in a closed group, as the server does)
  members: { id: string; name: string; accountId: string | null; leftAt: Date | null; removedAt: Date | null }[];
  // The group's payments (when the screen has them): lets the Undo check see WHO took a payment off, as the server does (setPaymentDeleted).
  // fromId and toId: Only the payer and the person paid can undo a payment (the Undo for someone who recorded it for others lasts 10 minutes).
  payments?: { id: string; fromId: string; toId: string; deletedById: string | null }[];
};

// Who may use Undo at all: someone in the group. Someone who left can't change the group, except to undo their OWN "left the group"
// (and not if the admin has removed them since).
export function viewerRefusal(ev: EventLike, viewer: UndoViewer): string | null {
  const me = viewer.members.find((m) => m.id === viewer.id);
  if (!me) return "Only people in this group can undo its changes.";
  const early = parseUndo(ev.undo);
  const ownLeave = early?.type === "member_set" && early.data.leftAt === null && !("removedAt" in early.data) && ev.kind === "member_left" && early.memberId === viewer.id;
  if (me.leftAt && (!ownLeave || me.removedAt)) return LEFT_ERROR;
  return null;
}

// An old move-out (saved before Undo could also take back the bill shares and square-up payments) that did move money.
// Its lines: a daily-bill charge and the deposit handing are covered by the old undo; anything else (bills moved to the others,
// "X paid Y" payments) is not.
const legacyMovedMoney = (lines: string[]) => lines.some((l) => !/, charged now$/.test(l) && !/^Deposit .+ taken over by /.test(l));

// Is the change itself still undoable: not undone, and nothing newer stands in its way.
export function historyCheck(ev: EventLike, all: EventLike[], nameOf?: (memberId: string) => string | undefined): CanUndo {
  const payload = parseUndo(ev.undo);
  if (!payload) return { ok: false, reason: "This change can’t be undone." };
  if (ev.undoneAt) return { ok: false, reason: "This change was already undone." };
  // One of a move-out's own lines (a bill change, the daily charge, a square-up payment) is undone with the move-out, never on its own.
  // (Those lines are saved just before the move-out's line, so the move-out may be "same moment": it is looked for in all of `all`.)
  for (const x of all) {
    if (x.id === ev.id || x.undoneAt) continue;
    const q = parseUndo(x.undo);
    if (q?.type === "member_set" && q.data.leftAt === null && q.moveOut?.money?.eventIds.includes(ev.id)) {
      const who = nameOf?.(q.memberId);
      const of = `${who ? `${who}’s` : "a"} move-out`;
      // "Undo the move-out instead" only while the move-out itself can still be undone (not after a rejoin, an accepted invitation or a removal).
      return { ok: false, reason: historyCheck(x, all, nameOf).ok ? `This was part of ${of}. Undo the move-out instead.` : `This was part of ${of}, so it can’t be undone on its own.` };
    }
  }
  const moveOut = payload.type === "member_set" && payload.data.leftAt === null ? payload.moveOut : undefined;
  if (moveOut && !moveOut.money && legacyMovedMoney(parseDetails(ev.details ?? ""))) {
    return { ok: false, reason: "This move-out was saved before Undo could also take back the square-up payments and bill shares, so it can’t be undone. You can rejoin from People, then fix the payments in Activity." };
  }
  const newer = all.filter((x) => x.id !== ev.id && later(x, ev)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  // The first newer change that stands in the way (so the message can name it).
  const block = (reason: string, pred: (x: EventLike) => boolean): CanUndo | null => {
    const x = newer.find(pred);
    return x ? { ok: false, reason, blockedBy: x } : null;
  };
  // A move-out's own lines (bill changes, daily charge, square-up payments) are not "newer changes" to what it changed.
  const own = new Set(moveOut?.money?.eventIds ?? []);
  const resplitIds = new Set((moveOut?.money?.shares ?? []).map((x) => x.expenseId));
  for (const x of moveOut?.prepaid ?? []) resplitIds.add(x.expenseId);
  const squareUpIds = new Set((moveOut?.money?.payments ?? []).map((x) => x.id));

  const checks: (CanUndo | null)[] = [
    ev.expenseId ? block("This expense was changed again since. Undo the newer change first.", (x) => x.expenseId === ev.expenseId) : null,
    ev.paymentId ? block("This payment was changed again since. Undo the newer change first.", (x) => x.paymentId === ev.paymentId) : null,
    payload.type === "group_set" ? block("This setting was changed again since. Undo the newer change first.", (x) => settingFamily(x.kind) === settingFamily(ev.kind)) : null,
    payload.type === "members_remove" || payload.type === "members_restore"
      ? block("People were added or removed again since. Undo the newer change first.", (x) => settingFamily(x.kind) === "members")
      : null,
    payload.type === "settle_all"
      ? block("The group or those payments changed since. Undo the newer change first.", (x) => settingFamily(x.kind) === "open-state" || Boolean(x.paymentId && payload.paymentIds.includes(x.paymentId)))
      : null,
    payload.type === "payments_set"
      ? block("One of those payments changed since. Undo the newer change first.", (x) => Boolean(x.paymentId && payload.paymentIds.includes(x.paymentId)))
      : null,
    payload.type === "member_set"
      ? block("This person was changed again since. Undo the newer change first.", (x) => {
          const q = parseUndo(x.undo);
          return q?.type === "member_set" && q.memberId === payload.memberId && ("name" in q.data) === ("name" in payload.data);
        })
      : null,
    moveOut ? block("The group currency changed after the move-out, so it can’t be undone.", (x) => x.kind === "currency_changed") : null,
    moveOut?.money
      ? block(
          "Something the move-out changed (a bill or a square-up payment) was changed again since. Undo the newer change first.",
          // (The person paid answering "Got it" is not a change to the payment: a confirmed payment is real money and stays, see undoMoveOut.)
          (x) => !own.has(x.id) && x.kind !== "payment_confirmed" && Boolean((x.expenseId && resplitIds.has(x.expenseId)) || (x.paymentId && squareUpIds.has(x.paymentId))),
        )
      : null,
    payload.type === "currency_restore" ? block("Expenses or payments changed after the currency change, so it can’t be undone safely.", (x) => MONEY_KINDS.has(x.kind)) : null,
  ];
  return checks.find((c) => c !== null) ?? { ok: true };
}

// What only some people may do, whoever's screen it is. Word for word what undoEvent used to check inline.
// Undoing someone's own leaving (leaving the group, or a move-out) would put them back without their say, so only they can do it
// (a name nobody has claimed has no one to ask, so anyone can). The admin invites them back instead.
// Also refused: anyone else undoing something the person did to THEMSELF (their own leave, or their own undo of a rejoin) that would
// put them back in. The only undo of that kind allowed to someone else is the admin's own removal action (the event is the admin's).
// The person who took someone with an account out can undo that, but only for 10 minutes (put-back.ts); after that the person is invited back.
export function actorRefusal(ev: EventLike, viewer: UndoViewer, now: Date): string | null {
  const payload = parseUndo(ev.undo);
  if (!payload) return null;
  const actorId = viewer.id;
  const find = (id: string) => viewer.members.find((m) => m.id === id);
  if (payload.type === "member_set" && payload.data.leftAt === null && payload.memberId !== actorId) {
    const who = find(payload.memberId);
    if (who?.accountId) {
      const own = ev.actorId === payload.memberId;
      const recordedLeave = ev.kind === "member_left" && !("removedAt" in payload.data); // a move-out or "marked as left"
      if (own || (recordedLeave && ev.actorId !== actorId)) return `Only ${who.name} can undo leaving the group. You can invite them back from People.`;
      // A removal made by someone else (the admin may have changed since): only whoever made it can undo it.
      if (ev.actorId !== actorId) return `Only the person who removed ${who.name} can undo that. You can invite them back from People.`;
      if (!putBackOpen(ev.createdAt, now)) return recordedLeave ? lateMoveText(who.name) : lateRemovalText(who.name);
    }
  }
  // Likewise undoing someone's own coming back (accepting an invitation, rejoining) would push them out: only they can.
  if (payload.type === "member_set" && ev.kind === "member_rejoined" && payload.memberId !== actorId) {
    const who = find(payload.memberId);
    if (who?.accountId) return `Only ${who.name} can undo rejoining the group.`;
  }
  // The person checks of undoing a move-out itself (the same words undoMoveOut gives).
  if (payload.type === "member_set" && payload.moveOut && payload.data.leftAt === null) {
    const m = find(payload.memberId);
    if (!m) return "That person is no longer in the group.";
    if (!m.leftAt) return `${m.name} is already back in the flat.`;
    if (m.removedAt) return `${m.name} was removed from the group, so the move-out can’t be undone.`;
  }
  // Re-creating someone with their own account (undoing an undo of "joined" or of "added people") needs the same care: only whoever
  // made that change, for 10 minutes. Every event that restores member rows has this payload, so this covers them all.
  if (payload.type === "members_restore") {
    const holder = payload.members.find((m) => m.accountId);
    if (holder && ev.actorId !== actorId) return `Only the person who made that change can undo it. You can add ${holder.name} again with Add people.`;
    if (holder && !putBackOpen(ev.createdAt, now)) return lateRecreateText(holder.name);
  }
  // Only the payer and the person paid can take a payment off or put it back, and only for payments the screen knows about (the server
  // reads the payment itself). Someone who recorded it for others (Mark paid, Mark all paid, Settle everything) may Undo it for 10 minutes.
  const recorder = ev.actorId === actorId && putBackOpen(ev.createdAt, now);
  if (!recorder && (payload.type === "payment_delete" || payload.type === "payment_restore")) {
    const pay = viewer.payments?.find((x) => x.id === payload.paymentId);
    if (pay && pay.fromId !== actorId && pay.toId !== actorId) return `Only ${find(pay.fromId)?.name ?? "the payer"} or ${find(pay.toId)?.name ?? "the person paid"} can change this payment.`;
  }
  if (!recorder && (payload.type === "payments_set" || payload.type === "settle_all")) {
    const pays = payload.paymentIds.map((id) => viewer.payments?.find((x) => x.id === id));
    if (pays.every((x) => x) && !pays.every((x) => x!.fromId === actorId || x!.toId === actorId)) return "Only the people in each payment can take these off.";
  }
  // The person paid said "Not received" (or deleted the payment themselves): only they can bring it back, so nobody can overrule them.
  // Lines written before the flag existed are recognised by their words. (The server also reads the payment itself: setPaymentDeleted.)
  if (payload.type === "payment_restore" && ev.actorId !== actorId) {
    // Older lines have no flag: the payment itself says whether the person paid took it off (deletedById is the receiver).
    const pay = viewer.payments?.find((x) => x.id === payload.paymentId);
    const byReceiver = payload.byReceiver === true || (ev.kind === "payment_deleted" && Boolean(ev.text?.startsWith(NOT_RECEIVED_TEXT_START))) || (pay ? onlyReceiverCanBringBack(pay, actorId) : false);
    if (byReceiver) return receiverOnlyText(find(pay?.toId ?? ev.actorId ?? "")?.name ?? "the person who was paid");
  }
  // A closed group refuses these undos on the server (reopen it first), so the screen never offers them.
  if (payload.type === "member_set" && payload.moveOut && payload.data.leftAt === null && viewer.closed) return CLOSED_MOVE_OUT_TEXT;
  if (viewer.closed && (payload.type === "expense_delete" || payload.type === "expense_restore" || payload.type === "expense_revert")) return "This group is closed. Reopen it to change expenses.";
  if (viewer.closed && (payload.type === "payment_delete" || payload.type === "payment_restore" || payload.type === "payments_set")) return "This group is closed. Reopen it to change payments.";
  if (payload.type === "settle_all") {
    if (!payload.apply && !viewer.closed) return "The group was reopened since, so this can’t be undone. Delete the payments one by one instead.";
    if (payload.apply && viewer.closed) return "The group is already closed.";
  }
  const adminOnly =
    payload.type === "currency_restore" ||
    ((payload.type === "members_remove" || payload.type === "members_restore") && ev.actorId !== actorId) ||
    (payload.type === "member_set" && "leftAt" in payload.data && payload.memberId !== actorId && ev.actorId !== actorId);
  if (adminOnly && !viewer.isAdmin) return "Only the person who looks after this group can undo that.";
  return null;
}

// Can this viewer undo this change right now? The screens and the server both ask this.
export function canUndo(ev: EventLike, all: EventLike[], now: Date, viewer: UndoViewer): CanUndo {
  const refused = viewerRefusal(ev, viewer);
  if (refused) return { ok: false, reason: refused };
  const history = historyCheck(ev, all, (id) => viewer.members.find((m) => m.id === id)?.name);
  if (!history.ok) return history;
  const no = actorRefusal(ev, viewer, now);
  return no ? { ok: false, reason: no } : { ok: true };
}

// The payments a change is about (for the party-only rule): the screens that show an Undo for one change fill UndoViewer.payments with these.
export async function paymentsForUndo(groupId: string, undo: string): Promise<NonNullable<UndoViewer["payments"]>> {
  const early = parseUndo(undo);
  const ids = early && (early.type === "payment_delete" || early.type === "payment_restore") ? [early.paymentId] : early && (early.type === "payments_set" || early.type === "settle_all") ? early.paymentIds : [];
  return ids.length ? db.payment.findMany({ where: { id: { in: ids }, groupId }, select: { id: true, fromId: true, toId: true, deletedById: true } }) : [];
}

// The viewer as the server sees them (for pages that don't already hold the member list).
export async function undoViewerFor(groupId: string, memberId: string): Promise<UndoViewer> {
  const members = await db.member.findMany({ where: { groupId }, select: { id: true, name: true, accountId: true, leftAt: true, removedAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return { id: memberId, isAdmin: await isGroupAdmin(groupId, memberId), closed: await isClosed(groupId), members };
}

export const CLOSED_MOVE_OUT_TEXT = "The group is closed, so the move-out can’t be undone. Ask someone in the flat to reopen it.";
// What someone who has left is told when the Undo of their own move-out is blocked: never who did what after they left.
export const LEAVER_BLOCKED_TEXT = MOVE_OUT_LEAVER_FIXABLE;
// …and when nothing is left to fix (a currency change, a rejoin or other change to the person, a counted "I've paid").
export const LEAVER_GONE_TEXT = MOVE_OUT_GONE_FOR_GOOD;
// Sent to People when someone tries to rejoin plainly (join link, Rejoin button) while their move-out can still be undone.
export const MOVED_OUT_REJOIN_TEXT = "You moved out with Loopin. Tap Undo my move-out to get your bills and deposit back, or Rejoin without undoing.";

// Of a group's recent lines (newest first), the move-out of this member that is still there to undo: the newest one that is not undone,
// unless that member came back (a newer, not-undone "rejoined" line) since, which leaves the old move-out as history.
export function pickOwnMoveOut<E extends EventLike>(events: E[], memberId: string): E | null {
  const sorted = [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  const found = sorted.find((e) => {
    if (e.kind !== "member_left" || e.undoneAt) return false;
    const p = parseUndo(e.undo);
    return p?.type === "member_set" && p.memberId === memberId && Boolean(p.moveOut) && p.data.leftAt === null;
  });
  if (!found) return null;
  const cameBack = sorted.some((e) => {
    if (e.kind !== "member_rejoined" || e.undoneAt || !later(e, found)) return false;
    const p = parseUndo(e.undo);
    return p?.type === "member_set" && p.memberId === memberId;
  });
  return cameBack ? null : found;
}

// For someone who has LEFT, a refusal never names anybody else or what they did: a later change to the bills gets one plain line
// (fixable: someone in the flat undoes it), and anything that can't be fixed any more says so. The closed-group and old-move-out
// texts name no one and stay as they are. Only for move-outs (a plain leave's refusals name nobody already).
export function leaverFacing(ev: EventLike, c: Extract<CanUndo, { ok: false }>): string {
  const p = parseUndo(ev.undo);
  if (!c.blockedBy || p?.type !== "member_set" || !p.moveOut) return c.reason;
  if (c.reason.startsWith("This person was changed again") || c.reason.startsWith("The group currency changed")) return LEAVER_GONE_TEXT;
  return LEAVER_BLOCKED_TEXT;
}

// Would the server allow this person to undo this line of their own (their leave or move-out), against the FULL history?
// (The leaver's own screens only hold the history trimmed to what they may see, which hides newer edits that don't touch them.)
// For a move-out this also asks the same read-only questions undoMoveOut asks before it writes (deposit, month bills, someone gone,
// a counted "I've paid"…), so the button is only shown when the undo can go through. The reason is already safe to show them.
async function ownLeaveCheck(groupId: string, event: EventLike, viewer: UndoViewer, now: Date): Promise<CanUndo> {
  const newer = await db.groupEvent.findMany({ where: { groupId, createdAt: { gte: event.createdAt } } });
  const check = canUndo(event, newer, now, viewer);
  if (!check.ok) return { ok: false, reason: leaverFacing(event, check) };
  const p = parseUndo(event.undo);
  if (p?.type === "member_set" && p.moveOut && p.data.leftAt === null) {
    const block = await moveOutUndoBlock(db, groupId, p.memberId, p.moveOut);
    if (block) return { ok: false, reason: block.leaver };
  }
  return check;
}
const isClosed = async (groupId: string) => Boolean((await db.group.findUnique({ where: { id: groupId }, select: { closed: true } }))?.closed);

// The viewer's own move-out, if they moved out and can still look at undoing it: the line, and whether the server would allow it.
// Null unless they have left on their own (not removed).
export async function ownMoveOut(groupId: string, viewer: UndoViewer, now: Date) {
  const me = viewer.members.find((m) => m.id === viewer.id);
  if (!me?.leftAt || me.removedAt) return null;
  const order = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  const [moves, rejoins] = await Promise.all([
    db.groupEvent.findMany({ where: { groupId, kind: "member_left", undoneAt: null, undo: { contains: '"moveOut"' } }, orderBy: order, take: 20 }),
    db.groupEvent.findMany({ where: { groupId, kind: "member_rejoined", undoneAt: null, undo: { contains: `"memberId":"${viewer.id}"` } }, orderBy: order, take: 20 }),
  ]);
  const event = pickOwnMoveOut([...moves, ...rejoins], viewer.id);
  if (!event) return null;
  return { event, check: await ownLeaveCheck(groupId, event, viewer, now) };
}

// For someone who has left: the Undo answer for each of their own leave / move-out lines, from the full history (what the server will do).
// Empty for anyone still in the group, or removed (they can't undo anything).
export async function leaverUndoChecks(groupId: string, viewer: UndoViewer, now: Date): Promise<Map<string, CanUndo>> {
  const out = new Map<string, CanUndo>();
  const me = viewer.members.find((m) => m.id === viewer.id);
  if (!me?.leftAt || me.removedAt) return out;
  const rows = await db.groupEvent.findMany({
    where: { groupId, kind: "member_left", undoneAt: null, undo: { contains: `"memberId":"${viewer.id}"` } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
  });
  const mine = rows.filter((e) => {
    const p = parseUndo(e.undo);
    return p?.type === "member_set" && p.memberId === viewer.id && p.data.leftAt === null;
  });
  if (!mine.length) return out;
  for (const e of mine) out.set(e.id, await ownLeaveCheck(groupId, e, viewer, now));
  return out;
}

// "Can’t undo yet: Ravi changed Dinner after this (2:14 pm). Undo that first in Activity, or edit Dinner."
// Names the change that stands in the way. Falls back to the plain reason when it can't tell who or what.
export function blockedMessage(check: Extract<CanUndo, { ok: false }>, ctx: { nameOf: (memberId: string) => string | undefined; tz: string }): string {
  const x = check.blockedBy;
  if (!x || !x.actorId || !x.text) return check.reason;
  const who = ctx.nameOf(x.actorId);
  if (!who) return check.reason;
  const time = x.createdAt.toLocaleTimeString("en-IN", { timeZone: ctx.tz, hour: "numeric", minute: "2-digit" });
  // "changed Dinner", "added Dinner (₹900)", "deleted Dinner": the thing is what follows the verb.
  const thing = /^(?:changed|edited|deleted|restored|added|removed)\s+(?:money back:\s+)?(.+?)(?:\s+\([^)]*\))?$/.exec(x.text)?.[1];
  const isExpense = x.kind.startsWith("expense_");
  const tail = isExpense
    ? thing
      ? `Undo that first in Activity, or edit ${thing}.`
      : "Undo that first in Activity."
    : x.kind.startsWith("payment_")
      ? "Undo that first in Activity."
      : "Undo that first in Activity, or change it again in Settings.";
  return `Can’t undo yet: ${who} ${x.text.replace(/\s+\([^)]*\)$/, "")} after this (${time}). ${tail}`;
}

type UndoResult = { ok: true; eventId?: string } | { ok: false; error: string };

// `memberships`: group id -> my member id (the pages pass getMemberships()), so a payment across several groups finds who I am in each.
export async function undoEvent(eventId: string, actorId: string | undefined, tz: string = DEFAULT_TIME_ZONE, opts: { memberships?: Record<string, string> } = {}): Promise<UndoResult> {
  return withRetry(() => undoOnce(eventId, actorId, tz, opts));
}

async function undoOnce(eventId: string, actorId: string | undefined, tz: string, opts: { memberships?: Record<string, string> }): Promise<UndoResult> {
  const now = new Date();
  const ev = await db.groupEvent.findUnique({ where: { id: eventId } });
  if (!ev) return { ok: false, error: "That change no longer exists." };
  const group = await db.group.findUnique({
    where: { id: ev.groupId },
    // Only changes from this one on matter for whether it can still be undone.
    include: { members: true, events: { where: { createdAt: { gte: ev.createdAt } } } },
  });
  if (!group) return { ok: false, error: "This group no longer exists." };
  if (!actorId || !group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can undo its changes." };
  // The same three rules the screens use (canUndo), in this order, so the messages stay the same:
  // who may use Undo at all, then whether anything newer stands in the way, then what only some people may do.
  // The payments this change is about, so the party-only rule reads who is in each (the screens fill the same list).
  const payRows = await paymentsForUndo(ev.groupId, ev.undo);
  const viewer: UndoViewer = { id: actorId, isAdmin: await isGroupAdmin(group.id, actorId), closed: group.closed, members: group.members, ...(payRows.length ? { payments: payRows } : {}) };
  const actorLeft = Boolean(group.members.find((m) => m.id === actorId)?.leftAt);
  const refused = viewerRefusal(ev, viewer);
  if (refused) return { ok: false, error: refused };

  if (group.deletedAt) return { ok: false, error: "This group was deleted. Restore it first." };

  const check = historyCheck(ev, group.events, (id) => group.members.find((m) => m.id === id)?.name);
  if (!check.ok) {
    const nameOf = (id: string) => (id === actorId ? "You" : group.members.find((m) => m.id === id)?.name);
    // Someone who has left is never told who changed what after they left.
    return { ok: false, error: actorLeft ? leaverFacing(ev, check) : blockedMessage(check, { nameOf, tz }) };
  }
  const payload = parseUndo(ev.undo)!;
  const no = actorRefusal(ev, viewer, now);
  if (no) return { ok: false, error: no };

  // The "undone" mark is written inside the reversal's own transaction (see markUndone), so it is saved together
  // with the reversal or not at all. Two people at once, or a repeated tap, can never undo the same change twice:
  // the mark only takes if nobody else's did, and the loser's whole reversal is rolled back.
  const mark: UndoMark = { eventId: ev.id, actorId };
  let result: UndoResult;
  try {
    // Someone who recorded it for others may Undo it for 10 minutes: the payment code then lets them through (it reads the same window).
    const recorderOk = ev.actorId === actorId && putBackOpen(ev.createdAt, now);
    result = await apply(payload, ev.groupId, actorId, ev.text, mark, { actorId: ev.actorId, createdAt: ev.createdAt }, { memberships: opts.memberships, recorderOk });
  } catch (err) {
    if (err instanceof UndoTaken) return { ok: false, error: err.message };
    throw err;
  }
  // A reversal that found nothing left to do (it was already in that state) wrote no transaction of its own:
  // the change is still marked as undone, as it always was.
  if (result.ok) await db.groupEvent.updateMany({ where: { id: ev.id, undoneAt: null }, data: { undoneAt: new Date(), undoneById: actorId } });
  return result;
}

async function apply(p: UndoPayload, groupId: string, actorId: string, originalText: string, mark: UndoMark, ev: { actorId: string; createdAt: Date }, who: { memberships?: Record<string, string>; recorderOk: boolean }): Promise<UndoResult> {
  switch (p.type) {
    case "expense_delete":
      return fromResult(await setExpenseDeleted(p.expenseId, actorId, true, { mark }));
    case "expense_restore":
      return fromResult(await setExpenseDeleted(p.expenseId, actorId, false, { undoing: true, mark }));
    case "payment_delete":
      return fromResult(await setPaymentDeleted(p.paymentId, actorId, true, { mark, memberships: who.memberships, recorderOk: who.recorderOk }));
    case "payment_restore":
      return fromResult(await setPaymentDeleted(p.paymentId, actorId, false, { undoing: true, mark, memberships: who.memberships, recorderOk: who.recorderOk }));
    case "expense_revert":
      return revertExpense(p.expenseId, p.before, actorId, { mark });
    case "group_set":
      return applyGroupSettings(groupId, actorId, p.data, originalText, mark);
    case "currency_restore":
      return restoreCurrency(groupId, actorId, p, { mark });
    case "members_remove":
      return removeMembers(groupId, actorId, p.memberIds, true, mark);
    case "members_restore":
      return restoreMembers(groupId, actorId, p.members, mark);
    case "settle_all":
      return fromResult(await applySettleAll(groupId, actorId, p.paymentIds, p.apply, { mark, recorderOk: who.recorderOk }));
    case "payments_set":
      return fromResult(await setPaymentsDeleted(groupId, actorId, p.paymentIds, p.deleted, { mark, recorderOk: who.recorderOk }));
    case "member_set":
      if (p.moveOut && p.data.leftAt === null) return fromResult(await undoMoveOut(groupId, actorId, p.memberId, p.moveOut, mark, { recordedBy: ev.actorId, recordedAt: ev.createdAt }));
      return fromResult(await setMember(groupId, actorId, p.memberId, p.data, true, { mark }));
  }
}

function fromResult(r: { ok: true; eventId?: string } | { ok: false; error: string }): UndoResult {
  return r.ok ? { ok: true, eventId: r.eventId } : r;
}

export const REVERT_CLASH = "Someone changed this expense a moment ago, so it wasn’t undone. Open it again to see the latest version.";

// The people and amounts of a set of shares, as one comparable text.
const sharesSig = (xs: { memberId: string; amount: number }[]) => xs.map((x) => `${x.memberId}:${x.amount}`).sort().join("|");

// Put an expense back exactly as it was before an edit: its fields, its shares and (for edits saved with them) its bill's
// item lines. `afterRead` is for tests only: it runs after the reads and before the write begins.
export async function revertExpense(expenseId: string, before: Parameters<typeof expenseState>[0], actorId: string, opts: { afterRead?: () => Promise<void>; mark?: UndoMark } = {}): Promise<UndoResult> {
  const e = await db.expense.findUnique({ where: { id: expenseId }, include: { shares: true, items: { orderBy: [{ position: "asc" }, { id: "asc" }] }, group: { include: { members: true } } } });
  if (!e) return { ok: false, error: "That expense no longer exists." };
  if (e.group.closed) return { ok: false, error: "This group is closed. Reopen it to change expenses." };
  if (e.deletedAt) return { ok: false, error: "This expense is deleted. Restore it first." };
  if (await isGameResult(expenseId)) return { ok: false, error: POT_EDIT_ERROR };
  if (before.baseCurrency !== e.group.currency) return { ok: false, error: "The group currency changed since, so this edit can’t be undone." };
  const locked = await chargeLock(db, e.groupId, expenseId);
  if (locked) return { ok: false, error: chargeLockedText(locked.bill, locked.status) };
  const memberIds = new Set(e.group.members.map((m) => m.id));
  if (!memberIds.has(before.paidById) || before.shares.some((s) => !memberIds.has(s.memberId)) || parsePayers(before.payers).some((p) => !memberIds.has(p.memberId))) {
    return { ok: false, error: "Someone in that version is no longer in the group." };
  }

  const nameOf = (id: string) => e.group.members.find((m) => m.id === id)?.name ?? "Someone";
  const { shares, items: beforeItems, ...fields } = before;
  const currency = e.group.currency;

  // People the restored version puts back who aren't in it now: they must still be in the group (not have left).
  const nowIn = new Set(peopleInExpense({ paidById: e.paidById, payers: parsePayers(e.payers), shares: e.shares }));
  const returning = peopleInExpense({ paidById: before.paidById, payers: parsePayers(before.payers), shares: before.shares }).filter((id) => !nowIn.has(id));

  // Everyone whose share or paid amount this undo changes: if one of them has left, their balance can't be changed.
  const movedByUndo = touchedByExpense(e, before);

  await opts.afterRead?.();
  // Checked again inside the transaction: a bill run could have counted the charge since the first look.
  let eventId: string;
  try {
   eventId = await db.$transaction(async (tx) => {
    // First a write: the group is still in this currency and open; then the expense is claimed as it was read. Any edit
    // since (even one that only changed the item lines) moved editedAt, so this undo would overwrite newer work: refused.
    await guardGroup(tx, e.groupId, { currency });
    await markUndone(tx, opts.mark);
    const claim = await tx.expense.updateMany({ where: { id: expenseId, editedAt: e.editedAt, deletedAt: null }, data: { editedAt: new Date() } });
    if (claim.count !== 1) throw new RevertClash();
    const lockedNow = await chargeLock(tx, e.groupId, expenseId);
    if (lockedNow) throw new ChargeLockedNow(lockedNow.bill, lockedNow.status);
    // A leaver may only end with the balance they had, or 0.
    const back = { id: expenseId, paidById: before.paidById, amount: before.amount, payers: before.payers, kind: before.kind, shares: before.shares };
    const gone = await leaverBalanceBreaks(tx, e.groupId, [...new Set([...returning, ...movedByUndo])], (l) => ({ ...l, expenses: [...l.expenses.filter((x) => x.id !== expenseId), back] }));
    if (gone.length) throw new GroupChanged("left", gone[0]);
    // What it is now, read inside the transaction: this is what "redo" puts back.
    const [curShares, curItems] = await Promise.all([
      tx.expenseShare.findMany({ where: { expenseId } }),
      tx.expenseItem.findMany({ where: { expenseId }, orderBy: [{ position: "asc" }, { id: "asc" }] }),
    ]);
    const current = expenseState({ ...e, shares: curShares, items: curItems });
    // Item lines: put back as saved. A change saved before item lines were kept says nothing about them: if the bill has
    // lines now and the restored shares no longer match what they add up to, clear the lines (they would be wrong).
    let itemsAfter: NonNullable<typeof current.items> | null = null; // null = leave them
    const savedItems = itemsForState(beforeItems);
    if (savedItems) itemsAfter = savedItems.map((i) => ({ name: i.name, amount: i.amount, people: i.people.filter((p) => memberIds.has(p)) }));
    else if (curItems.length && sharesSig(curShares) !== sharesSig(shares)) itemsAfter = [];
    const itemsChanged = itemsAfter !== null && JSON.stringify(itemsAfter) !== JSON.stringify(current.items);
    const changes = diffExpense(current, before, nameOf);
    await tx.expenseShare.deleteMany({ where: { expenseId } });
    await tx.expense.update({
      where: { id: expenseId },
      data: { ...fields, payers: fields.payers ?? "", kind: fields.kind ?? "expense", spentAt: fields.spentAt ? new Date(fields.spentAt) : null, editedAt: new Date(), shares: { create: shares } },
    });
    if (itemsAfter) {
      await tx.expenseItem.deleteMany({ where: { expenseId } });
      if (itemsAfter.length) await tx.expenseItem.createMany({ data: itemsAfter.map((i, position) => ({ expenseId, position, name: i.name, amount: i.amount, people: JSON.stringify(i.people) })) });
    }
    return logEvent(tx, {
      groupId: e.groupId,
      actorId,
      kind: "expense_edited",
      text: `undid a change to ${before.description}`,
      details: changes.length ? changes : itemsChanged ? ["Item lines changed"] : [],
      expenseId,
      undo: { type: "expense_revert", expenseId, before: current },
      touches: touchedByExpense(current, before),
    });
   }, { timeout: 15000 });
  } catch (err) {
    if (err instanceof RevertClash) return { ok: false, error: REVERT_CLASH };
    if (err instanceof GroupChanged) {
      if (err.reason === "left") return { ok: false, error: `${err.detail || "Someone"} has left the group, so this can't be undone.` };
      return { ok: false, error: err.reason === "currency" ? "The group currency changed since, so this edit can’t be undone." : groupChangedText(err) };
    }
    if (err instanceof ChargeLockedNow) return { ok: false, error: chargeLockedText(err.message, err.status) };
    throw err;
  }
  return { ok: true, eventId };
}

class RevertClash extends Error {}
class ChargeLockedNow extends Error {
  constructor(bill: string, public status?: "adding" | "added" | "covered") {
    super(bill);
  }
}

// Rename / markup / second currency / close-reopen back to what it was.
async function applyGroupSettings(
  groupId: string,
  actorId: string,
  data: { name?: string; cardMarkupBp?: number; secondaryCurrency?: string; closed?: boolean; closedAt?: string | null },
  originalText: string,
  mark?: UndoMark,
): Promise<UndoResult> {
  const g = await db.group.findUnique({ where: { id: groupId } });
  if (!g) return { ok: false, error: "This group no longer exists." };

  const update: { name?: string; cardMarkupBp?: number; secondaryCurrency?: string; closed?: boolean; closedAt?: Date | null } = {};
  const redo: typeof data = {};
  const details: string[] = [];
  let kind: "group_renamed" | "markup_changed" | "display_currency_changed" | "group_closed" | "group_reopened" = "group_renamed";
  let text = `undid “${originalText}”`;

  if (data.name !== undefined) {
    update.name = data.name;
    redo.name = g.name;
    details.push(`Name: ${g.name} → ${data.name}`);
    kind = "group_renamed";
    text = `renamed the group back to “${data.name}”`;
  }
  if (data.cardMarkupBp !== undefined) {
    update.cardMarkupBp = data.cardMarkupBp;
    redo.cardMarkupBp = g.cardMarkupBp;
    details.push(`Card markup: ${formatPercent(g.cardMarkupBp)} → ${formatPercent(data.cardMarkupBp)}`);
    kind = "markup_changed";
    text = `set the card markup back to ${formatPercent(data.cardMarkupBp)}`;
  }
  if (data.secondaryCurrency !== undefined) {
    update.secondaryCurrency = data.secondaryCurrency;
    redo.secondaryCurrency = g.secondaryCurrency;
    kind = "display_currency_changed";
    text = `undid the second-currency change`;
  }
  if (data.closed !== undefined) {
    update.closed = data.closed;
    update.closedAt = data.closedAt ? new Date(data.closedAt) : data.closed ? new Date() : null;
    redo.closed = g.closed;
    redo.closedAt = g.closedAt ? g.closedAt.toISOString() : null;
    kind = data.closed ? "group_closed" : "group_reopened";
    text = data.closed ? "closed the group again (undo)" : "reopened the group (undo)";
  }

  const eventId = await db.$transaction(async (tx) => {
    await markUndone(tx, mark);
    await tx.group.update({ where: { id: groupId }, data: update });
    return logEvent(tx, { groupId, actorId, kind, text, details, undo: { type: "group_set", data: redo } });
  });
  return { ok: true, eventId };
}

// Put every amount back exactly as it was before a currency change.
// The expenses and payments exactly as they are (to tell whether anything moved between two looks).
const moneySig = (
  expenses: { id: string; amount: number; payers: string; deletedAt: Date | null; shares: { id: string; amount: number }[] }[],
  payments: { id: string; amount: number; deletedAt: Date | null }[],
) =>
  JSON.stringify([
    [...expenses].sort((a, b) => a.id.localeCompare(b.id)).map((e) => [e.id, e.amount, e.payers, e.deletedAt?.getTime() ?? 0, [...e.shares].sort((a, b) => a.id.localeCompare(b.id)).map((x) => [x.id, x.amount])]),
    [...payments].sort((a, b) => a.id.localeCompare(b.id)).map((x) => [x.id, x.amount, x.deletedAt?.getTime() ?? 0]),
  ]);

// `afterRead` is for tests only: it runs after the reads and before the write begins.
export async function restoreCurrency(groupId: string, actorId: string, p: Extract<UndoPayload, { type: "currency_restore" }>, opts: { afterRead?: () => Promise<void>; mark?: UndoMark } = {}): Promise<UndoResult> {
  const g = await db.group.findUnique({ where: { id: groupId }, include: { expenses: { include: { shares: true } }, payments: true } });
  if (!g) return { ok: false, error: "This group no longer exists." };
  const current: Extract<UndoPayload, { type: "currency_restore" }> = {
    type: "currency_restore",
    currency: g.currency,
    expenses: g.expenses.map((e) => ({
      id: e.id, baseCurrency: e.baseCurrency, exchangeRate: e.exchangeRate, rateSource: e.rateSource,
      convertedAmount: e.convertedAmount, markupAmount: e.markupAmount, amount: e.amount, payers: e.payers,
      shares: e.shares.map((s) => ({ id: s.id, amount: s.amount })),
    })),
    payments: g.payments.map((x) => ({ id: x.id, amount: x.amount })),
    other: await loadOtherMoney(groupId, g.settleMin),
    ...(p.other ? { after: p.other } : {}),
  };
  // Bills, budgets, goals, the deposit and card games don't all leave a history
  // entry when they change, so compare them with what the currency change left.
  // Anything added, removed or changed since → putting the old amounts back
  // would mix currencies or lose money, so refuse.
  if (p.after && current.other && !sameOtherMoney(current.other, p.after)) {
    return { ok: false, error: "Bills, budgets, goals, the deposit or a game changed after the currency change, so it can’t be undone safely. Change the currency again instead." };
  }
  await opts.afterRead?.();
  let eventId: string;
  try {
  eventId = await db.$transaction(async (tx) => {
    // First a write: the group is still in the currency this undo expects (closed is fine, as before).
    await guardGroup(tx, groupId, { currency: g.currency, allowClosed: true });
    await markUndone(tx, opts.mark);
    // Everything that holds money, looked at again now that nobody else can write: anything added or changed since the
    // first look (an expense in the gap) means putting the old amounts back would mix currencies, so refuse.
    const [ex, pay] = await Promise.all([
      tx.expense.findMany({ where: { groupId }, include: { shares: true } }),
      tx.payment.findMany({ where: { groupId } }),
    ]);
    if (moneySig(ex, pay) !== moneySig(g.expenses, g.payments)) throw new CurrencyMoved();
    // The first look above is the undo's own: money committed before it would match it. So also require that every live
    // expense and payment is one the currency change converted (it is listed in the saved payload).
    const converted = new Set(p.expenses.map((x) => x.id));
    const convertedPay = new Set(p.payments.map((x) => x.id));
    if (ex.some((x) => !x.deletedAt && !converted.has(x.id)) || pay.some((x) => !x.deletedAt && !convertedPay.has(x.id))) throw new CurrencyMoved();
    if (p.after && !sameOtherMoney(await loadOtherMoney(groupId, g.settleMin, tx), p.after)) throw new CurrencyMoved();
    // Rows removed since (a card game's result after it was reopened) are skipped.
    for (const e of p.expenses) {
      const { shares, id, ...fields } = e;
      await tx.expense.updateMany({ where: { id }, data: fields });
      for (const s of shares) await tx.expenseShare.updateMany({ where: { id: s.id }, data: { amount: s.amount } });
    }
    for (const x of p.payments) await tx.payment.updateMany({ where: { id: x.id }, data: { amount: x.amount } });
    if (p.other) await writeOtherMoney(tx, p.other);
    await tx.group.update({ where: { id: groupId }, data: { currency: p.currency, ...(p.other ? { settleMin: p.other.settleMin } : {}) } });
    return logEvent(tx, {
      groupId,
      actorId,
      kind: "currency_changed",
      text: `changed the group currency back to ${p.currency}`,
      details: [`Currency: ${g.currency} → ${p.currency}`, "Every amount is back exactly as it was"],
      undo: current,
    });
  }, { timeout: 15000 });
  } catch (err) {
    if (err instanceof CurrencyMoved) return { ok: false, error: "Expenses, payments or other money in the group changed after the currency change, so it can’t be undone safely. Change the currency again instead." };
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    throw err;
  }
  return { ok: true, eventId };
}

class CurrencyMoved extends Error {}

// Take back "added people" — only if they haven't been used anywhere yet.
export async function removeMembers(groupId: string, actorId: string, memberIds: string[], undoing = true, mark?: UndoMark): Promise<UndoResult> {
  if (memberIds.includes(actorId)) return { ok: false, error: "You can’t remove yourself. Use “Leave group” instead." };
  if (await isPairGroup(groupId)) return { ok: false, error: PAIR_NO_PEOPLE }; // a pair always has exactly its two people
  const members = await db.member.findMany({ where: { id: { in: memberIds }, groupId } });
  for (const m of members) {
    // Someone with their own account who has left or been removed is never taken out (or put back) by somebody else's undo:
    // their row, and the removal record on it, stay exactly as they are.
    if (m.accountId && (m.leftAt || m.removedAt)) return { ok: false, error: `${m.name} has left or been removed, so this can’t be undone.` };
    const used =
      (await db.expenseShare.count({ where: { memberId: m.id } })) +
      (await db.expense.count({ where: { groupId, OR: [{ paidById: m.id }, { createdById: m.id }, { payers: { contains: m.id } }] } })) +
      (await db.payment.count({ where: { OR: [{ fromId: m.id }, { toId: m.id }] } })) +
      // An "I've paid" claim (waiting or answered) counts as being part of a payment too.
      (await db.paymentClaim.count({ where: { OR: [{ fromId: m.id }, { toId: m.id }] } })) +
      // A moment they added, or a reaction they left, counts too: taking the person out would leave photos with no author (and their files behind).
      (await db.moment.count({ where: { groupId, authorId: m.id } })) +
      (await db.momentReaction.count({ where: { memberId: m.id } }));
    if (used > 0) return { ok: false, error: `${m.name} is already part of expenses, payments or moments, so they can’t be removed.` };
  }
  if (members.length === 0) return { ok: true };
  let eventId: string;
  try {
  eventId = await db.$transaction(async (tx) => {
    await markUndone(tx, mark);
    // The "account holder who left or was removed" check again, inside the write: a leave racing this undo can't get the row deleted.
    const del = await tx.member.deleteMany({ where: { id: { in: members.map((m) => m.id) }, groupId, OR: [{ accountId: null }, { leftAt: null, removedAt: null }] } });
    if (del.count !== members.length) throw new MembersMoved();
    return logEvent(tx, {
      groupId,
      actorId,
      kind: "members_removed",
      text: `removed ${members.map((m) => m.name).join(", ")}${undoing ? " (undo)" : " from the group"}`,
      undo: {
        type: "members_restore",
        members: members.map((m) => ({
          id: m.id,
          name: m.name,
          phone: m.phone,
          createdAt: m.createdAt.toISOString(),
          accountId: m.accountId,
          claimedAt: m.claimedAt?.toISOString() ?? null,
          splitWeight: m.splitWeight,
          notify: m.notify,
          joinedFrom: m.joinedFrom?.toISOString() ?? null,
          // Kept so that bringing someone back can't turn "added by someone
          // else, never opened the group" into "joined themselves" (passport privacy).
          addedBy: m.addedBy,
          seenAt: m.seenAt?.toISOString() ?? null,
          // Kept so the restored person can start one step ahead of it (old phone-only copies must not come back).
          grantEpoch: m.grantEpoch,
          // Kept so undo + redo can't turn a left or removed person into an active one (or drop the removal record).
          leftAt: m.leftAt?.toISOString() ?? null,
          removedAt: m.removedAt?.toISOString() ?? null,
          removedById: m.removedById,
        })),
      },
    });
  });
  } catch (err) {
    if (err instanceof MembersMoved) return { ok: false, error: "Someone changed these people a moment ago, so this wasn’t undone. Look again." };
    throw err;
  }
  return { ok: true, eventId };
}

class MembersMoved extends Error {}

async function restoreMembers(groupId: string, actorId: string, members: Extract<UndoPayload, { type: "members_restore" }>["members"], mark?: UndoMark): Promise<UndoResult> {
  if (await isPairGroup(groupId)) return { ok: false, error: PAIR_NO_PEOPLE };
  const existing = await db.member.findMany({ where: { groupId } });
  const clash = members.find((m) => existing.some((x) => x.name.toLowerCase() === m.name.toLowerCase()));
  if (clash) return { ok: false, error: `Someone called ${clash.name} is already in the group.` };
  const eventId = await db.$transaction(async (tx) => {
    await markUndone(tx, mark);
    for (const m of members) {
      // Back as they were: still linked to their sign-in (unless they've joined again since), same share.
      const accountId = m.accountId && !existing.some((x) => x.accountId === m.accountId) ? m.accountId : null;
      await tx.member.create({
        data: {
          id: m.id,
          name: m.name,
          phone: m.phone,
          groupId,
          createdAt: new Date(m.createdAt),
          accountId,
          claimedAt: accountId && m.claimedAt ? new Date(m.claimedAt) : null,
          // One past what it was: a copy of this name saved on a phone before the removal ("id" or "id~epoch") no longer matches.
          // (Payloads saved before the epoch was kept count as 0.)
          grantEpoch: (m.grantEpoch ?? 0) + 1,
          ...(m.splitWeight ? { splitWeight: m.splitWeight } : {}),
          ...(m.notify ? { notify: m.notify } : {}),
          ...(m.joinedFrom ? { joinedFrom: new Date(m.joinedFrom) } : {}),
          ...(m.leftAt ? { leftAt: new Date(m.leftAt) } : {}),
          ...(m.removedAt ? { removedAt: new Date(m.removedAt), removedById: m.removedById ?? "" } : {}),
          // Changes saved before addedBy was kept: someone with a sign-in is
          // treated as added by whoever brings them back, until they open the group.
          ...(accountId
            ? m.addedBy !== undefined
              ? { addedBy: m.addedBy, seenAt: m.seenAt ? new Date(m.seenAt) : null }
              : { addedBy: actorId }
            : {}),
        },
      });
    }
    return logEvent(tx, {
      groupId,
      actorId,
      kind: "members_added",
      text: `added ${members.map((m) => m.name).join(", ")} back`,
      undo: { type: "members_remove", memberIds: members.map((m) => m.id) },
    });
  });
  return { ok: true, eventId };
}
