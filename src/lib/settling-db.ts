import type { Db } from "./events";
import { memberMark } from "./left-view";
import { logEvent } from "./events";
import { ledgerInTx } from "./money-guard";
import { SETTLING_SELF, settlingFrom, squareAgainText, withSettlingLeft, type HistoryLine, type Settling } from "./settling";
import { formatMoney } from "./money";
import { dayKey, DEFAULT_TIME_ZONE } from "./dates";
import { queueAfterEvent, runQueued } from "./settling-queue";
import { parsePrepaid } from "./home/moving";
import type { Prisma } from "@prisma/client";

// "Settling up only", database side (see settling.ts for the rule). Nothing is stored for it: it is read from the group's history.

// Who in this group is settling up only, and their original last day. Works on a client or inside a transaction (pass the tx to read
// it as it is at that moment). The cheap case is first: a group with no bring-back line at all reads one row set and stops.
export async function settlingIn(client: Db, groupId: string): Promise<Map<string, Settling>> {
  const candidates = await client.groupEvent.findMany({
    where: { groupId, kind: "member_rejoined", undoneAt: null, OR: [{ undo: { contains: '"settling":true' } }, { text: { contains: "is sorted" } }] },
    select: { id: true },
    take: 1,
  });
  if (!candidates.length) return new Map();
  // Only a flat (home group) has "settling up only". A trip or other group's bring-back is just a member coming back.
  const group = await client.group.findUnique({ where: { id: groupId }, select: { type: true } });
  if (group?.type !== "home") return new Map();
  // Every going-out / coming-back line (not just the later ones): what stood right BEFORE a bring-back has to be a move-out.
  const [lines, here] = await Promise.all([
    client.groupEvent.findMany({
      where: { groupId, kind: { in: ["member_left", "member_rejoined"] }, undoneAt: null },
      select: { id: true, kind: true, text: true, undo: true, details: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.member.findMany({ where: { groupId, leftAt: null, removedAt: null }, select: { id: true } }),
  ]);
  const found = settlingFrom(lines as HistoryLine[], here.map((m) => m.id));
  // A bring-back known only by its old wording could be months old, with the person long since living there as a full member again.
  // If they have been in any expense that is dated after their move-out month since they were brought back, they are not settling.
  // (A settling person can only be named in their own move-out month's bills, so anything later means they were a full member.)
  for (const [who, s] of [...found]) {
    if (s.flagged !== false || !s.since) continue;
    // The first day of the month after their move-out month, by the group's (India) day.
    const [y, m] = dayKey(s.leftAt, DEFAULT_TIME_ZONE).split("-").map(Number);
    const afterMonth = new Date(Date.UTC(y, m, 1));
    const lived = await client.expenseShare.findFirst({
      where: {
        memberId: who,
        expense: { groupId, deletedAt: null, createdAt: { gt: s.since }, OR: [{ spentAt: { gte: afterMonth } }, { spentAt: null, createdAt: { gte: afterMonth } }] },
      },
      select: { id: true },
    });
    if (lived) found.delete(who);
  }
  return found;
}

// A read together with how many going-out / coming-back lines the group had when it was made, so a write that checks again inside its
// transaction can reuse it when that number has not moved (one cheap count instead of reading the whole history a second time). No clocks are
// compared: lines are only ever added (an Undo writes a line of its own), so the same count means the same history.
export type SettlingRead = { map: Map<string, Settling>; lines: number };
const linesIn = (client: Db, groupId: string) => client.groupEvent.count({ where: { groupId, kind: { in: ["member_left", "member_rejoined"] } } });
export async function settlingRead(client: Db, groupId: string): Promise<SettlingRead> {
  const lines = await linesIn(client, groupId); // counted BEFORE the read: a line written meanwhile makes the later count bigger (safe: it only costs a re-read)
  return { map: await settlingIn(client, groupId), lines };
}
export async function settlingFresh(tx: Db, groupId: string, prev: SettlingRead): Promise<Map<string, Settling>> {
  if (!prev.map.size) return settlingIn(tx, groupId); // nobody settling: the first step of settlingIn is already one cheap query
  return (await linesIn(tx, groupId)) === prev.lines ? prev.map : settlingIn(tx, groupId);
}

// Several groups at once (the Home counts): the same, one group id to its map.
export async function settlingInGroups(client: Db, groupIds: string[]): Promise<Map<string, Map<string, Settling>>> {
  const out = new Map<string, Map<string, Settling>>();
  if (!groupIds.length) return out;
  const hits = await client.groupEvent.findMany({
    where: { groupId: { in: groupIds }, kind: "member_rejoined", undoneAt: null, OR: [{ undo: { contains: '"settling":true' } }, { text: { contains: "is sorted" } }] },
    select: { groupId: true },
    distinct: ["groupId"],
  });
  for (const g of hits) out.set(g.groupId, await settlingIn(client, g.groupId));
  return out;
}

// "You moved out, so you can only settle up here." when this person is settling up only (they can't add or change expenses, bills or budgets); else null.
export async function settlingSelfRefusal(client: Db, groupId: string, actorId: string): Promise<string | null> {
  return (await settlingIn(client, groupId)).has(actorId) ? SETTLING_SELF : null;
}

// Members as bills and expenses should see them: people settling up only count as moved out from their original last day.
export async function membersForBills<M extends { id: string; leftAt: Date | null }>(client: Db, groupId: string, members: M[], o: { dailyMonth?: string } = {}): Promise<M[]> {
  return withSettlingLeft(members, await settlingIn(client, groupId), o);
}

// Someone settling up only whose balance is now exactly 0 is moved out again, with their original last day, in the SAME transaction as the
// payment that made them square. createPayment and restorePayments (payments.ts) call this, so every way a payment is recorded or put back
// (Mark paid, Record a payment, Settle everything, Redo, Undo of "Not received", restore, cross-group, pay link) goes through it and none can miss it.
// Idempotent: a person already moved out again is no longer settling, so a second call (a retry) writes nothing. Returns who was moved out again.
// Hand-worked: C owes 620,000, settles by paying it: C is 0, so C's row gets the old last day (10 Nov) back.
//
// A normal move-out stops for an open card game with their money in it. The automatic one does the same, in its own way: it does NOT move
// them out (they simply stay settling at 0, and are moved out again by the next payment or once the game is closed). Waiting "I've paid" notes
// never stop a move-out, they are closed with a line (as moveOut does), so the same is done here.
export async function moveOutAgainIfSquare(tx: Prisma.TransactionClient, groupId: string, ids: string[], known?: ReadonlyMap<string, Settling>): Promise<{ id: string; name: string }[]> {
  if (!ids.length) return [];
  const settling = known ?? (await settlingIn(tx, groupId));
  const mine = [...new Set(ids)].filter((id) => settling.has(id));
  if (!mine.length) return [];
  const { net } = await ledgerInTx(tx, groupId);
  const out: { id: string; name: string }[] = [];
  for (const id of mine) {
    if ((net[id] ?? 0) !== 0) continue;
    const was = settling.get(id)!;
    const m = await tx.member.findUnique({ where: { id }, select: { name: true } });
    // Money in a card game that is still open: stays settling at 0 (see above). Read here rather than through pot-db to keep this file light.
    const game = await tx.potGame.findFirst({ where: { groupId, status: "open", deletedAt: null, moves: { some: { memberId: id, deletedAt: null } } }, select: { id: true } });
    if (game) continue;
    // A move-out charge of theirs on a daily bill (milk) was deleted and that month is not added yet: the month-end bill still charges them
    // those days, so they are NOT moved out yet (a left person can't be charged). They stay settling until that is paid, then the next payment moves them out.
    if (await hasDeletedChargePending(tx, groupId, id)) continue;
    // Only if they are still exactly as read (in the group, not moved out): otherwise someone else got there first.
    const wrote = await tx.member.updateMany({
      where: { id, groupId, leftAt: null, removedAt: null },
      data: { leftAt: was.leftAt, removedAt: was.removedAt, removedById: was.removedById },
    });
    if (wrote.count !== 1) continue;
    // The row is changed now; the history line is written right after the caller's own line (settling-queue.ts), so the history reads
    // "paid ... / C is square again" and not the other way round.
    const line = squareAgainText(m?.name ?? "Someone", was);
    queueAfterEvent(tx, () =>
      logEvent(tx, {
        groupId,
        actorId: id,
        kind: "member_left",
        text: line,
        details: [memberMark(id)], // says which person this line is about (it has no undo; deleting their payment brings them back as before)
        touches: [id],
      }).then(() => closeNotes(tx, groupId, id, m?.name)),
    );
    out.push({ id, name: m?.name ?? "Someone" });
  }
  return out;
}

// Thrown from inside a write when the person doing it is settling up only (see requireNotSettling).
export class SettlingStopped extends Error {
  constructor() {
    super(SETTLING_SELF);
  }
}

// For the money screens a settling person can't use (currency, card markup, goals, deposits, card games): call it first thing inside the
// write (after guardGroup), so a bring-back that landed since the first look is caught too. The caller turns SettlingStopped into the answer.
export async function requireNotSettling(tx: Db, groupId: string, actorId: string): Promise<void> {
  if ((await settlingIn(tx, groupId)).has(actorId)) throw new SettlingStopped();
}

// Does a daily bill still have days to charge this person at month end because their move-out charge was deleted (and that month is not added)?
async function hasDeletedChargePending(tx: Prisma.TransactionClient, groupId: string, id: string): Promise<boolean> {
  const bills = await tx.bill.findMany({ where: { groupId, nature: "daily", deletedAt: null }, select: { id: true, prepaid: true } });
  for (const bill of bills) {
    if (!bill.prepaid || bill.prepaid === "{}") continue;
    for (const [period, list] of Object.entries(parsePrepaid(bill.prepaid))) {
      const mine = list.filter((x) => x.m === id);
      if (!mine.length) continue;
      const alive = await tx.expense.count({ where: { id: { in: mine.map((x) => x.e) }, deletedAt: null } });
      if (alive) continue; // a live charge still stands: the days are paid
      const run = await tx.billRun.findUnique({ where: { billId_period: { billId: bill.id, period } }, select: { status: true } });
      if (!run || run.status === "waiting") return true;
    }
  }
  return false;
}

// Older "I've paid" notes still waiting for this person are closed the way a move-out closes them (with a line each).
async function closeNotes(tx: Prisma.TransactionClient, groupId: string, id: string, name: string | undefined): Promise<void> {
  const notes = await tx.paymentClaim.findMany({ where: { groupId, status: "waiting", OR: [{ fromId: id }, { toId: id }] }, select: { id: true, fromId: true, amount: true, currency: true } });
  for (const n of notes) {
    const closed = await tx.paymentClaim.updateMany({ where: { id: n.id, status: "waiting" }, data: { status: "expired", slot: n.id, decidedAt: new Date(), decidedById: id } });
    if (closed.count !== 1) continue;
    const who = n.fromId === id ? name : (await tx.member.findUnique({ where: { id: n.fromId }, select: { name: true } }))?.name;
    await logEvent(tx, { groupId, actorId: id, kind: "payment_note_closed", text: `${who ?? "Someone"}’s older “I’ve paid ${formatMoney(n.amount, n.currency)}” was closed by the move-out. Record it again if it was paid.`, touches: [] });
  }
}

// For steps that change what people owe without a payment (an expense deleted, restored or edited; a card game finished or deleted): anyone
// settling up only who is now exactly 0 is moved out again, in the same transaction. `known` = the settling people as already read in it.
export async function squareSettlers(tx: Prisma.TransactionClient, groupId: string, known?: ReadonlyMap<string, Settling>): Promise<void> {
  const settling = known ?? (await settlingIn(tx, groupId));
  if (!settling.size) return;
  await moveOutAgainIfSquare(tx, groupId, [...settling.keys()], settling);
}

// A step that writes no line of its own (the manual "move out" of someone already square) writes the queued line itself.
export const writeQueuedLines = runQueued;
