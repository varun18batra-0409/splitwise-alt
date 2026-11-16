import { db } from "./db";
import { hasLeft, LEFT_ERROR, removedText, wasRemoved } from "./active";
import { logEvent, markUndone, parseUndo, type Db, type PaymentAcross, type UndoMark } from "./events";
import { formatMoney } from "./money";
import { withRetry } from "./once";
import { GroupChanged, groupChangedText, guardGroup, leaverBalanceBreaks, leaversOffZero } from "./money-guard";
import { RestoreRefused, restorePayments } from "./payments";
import { onlyReceiverCanBringBack, receiverOnlyText } from "./refused-payment";
import { tellBroughtBack, tellParties } from "./payment-claims";
import type { Prisma } from "@prisma/client";

// The ONE place a payment is taken off or put back by people (Batch C).
//
// The rules:
// 1. Only the payer and the person paid can delete or restore a payment. Nobody else, not even the admin. (The one exception is Undo for
//    someone who recorded it for others: Mark paid, Mark all paid, Settle everything. They can Undo it for 10 minutes, see undo.ts.)
// 2. Deleting is never refused because someone has left. A payer or person paid who has left (or was removed) is put back into the group,
//    in the same step, owing: someone who has left always shows 0, so the money can't vanish.
// 3. One payment across several groups (the all-groups Settle page) is deleted and restored only as a set, in one step, or not at all.
// 4. Bringing a deleted payment back is refused if the person paid took it off (MB-1) or if a newer payment for the same pair was recorded
//    since (restorePayments in payments.ts).

type Tx = Prisma.TransactionClient;

export type Result = { ok: true; id: string; eventId?: string } | { ok: false; error: string };

export type Across = PaymentAcross;

// Thrown inside a transaction (rolls it back): a person this touched is left (or was left) off zero.
export class NotSquare extends Error {
  constructor(public who: string) {
    super("not square");
  }
}
class ReceiverOnly extends Error {}
class LeaverBack extends Error {}
class Moved extends Error {}
class Removed extends Error {
  constructor(public groupName: string) {
    super(groupName);
  }
}
class NoLeavers extends Error {}

export const OPEN_LOOPIN_TEXT = "Open Loopin to change this.";

const NOT_SQUARE_TEXT = "Balances just changed. Look again, then try once more.";

// "Only Asha or Ravi can change this payment." Pure.
export function partyRefusal(p: { fromId: string; toId: string; fromName: string; toName: string }, actorId: string | undefined): string | null {
  if (actorId && (actorId === p.fromId || actorId === p.toId)) return null;
  return `Only ${p.fromName} or ${p.toName} can change this payment.`;
}

// May this person Undo something they recorded for others (Mark paid, Mark all paid, Settle everything)? 10 minutes, the same window as moving out.
export { putBackOpen as recorderWindowOpen } from "./put-back";

