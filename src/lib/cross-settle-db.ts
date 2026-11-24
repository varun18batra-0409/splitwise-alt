import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { hasLeft } from "./active";
import { claimKey, fingerprintOf, isDuplicateKey, keyState, retryOnceIfBusy } from "./once";
import { logEvent } from "./events";
import { formatMoney } from "./money";
import { createPayment, PaymentTooBig } from "./payments";
import { moveOutAgainIfSquare } from "./settling-db";
import { CLEARING_MARK } from "./left-view";
import { tellAcross, tellParties, type AcrossPart } from "./payment-claims";
import { paymentText } from "./pay-record";
import { GroupChanged, guardGroup, leaverBalanceBreaks, ledgerInTx } from "./money-guard";

// Smart Settle across groups: records each group's part of one combined settle-up.
//
// Every part is checked against that group's CURRENT plan inside the one transaction that writes it (after the group is
// guarded), so a payment, an edit, a refund or a close that landed since the page loaded can never be settled with a
// stale plan. Any mismatch rolls back every group: all or nothing.
//
// Every part counts straight away. When there is more than one part, each part's "recorded" line names all the parts (`across`), so deleting
// or restoring any one of them takes all of them off or puts them all back, in one step (payment-change.ts). A pair has one part and no link.
// Each person is told once, with what it comes to for them in total.

export type CrossPart = { groupId: string; fromId: string; toId: string; amount: number };
export type CrossOutcome = "done" | "changed" | "stale" | "error" | "toobig";

