import type { Db } from "./events";
import { memberMark } from "./left-view";
import { logEvent } from "./events";
import { ledgerInTx } from "./money-guard";
import { SETTLING_SELF, settlingFrom, squareAgainText, withSettlingLeft, type HistoryLine, type Settling } from "./settling";
import { formatMoney } from "./money";
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
    const afterMonth = new Date(Date.UTC(s.leftAt.getUTCFullYear(), s.leftAt.getUTCMonth() + 1, 1));
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
export async function moveOutAgainIfSquare(tx: Prisma.TransactionClient, groupId: string, ids: string[]): Promise<{ id: string; name: string }[]> {
  if (!ids.length) return [];
  const settling = await settlingIn(tx, groupId);
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
    // Only if they are still exactly as read (in the group, not moved out): otherwise someone else got there first.
    const wrote = await tx.member.updateMany({
      where: { id, groupId, leftAt: null, removedAt: null },
      data: { leftAt: was.leftAt, removedAt: was.removedAt, removedById: was.removedById },
    });
    if (wrote.count !== 1) continue;
    await logEvent(tx, {
      groupId,
      actorId: id,
      kind: "member_left",
      text: squareAgainText(m?.name ?? "Someone", was),
      details: [memberMark(id)], // says which person this line is about (it has no undo; deleting their payment brings them back as before)
      touches: [id],
    });
    // Older "I've paid" notes still waiting for this person are closed the way a move-out closes them.
    const notes = await tx.paymentClaim.findMany({ where: { groupId, status: "waiting", OR: [{ fromId: id }, { toId: id }] }, select: { id: true, fromId: true, amount: true, currency: true } });
    for (const n of notes) {
      const closed = await tx.paymentClaim.updateMany({ where: { id: n.id, status: "waiting" }, data: { status: "expired", slot: n.id, decidedAt: new Date(), decidedById: id } });
      if (closed.count !== 1) continue;
      const who = n.fromId === id ? m?.name : (await tx.member.findUnique({ where: { id: n.fromId }, select: { name: true } }))?.name;
      await logEvent(tx, { groupId, actorId: id, kind: "payment_note_closed", text: `${who ?? "Someone"}’s older “I’ve paid ${formatMoney(n.amount, n.currency)}” was closed by the move-out. Record it again if it was paid.`, touches: [] });
    }
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