// Everyone in `people` who has left or was removed comes back into the group, each written only if still exactly as read (otherwise the
// transaction rolls back). A line "brought Asha back into Goa until the ₹400 is sorted" with an undo that puts them back as they were.
export type BroughtBack = { id: string; name: string; accountId: string | null };
export async function bringBackLeavers(tx: Tx, o: { groupId: string; groupName: string; amountText: string; actorId: string; people: string[] }): Promise<BroughtBack[]> {
  const rows = await tx.member.findMany({
    where: { groupId: o.groupId, id: { in: [...new Set(o.people)] } },
    select: { id: true, name: true, leftAt: true, removedAt: true, removedById: true, accountId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const back: BroughtBack[] = [];
  for (const m of rows) {
    if (!m.leftAt && !m.removedAt) continue;
    const wrote = await tx.member.updateMany({ where: { id: m.id, leftAt: m.leftAt, removedAt: m.removedAt }, data: { leftAt: null, removedAt: null, removedById: "" } });
    if (wrote.count !== 1) throw new NotSquare(m.name);
    // The undo of this line puts them back exactly as they were (the same shape as invitations.ts).
    const undoData: { leftAt?: string | null; removedAt?: string | null; removedById?: string } = m.removedAt
      ? { leftAt: (m.leftAt ?? m.removedAt).toISOString(), removedAt: m.removedAt.toISOString(), removedById: m.removedById }
      : { leftAt: m.leftAt!.toISOString() };
    await logEvent(tx, {
      groupId: o.groupId,
      actorId: o.actorId,
      kind: "member_rejoined",
      text: m.id === o.actorId ? `came back into ${o.groupName} until the ${o.amountText} is sorted` : `brought ${m.name} back into ${o.groupName} until the ${o.amountText} is sorted`,
      undo: { type: "member_set", memberId: m.id, data: undoData },
      touches: [m.id], // no paymentId: this line never stands in the way of undoing the delete
    });
    back.push({ id: m.id, name: m.name, accountId: m.accountId });
  }
  return back;
}

// If this payment was recorded as one of several across groups (the all-groups Settle page), the whole set; otherwise null.
// Reads the payment's first "recorded" line. Legacy cross-group payments (recorded before this) have none, so they stay single.
export async function acrossOf(client: Db, paymentId: string): Promise<Across | null> {
  const ev = await client.groupEvent.findFirst({ where: { paymentId, kind: "payment_recorded" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { undo: true } });
  const u = ev ? parseUndo(ev.undo) : null;
  if (!u || u.type !== "payment_delete" || !u.across) return null;
  if (u.across.parts.length < 2 || !u.across.parts.some((p) => p.paymentId === paymentId)) return null;
  return u.across;
}

// The ids of a group's flat move-out final payments (the only payments that still ask the person paid "Got it / Not received").
// Read from the move-out lines themselves, so no column or data change is needed: live move-outs never wrote anything else.
export async function moveOutPaymentIds(client: Db, groupIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!groupIds.length) return out;
  const rows = await client.groupEvent.findMany({ where: { groupId: { in: groupIds }, kind: "member_left", undo: { contains: '"moveOut"' } }, select: { undo: true }, take: 500 });
  for (const r of rows) {
    const u = parseUndo(r.undo);
    if (u?.type === "member_set" && u.moveOut?.money) for (const p of u.moveOut.money.payments) out.add(p.id);
  }
  return out;
}

export type ChangeOpts = {
  memberships?: Record<string, string>; // groupId -> my member id (for a payment across several groups)
  mark?: UndoMark; // when this is an Undo: the change being undone, marked in the same transaction
  undoing?: boolean;
  recorderOk?: boolean; // the caller checked: this person recorded it for others and is inside the 10-minute Undo window
  noLeavers?: boolean; // the sign-in-free pay link: refuse (inside the same transaction) if either person has left or been removed, so it never brings anyone back
  afterRead?: () => Promise<void>; // tests only: runs after the reads and before the write begins
};

// Delete (deleted = true) or bring back (deleted = false) one payment.
export function changePayment(paymentId: string, actorId: string | undefined, deleted: boolean, opts: ChangeOpts = {}): Promise<Result> {
  return withRetry(() => changePaymentOnce(paymentId, actorId, deleted, opts));
}

async function changePaymentOnce(paymentId: string, actorId: string | undefined, deleted: boolean, opts: ChangeOpts): Promise<Result> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { group: { select: { id: true, name: true, currency: true, closed: true, deletedAt: true, type: true } }, from: { select: { name: true } }, to: { select: { name: true } } },
  });
  if (!payment) return { ok: false, error: "That payment no longer exists." };
  const across = await acrossOf(db, paymentId);
  if (across) return changeAcross(across, payment.id, actorId, deleted, opts);
  if (!actorId || !(await db.member.findFirst({ where: { id: actorId, groupId: payment.groupId }, select: { id: true } }))) {
    return { ok: false, error: "Only people in this group can change its payments." };
  }
  if (payment.group.deletedAt) return { ok: false, error: "This group was deleted." };
  if (payment.group.closed) return { ok: false, error: "This group is closed. Reopen it to change payments." };
  // Someone an admin removed can't delete or restore payments themselves (the other person in the payment still can).
  if (!opts.noLeavers && (await wasRemoved(payment.groupId, actorId))) return { ok: false, error: removedText(payment.group.name) };
  // A payment the person paid took off can only be brought back by them: anyone else (even a non-party) is told that, in those words.
  if (!deleted && payment.deletedAt && onlyReceiverCanBringBack(payment, actorId)) return { ok: false, error: receiverOnlyText(payment.to.name) };
  if (!opts.recorderOk) {
    const no = partyRefusal({ fromId: payment.fromId, toId: payment.toId, fromName: payment.from.name, toName: payment.to.name }, actorId);
    if (no) return { ok: false, error: no };
  }
  // Deleting your own payment after you left is allowed (you come back owing it); bringing one back is not.
  if (!deleted && (await hasLeft(payment.groupId, actorId))) return { ok: false, error: LEFT_ERROR };
  if (Boolean(payment.deletedAt) === deleted) return { ok: true, id: payment.id };
  const amountText = formatMoney(payment.amount, payment.group.currency);
  await opts.afterRead?.();
  let out: { eventId: string; back: BroughtBack[] };
  try {
    out = await db.$transaction(async (tx) => {
      // First: the group is still open and in the same currency (and, for a restore, this person still in it).
      await guardGroup(tx, payment.groupId, { currency: payment.group.currency, ...(deleted ? {} : { actorId }) });
      await markUndone(tx, opts.mark);
      // Again inside the transaction (a removal could have landed since the first look).
      if (opts.noLeavers) {
        const gone = await tx.member.count({ where: { groupId: payment.groupId, id: { in: [payment.fromId, payment.toId] }, OR: [{ leftAt: { not: null } }, { removedAt: { not: null } }] } });
        if (gone) throw new NoLeavers();
      } else if (await tx.member.count({ where: { id: actorId!, groupId: payment.groupId, removedAt: { not: null } } })) throw new Removed(payment.group.name);
      if (!deleted) {
        // Again inside the transaction, from the row as it is now (the first look could be out of date).
        const nowRow = await tx.payment.findUnique({ where: { id: payment.id }, select: { deletedById: true, toId: true } });
        if (nowRow && onlyReceiverCanBringBack(nowRow, actorId)) throw new ReceiverOnly(payment.to.name);
        // Someone who has left may only end with the balance they had, or 0.
        const gone = await leaverBalanceBreaks(tx, payment.groupId, [payment.fromId, payment.toId], (l) => ({ ...l, payments: [...l.payments, { id: payment.id, fromId: payment.fromId, toId: payment.toId, amount: payment.amount }] }));
        if (gone.length) throw new LeaverBack(`${gone[0]} has left the group, so this can't be ${opts.undoing ? "undone" : "brought back"}.`);
      }
      let moved: boolean;
      if (deleted) moved = (await tx.payment.updateMany({ where: { id: payment.id, deletedAt: null }, data: { deletedAt: new Date(), deletedById: actorId } })).count === 1;
      else moved = (await restorePayments(tx, [payment.id], actorId!)).length === 1;
      if (!moved) return { eventId: "", back: [] };
      const eventId = await logEvent(tx, {
        groupId: payment.groupId,
        actorId: actorId!,
        kind: deleted ? "payment_deleted" : "payment_restored",
        text: `${deleted ? "deleted" : "restored"} the payment ${payment.from.name} → ${payment.to.name} (${amountText})`,
        paymentId: payment.id,
        // When the person paid takes it off, only they can bring it back (byReceiver; the server also reads the payment itself).
        undo: deleted ? { type: "payment_restore", paymentId: payment.id, ...(actorId === payment.toId ? { byReceiver: true } : {}) } : { type: "payment_delete", paymentId: payment.id },
      });
      // A payer or person paid who has left comes back, owing. (Hand-worked: Asha left at 0 after paying Ravi 40000; Ravi deletes it:
      // Asha is back at -40000 and Ravi +40000.)
      const back = deleted ? await bringBackLeavers(tx, { groupId: payment.groupId, groupName: payment.group.name, amountText, actorId: actorId!, people: [payment.fromId, payment.toId] }) : [];
      if (deleted) {
        const off = await leaversOffZero(tx, payment.groupId, [payment.fromId, payment.toId]);
        if (off.length) throw new NotSquare(off[0]);
      }
      return { eventId, back };
    });
  } catch (err) {
    const e = mapError(err);
    if (e) return { ok: false, error: e };
    throw err;
  }
  if (out.eventId) {
    const actor = await db.member.findUnique({ where: { id: actorId! }, select: { name: true } });
    tellParties({
      event: deleted ? "deleted" : "restored",
      actorId: actorId!,
      actorName: actor?.name ?? "Someone",
      fromId: payment.fromId,
      toId: payment.toId,
      fromName: payment.from.name,
      toName: payment.to.name,
      amountText,
      groupName: payment.group.name,
      groupId: payment.groupId,
      paymentId: payment.id,
      eventId: out.eventId,
      direct: payment.group.type === "direct",
    });
    for (const m of out.back) {
      if (m.accountId && m.id !== actorId) tellBroughtBack({ groupId: payment.groupId, groupName: payment.group.name, memberId: m.id, receiverName: actor?.name ?? "Someone", amountText, paymentId: payment.id, receiverId: actorId, how: "deleted" });
    }
  }
  return { ok: true, id: payment.id, eventId: out.eventId || undefined };
}