// Several parts in one currency whose signed amounts add to 0 (+ what the person is owed, - what they owe): the payments cancel out and no money moves.
export function isClearing(parts: CrossPart[], memberships: Record<string, string>): boolean {
  if (parts.length < 2) return false;
  return parts.reduce((t, p) => t + (p.toId === memberships[p.groupId] ? p.amount : -p.amount), 0) === 0;
}

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
  const info = new Map<string, { direct: boolean; name: string; currency: string; names: Map<string, string> }>();
  for (const p of parts) {
    const myId = memberships[String(p.groupId)];
    const g = myId
      ? await db.group.findUnique({ where: { id: String(p.groupId) }, select: { deletedAt: true, closed: true, currency: true, type: true, name: true, members: { select: { id: true, name: true } } } })
      : null;
    if (!g || !myId) return "error";
    if (g.deletedAt || g.closed || (await hasLeft(p.groupId, myId))) return "changed";
    if (!(p.fromId === myId || p.toId === myId)) return "changed";
    info.set(p.groupId, { direct: g.type === "direct", name: g.name, currency: g.currency, names: new Map(g.members.map((m) => [m.id, m.name])) });
  }

  // One payment across groups is always in ONE currency: a bundle that mixes currencies would record a swap at the app's rate (a request
  // built by hand; the Settle page makes one card per currency).
  if (parts.length > 1 && new Set([...info.values()].map((c) => c.currency)).size > 1) return "error";

  // One payment across groups is always with ONE other person: the same account in every part. (A request made by hand could pair
  // a debt to Asha in one group with a debt to Bob in another as one linked payment that neither of them could delete.) A part whose
  // other person has no account can't be shown to be the same person, so it is never netted with another group.
  if (parts.length > 1) {
    const others = parts.map((p) => (memberships[String(p.groupId)] === p.fromId ? p.toId : p.fromId));
    const rows = await db.member.findMany({ where: { id: { in: others } }, select: { id: true, groupId: true, accountId: true } });
    const accounts = parts.map((p, i) => rows.find((r) => r.id === others[i] && r.groupId === p.groupId)?.accountId ?? null);
    if (accounts.some((a) => !a) || new Set(accounts).size !== 1) return "error";
  }

  // A pair (expenses with one person) is settled on its own, never together with another group: with a pair among several parts
  // nothing is recorded anywhere.
  if (parts.length > 1 && [...info.values()].some((c) => c.direct)) return "error";

  await opts.afterRead?.();
  const sorted = [...parts].sort((a, b) => a.groupId.localeCompare(b.groupId)); // always the same order, so two settles can't wait on each other
  const bundle = sorted.length > 1 ? randomUUID() : "";
  const clearing = isClearing(sorted, memberships);
  const made: AcrossPart[] = [];
  try {
    await retryOnceIfBusy(() =>
      db.$transaction(
        async (tx: Prisma.TransactionClient) => {
          made.length = 0; // a retried transaction starts again
          for (const p of sorted) {
            const c = info.get(p.groupId)!;
            await guardGroup(tx, p.groupId, { currency: c.currency, actorId: memberships[p.groupId] });
            const { transfers } = await ledgerInTx(tx, p.groupId);
            if (!transfers.some((t) => t.from === p.fromId && t.to === p.toId && t.amount === p.amount)) throw new Stale();
            // Someone who has left may only end with the balance they had, or 0.
            const gone = await leaverBalanceBreaks(tx, p.groupId, [p.fromId, p.toId], (l) => ({ ...l, payments: [...l.payments, { id: "new-payment", fromId: p.fromId, toId: p.toId, amount: p.amount }] }));
            if (gone.length) throw new Stale();
          }
          await claimKey(tx, key, "settled", fp);
          // Every part's payment first, so each part's line can name all of them.
          for (const p of sorted) {
            const pay = await createPayment(tx, { groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount, createdById: memberships[p.groupId] });
            made.push({ groupId: p.groupId, groupName: info.get(p.groupId)!.name, currency: info.get(p.groupId)!.currency, paymentId: pay.id, fromId: p.fromId, toId: p.toId, amount: p.amount });
          }
          const across = bundle ? { id: bundle, parts: made.map((m) => ({ groupId: m.groupId, paymentId: m.paymentId })) } : undefined;
          for (const m of made) {
            const c = info.get(m.groupId)!;
            const myId = memberships[m.groupId];
            const otherId = m.fromId === myId ? m.toId : m.fromId;
            await logEvent(tx, {
              groupId: m.groupId,
              actorId: myId,
              undo: { type: "payment_delete", paymentId: m.paymentId, ...(across ? { across } : {}) },
              kind: "payment_recorded",
              ...(clearing ? { details: [CLEARING_MARK] } : {}),
              text: clearing
                ? `cleared ${formatMoney(m.amount, c.currency)} with ${c.names.get(otherId) ?? "Someone"} across groups (no money moved)`
                : `${paymentText(myId, m.fromId, m.toId, c.names.get(m.fromId) ?? "Someone", c.names.get(m.toId) ?? "Someone", formatMoney(m.amount, c.currency))}${c.direct ? "" : " (Smart Settle across groups)"}`,
              paymentId: m.paymentId,
            });
            // Someone settling up only in this group who is square now is moved out again, in this same step.
            await moveOutAgainIfSquare(tx, m.groupId, [m.fromId, m.toId]);
          }
        },
        { timeout: 15000 },
      ),
    );
  } catch (err) {
    if (err instanceof PaymentTooBig) return "toobig";
    if (err instanceof Stale || err instanceof GroupChanged) return "changed";
    if (isDuplicateKey(err)) return "done";
    throw err;
  }
  // Told after everything is saved: once for each person when it spans groups, otherwise the one other person.
  try {
    const actorMemberIds = sorted.map((p) => memberships[p.groupId]);
    if (made.length > 1) {
      const actorName = info.get(sorted[0].groupId)!.names.get(actorMemberIds[0]) ?? "Someone";
      tellAcross({ actorName, actorMemberIds, parts: made, money: formatMoney, bundleId: bundle });
    } else if (made.length === 1) {
      const m = made[0];
      const c = info.get(m.groupId)!;
      tellParties({ event: "recorded", actorId: actorMemberIds[0], actorName: c.names.get(actorMemberIds[0]) ?? "Someone", fromId: m.fromId, toId: m.toId, fromName: c.names.get(m.fromId) ?? "Someone", toName: c.names.get(m.toId) ?? "Someone", amountText: formatMoney(m.amount, c.currency), groupName: c.name, groupId: m.groupId, paymentId: m.paymentId, direct: c.direct });
    }
  } catch {
    /* a push that could not be sent is never an error for the person who recorded it */
  }
  return "done";
}
