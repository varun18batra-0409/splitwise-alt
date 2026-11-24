import type { Db } from "./events";
import { memberMark } from "./left-view";
import { logEvent } from "./events";
import { ledgerInTx } from "./money-guard";
import { SETTLING_SELF, settlingFrom, squareAgainText, withSettlingLeft, type HistoryLine, type Settling } from "./settling";
import type { Prisma } from "@prisma/client";

// "Settling up only", database side (see settling.ts for the rule). Nothing is stored for it: it is read from the group's history.

// Who in this group is settling up only, and their original last day. Works on a client or inside a transaction (pass the tx to read
// it as it is at that moment). The cheap case is first: a group with no bring-back line at all reads one row set and stops.
export async function settlingIn(client: Db, groupId: string): Promise<Map<string, Settling>> {
  const candidates = await client.groupEvent.findMany({
    where: { groupId, kind: "member_rejoined", undoneAt: null, OR: [{ undo: { contains: '"settling":true' } }, { text: { contains: "is sorted" } }] },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 1,
  });
  if (!candidates.length) return new Map();
  const [lines, here] = await Promise.all([
    client.groupEvent.findMany({
      where: { groupId, kind: { in: ["member_left", "member_rejoined"] }, undoneAt: null, createdAt: { gte: candidates[0].createdAt } },
      select: { id: true, kind: true, text: true, undo: true, details: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    client.member.findMany({ where: { groupId, leftAt: null, removedAt: null }, select: { id: true } }),
  ]);
  return settlingFrom(lines as HistoryLine[], here.map((m) => m.id));
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
// payment that made them square (call it after the payment is written, inside the transaction). Idempotent: a person already moved out
// again is no longer settling, so a second call (a retry) writes nothing. Returns who was moved out again.
// Hand-worked: C owes 620,000, settles by paying it: C is 0, so C's row gets the old last day (10 Nov) back.
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
    out.push({ id, name: m?.name ?? "Someone" });
  }
  return out;
}