function mapError(err: unknown): string | null {
  if (err instanceof ReceiverOnly) return receiverOnlyText(err.message);
  if (err instanceof Removed) return removedText(err.message);
  if (err instanceof NoLeavers) return OPEN_LOOPIN_TEXT;
  if (err instanceof RestoreRefused) return err.message;
  if (err instanceof GroupChanged) return groupChangedText(err);
  if (err instanceof LeaverBack) return err.message;
  if (err instanceof NotSquare) return NOT_SQUARE_TEXT;
  if (err instanceof Moved) return "This payment changed a moment ago. Look again, then try once more.";
  return null;
}

// One payment across several groups: deleted or brought back as a set, in one step, or not at all.
async function changeAcross(across: Across, clickedId: string, actorId: string | undefined, deleted: boolean, opts: ChangeOpts): Promise<Result> {
  const rows = await db.payment.findMany({
    where: { id: { in: across.parts.map((p) => p.paymentId) } },
    include: { group: { select: { id: true, name: true, currency: true, closed: true, deletedAt: true, type: true } }, from: { select: { name: true } }, to: { select: { name: true } } },
  });
  // A part whose group was erased no longer exists: it is skipped (the rest is still taken off).
  const clicked = rows.find((r) => r.id === clickedId);
  if (!clicked) return { ok: false, error: "That payment no longer exists." };
  if (!actorId) return { ok: false, error: "Only people in this group can change its payments." };
  const names = rows.map((r) => r.group.name);
  const where = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(" and ");
  // Who is this person in each group: the one this phone is (memberships), otherwise the member with the same account.
  const me = await db.member.findUnique({ where: { id: actorId }, select: { accountId: true } });
  const actorIn = new Map<string, string>();
  for (const r of rows) {
    let id = opts.memberships?.[r.groupId];
    if (!id && r.groupId === clicked.groupId) id = actorId;
    if (!id && me?.accountId) id = (await db.member.findFirst({ where: { groupId: r.groupId, accountId: me.accountId }, select: { id: true } }))?.id;
    if (id) actorIn.set(r.groupId, id);
  }
  actorIn.set(clicked.groupId, actorId); // in the group they are acting from, they are the one acting
  // Someone an admin removed can't delete or restore payments themselves (the other person in each payment still can).
  for (const r of rows) {
    const mine = actorIn.get(r.groupId);
    if (mine && (await wasRemoved(r.groupId, mine))) return { ok: false, error: removedText(r.group.name) };
  }
  // Said to anyone who asks, so it never names a group they may not be in.
  if (!rows.every((r) => actorIn.get(r.groupId) === r.fromId || actorIn.get(r.groupId) === r.toId)) {
    return { ok: false, error: `This was one payment across groups. Only ${clicked.from.name} or ${clicked.to.name} can change it.` };
  }
  for (const r of rows) {
    if (r.group.deletedAt) return { ok: false, error: `Restore ${r.group.name} first.` };
    if (r.group.closed) return { ok: false, error: `${r.group.name} is closed. Reopen it, then try again.` };
  }
  if (rows.every((r) => Boolean(r.deletedAt) === deleted)) return { ok: true, id: clicked.id };
  if (!rows.every((r) => Boolean(r.deletedAt) !== deleted)) return { ok: false, error: `This payment was changed in one of ${where} since. Look again, then try once more.` };
  if (!deleted) {
    // Bringing it back needs the person to be in each group (not left), and the person paid's say where they took it off.
    for (const r of rows) {
      const mine = actorIn.get(r.groupId)!;
      if (await hasLeft(r.groupId, mine)) return { ok: false, error: LEFT_ERROR };
      if (onlyReceiverCanBringBack(r, mine)) return { ok: false, error: receiverOnlyText(r.to.name) };
    }
  }
  await opts.afterRead?.();
  const sorted = [...rows].sort((a, b) => a.groupId.localeCompare(b.groupId)); // always the same order, so two changes can't wait on each other
  const moneyOf = (r: (typeof rows)[number]) => formatMoney(r.amount, r.group.currency);
  let events: { groupId: string; paymentId: string; eventId: string; back: BroughtBack[] }[];
  try {
    events = await db.$transaction(
      async (tx) => {
        for (const r of sorted) await guardGroup(tx, r.groupId, { currency: r.group.currency, ...(deleted ? {} : { actorId: actorIn.get(r.groupId) }) });
        await markUndone(tx, opts.mark);
        for (const r of sorted) {
          if (await tx.member.count({ where: { id: actorIn.get(r.groupId) ?? "", groupId: r.groupId, removedAt: { not: null } } })) throw new Removed(r.group.name);
        }
        // The lines of the same change in the other groups are marked undone with it, so no group shows a stale Undo.
        if (opts.mark) {
          await tx.groupEvent.updateMany({
            where: { paymentId: { in: rows.map((r) => r.id) }, kind: { in: deleted ? ["payment_recorded", "payment_restored"] : ["payment_deleted"] }, undoneAt: null },
            data: { undoneAt: new Date(), undoneById: actorId },
          });
        }
        const done: typeof events = [];
        for (const r of sorted) {
          const mine = actorIn.get(r.groupId)!;
          if (deleted) {
            const gone = (await tx.payment.updateMany({ where: { id: r.id, deletedAt: null }, data: { deletedAt: new Date(), deletedById: mine } })).count === 1;
            if (!gone) throw new Moved();
          } else {
            const nowRow = await tx.payment.findUnique({ where: { id: r.id }, select: { deletedById: true, toId: true } });
            if (nowRow && onlyReceiverCanBringBack(nowRow, mine)) throw new ReceiverOnly(r.to.name);
            const bad = await leaverBalanceBreaks(tx, r.groupId, [r.fromId, r.toId], (l) => ({ ...l, payments: [...l.payments, { id: r.id, fromId: r.fromId, toId: r.toId, amount: r.amount }] }));
            if (bad.length) throw new LeaverBack(`${bad[0]} has left the group, so this can't be ${opts.undoing ? "undone" : "brought back"}.`);
            if ((await restorePayments(tx, [r.id], mine, r.groupId)).length !== 1) throw new Moved();
          }
          const eventId = await logEvent(tx, {
            groupId: r.groupId,
            actorId: mine,
            kind: deleted ? "payment_deleted" : "payment_restored",
            text: `${deleted ? "deleted" : "restored"} the payment ${r.from.name} → ${r.to.name} (${moneyOf(r)}) (part of one payment across groups)`,
            paymentId: r.id,
            undo: deleted ? { type: "payment_restore", paymentId: r.id, across, ...(mine === r.toId ? { byReceiver: true } : {}) } : { type: "payment_delete", paymentId: r.id, across },
          });
          const back = deleted ? await bringBackLeavers(tx, { groupId: r.groupId, groupName: r.group.name, amountText: moneyOf(r), actorId: mine, people: [r.fromId, r.toId] }) : [];
          if (deleted) {
            const off = await leaversOffZero(tx, r.groupId, [r.fromId, r.toId]);
            if (off.length) throw new NotSquare(off[0]);
          }
          done.push({ groupId: r.groupId, paymentId: r.id, eventId, back });
        }
        return done;
      },
      { timeout: 15000 },
    );
  } catch (err) {
    const e = mapError(err);
    if (e) return { ok: false, error: e };
    throw err;
  }
  for (const r of rows) {
    const ev = events.find((x) => x.paymentId === r.id);
    const mine = actorIn.get(r.groupId)!;
    const actor = await db.member.findUnique({ where: { id: mine }, select: { name: true } });
    tellParties({
      event: deleted ? "deleted" : "restored",
      actorId: mine,
      actorName: actor?.name ?? "Someone",
      fromId: r.fromId,
      toId: r.toId,
      fromName: r.from.name,
      toName: r.to.name,
      amountText: moneyOf(r),
      groupName: r.group.name,
      groupId: r.groupId,
      paymentId: r.id,
      eventId: ev?.eventId,
      direct: r.group.type === "direct",
    });
    for (const m of ev?.back ?? []) {
      if (m.accountId && m.id !== mine) tellBroughtBack({ groupId: r.groupId, groupName: r.group.name, memberId: m.id, receiverName: actor?.name ?? "Someone", amountText: moneyOf(r), paymentId: r.id, receiverId: mine, how: "deleted" });
    }
  }
  return { ok: true, id: clicked.id, eventId: events.find((x) => x.paymentId === clicked.id)?.eventId };
}

