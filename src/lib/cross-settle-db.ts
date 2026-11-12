import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { hasLeft } from "./active";
import { claimKey, fingerprintOf, isDuplicateKey, keyState, retryOnceIfBusy } from "./once";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { createPayment } from "./payments";
import { needsOkFor } from "./payment-ok";
import { paymentText } from "./pay-record";
import { GroupChanged, guardGroup, ledgerInTx } from "./money-guard";

// Smart Settle across groups: records each group's part of one combined settle-up.
//
// Every part is checked against that group's CURRENT plan inside the one transaction that writes it (after the group is
// guarded), so a payment, an edit, a refund or a close that landed since the page loaded can never be settled with a
// stale plan. Any mismatch rolls back every group: all or nothing.

export type CrossPart = { groupId: string; fromId: string; toId: string; amount: number };
export type CrossOutcome = "done" | "changed" | "stale" | "error";

class Stale extends Error {}

export async function settleAcrossCore(
  partsIn: CrossPart[],
  memberships: Record<string, string>,
  key: string | undefined,
  opts: { afterRead?: () => Promise<void> } = {},
): Promise<CrossOutcome> {
  // The same part twice would record the same payment twice.
  const seen = new Set<string>();
  const parts = partsIn.filter((p) => {
    const k = `${p?.groupId}|${p?.fromId}|${p?.toId}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const fp = fingerprintOf("settle-across", ...parts.map((p) => `${p?.groupId}|${p?.fromId}|${p?.toId}|${p?.amount}`).sort());
  const ks = await keyState(key, fp);
  if (ks.state === "stale") return "stale";
  if (ks.state === "done") return "done";

  // What is needed to word the payments (read now; whether they are still right is decided inside the write).
  const info = new Map<string, { currency: string; names: Map<string, string>; receivers: Map<string, { id: string; accountId: string | null; claimedAt: Date | null }> }>();
  for (const p of parts) {
    const myId = memberships[String(p.groupId)];
    const g = myId
      ? await db.group.findUnique({ where: { id: String(p.groupId) }, select: { deletedAt: true, closed: true, currency: true, members: { select: { id: true, name: true, accountId: true, claimedAt: true } } } })
      : null;
    if (!g || !myId) return "error";
    if (g.deletedAt || g.closed || (await hasLeft(p.groupId, myId))) return "changed";
    if (!(p.fromId === myId || p.toId === myId)) return "changed";
    info.set(p.groupId, { currency: g.currency, names: new Map(g.members.map((m) => [m.id, m.name])), receivers: new Map(g.members.map((m) => [m.id, m])) });
  }

  await opts.afterRead?.();
  const sorted = [...parts].sort((a, b) => a.groupId.localeCompare(b.groupId)); // always the same order, so two settles can't wait on each other
  try {
    await retryOnceIfBusy(() =>
      db.$transaction(
        async (tx: Prisma.TransactionClient) => {
          for (const p of sorted) {
            const c = info.get(p.groupId)!;
            await guardGroup(tx, p.groupId, { currency: c.currency, actorId: memberships[p.groupId] });
            const { transfers } = await ledgerInTx(tx, p.groupId);
            if (!transfers.some((t) => t.from === p.fromId && t.to === p.toId && t.amount === p.amount)) throw new Stale();
          }
          await claimKey(tx, key, "settled", fp);
          for (const p of sorted) {
            const c = info.get(p.groupId)!;
            const myId = memberships[p.groupId];
            const pay = await createPayment(tx, { groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount, createdById: myId, needsOk: needsOkFor(c.receivers.get(p.toId), myId) });
            await logEvent(tx, {
              groupId: p.groupId,
              actorId: myId,
              undo: { type: "payment_delete", paymentId: pay.id },
              kind: "payment_recorded",
              text: `${paymentText(myId, p.fromId, p.toId, c.names.get(p.fromId) ?? "Someone", c.names.get(p.toId) ?? "Someone", formatMoney(p.amount, c.currency))} (Smart Settle across groups)`,
              paymentId: pay.id,
            });
          }
        },
        { timeout: 15000 },
      ),
    );
  } catch (err) {
    if (err instanceof Stale || err instanceof GroupChanged) return "changed";
    if (isDuplicateKey(err)) return "done";
    throw err;
  }
  return "done";
}