// Undo / redo of "Mark all paid" or "Settle everything": the actor must be a party to EVERY payment (or the recorder inside the window).
// `restoring`: this is a Redo. A payment the person paid took off can only be brought back by them, whoever else asks (the recorder too).
export async function paymentsPartyRefusal(client: Db, groupId: string, ids: string[], actorId: string, recorderOk = false, restoring = false): Promise<string | null> {
  if (restoring) {
    const taken = await client.payment.findMany({ where: { id: { in: ids }, groupId, deletedAt: { not: null } }, select: { toId: true, deletedById: true, to: { select: { name: true } } } });
    const first = taken.find((p) => onlyReceiverCanBringBack(p, actorId));
    if (first) return receiverOnlyText(first.to.name);
  }
  if (recorderOk) return null;
  const rows = await client.payment.findMany({ where: { id: { in: ids }, groupId }, select: { fromId: true, toId: true } });
  return rows.every((p) => p.fromId === actorId || p.toId === actorId) ? null : "Only the people in each payment can take these off.";
}

// Payments taken off in one step (Undo of "Mark all paid" or "Settle everything"): everyone among their payers and people paid who has
// left or was removed comes back into the group, owing, and must end up where the ledger says. Call inside the transaction, after the update.
export async function bringBackAfterDelete(tx: Tx, o: { groupId: string; groupName: string; currency: string; paymentIds: string[]; actorId: string }): Promise<BroughtBack[]> {
  const rows = await tx.payment.findMany({ where: { id: { in: o.paymentIds }, groupId: o.groupId }, select: { fromId: true, toId: true, amount: true } });
  const people = [...new Set(rows.flatMap((p) => [p.fromId, p.toId]))];
  const total = rows.reduce((s, p) => s + p.amount, 0);
  const back = await bringBackLeavers(tx, { groupId: o.groupId, groupName: o.groupName, amountText: formatMoney(total, o.currency), actorId: o.actorId, people });
  const off = await leaversOffZero(tx, o.groupId, people);
  if (off.length) throw new NotSquare(off[0]);
  return back;
}

// The question asked before deleting a payment in Activity. Pure.
// `leftNames`: the payer or person paid who has left. `leftPaidNames`: of those, the ones who were PAID (they come back owed it, not owing it).
// Only the payer and the person paid ever read this, and they are in all the groups it names.
export function deleteQuestion(i: { groupName: string; acrossGroups?: string[]; leftNames?: string[]; leftPaidNames?: string[] }): string {
  let q = "Delete this payment? Balances will go back to before it was recorded.";
  const g = i.acrossGroups ?? [];
  if (g.length > 1) {
    const where = g.length > 2 ? `${g.slice(0, -1).join(", ")} and ${g[g.length - 1]}` : g.join(" and ");
    q += ` This was one payment across ${where}. Deleting it takes it off in ${g.length > 2 ? "all of them" : "both"}.`;
  }
  const left = i.leftNames ?? [];
  const paid = new Set(i.leftPaidNames ?? []);
  const it = (n: string) => (paid.has(n) ? "owed it" : "owing it");
  if (left.length === 1) q += ` ${left[0]} has left, so ${left[0]} comes back into ${i.groupName}, ${it(left[0])}.`;
  else if (left.length > 1) {
    // Both the payer and the person paid left: one owes it and the other is owed it.
    const allSame = left.every((n) => paid.has(n) === paid.has(left[0]));
    q += ` ${left.slice(0, -1).join(", ")} and ${left[left.length - 1]} have left, so they come back into ${i.groupName}${allSame ? `, ${it(left[0])}` : `: ${left.map((n) => `${n} ${paid.has(n) ? "owed" : "owing"}`).join(" and ")}`}.`;
  }
  return q;
}
