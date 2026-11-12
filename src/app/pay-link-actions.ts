"use server";

import { headers } from "next/headers";
import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { makeClaim, tellReceiver, withdrawClaim } from "@/lib/payment-claims";
import { allow, clientIp } from "@/lib/rate-limit";
import { readPayLink, recordLinkPayment } from "@/lib/pay-link";
import { GroupChanged, groupChangedText, guardGroup, LeaverBreak, removedPaymentsBreak } from "@/lib/money-guard";

// The "I've paid" link (no sign-in): say you paid what you owe (a claim that counts
// only once the other person taps "Confirm received"), or take it back while it's waiting.
// Older payments made through the link before claims existed keep their old behaviour.

const tokenOf = (f: FormData) => {
  const t = String(f.get("token") ?? "");
  return /^[A-Za-z0-9_-]{20,40}$/.test(t) ? t : "";
};
const back = (token: string, q: Record<string, string>) => redirect(`/p/${token}?${new URLSearchParams(q)}`);

async function slowDown(token: string) {
  const ip = clientIp(await headers());
  return (await allow(`paylink-ip:${ip}`, 30, 3600)) && (await allow(`paylink:${token}`, 12, 3600));
}

export async function iPaidAction(f: FormData) {
  const token = tokenOf(f);
  if (!token) redirect("/");
  if (!(await slowDown(token))) back(token, { error: "Too many taps. Try again in a little while." });
  const read = await readPayLink(token);
  if (read.kind !== "owes") redirect(`/p/${token}`); // gone, already said, all square, or closed: the page explains
  const s = read;
  // "I've paid" is a claim, not a payment: nothing changes in the balances until the person paid taps "Confirm received".
  const r = await makeClaim({ groupId: s.group.id, fromId: s.link.fromId, toId: s.link.toId, actorId: s.link.fromId, source: "link", expectAmount: s.amount });
  // The person owed can't tap "Confirm received" yet (just a name, no account): nobody to ask, so it is recorded
  // as a payment straight away, as before claims existed. No dead end.
  if (!r.ok && r.direct) {
    const done = await recordLinkPayment({ link: s.link, amount: s.amount, currency: s.group.currency, toName: s.toName });
    if (!done) back(token, { error: "That didn’t go through. Open the link again to see where things stand." });
    back(token, { paid: "1" });
  }
  if (!r.ok) back(token, { error: r.error });
  else if (!r.already) tellReceiver({ claimId: r.claimId, groupId: s.group.id, groupName: s.group.name, toId: s.link.toId, fromName: s.fromName, amountText: formatMoney(s.amount, s.group.currency), fromId: s.link.fromId });
  back(token, { paid: "1" });
}

export async function undoIPaidAction(f: FormData) {
  const token = tokenOf(f);
  if (!token) redirect("/");
  if (!(await slowDown(token))) back(token, { error: "Too many taps. Try again in a little while." });
  const read = await readPayLink(token);
  if (read.kind !== "said") redirect(`/p/${token}`);
  const s = read;
  // A new-style "I've paid" is a waiting claim: take it back (allowed only while it's still waiting).
  if (s.claimId) {
    const w = await withdrawClaim(s.claimId, s.link.fromId);
    back(token, w.ok ? { undone: "1" } : { error: w.error });
  }
  const amountText = formatMoney(s.amount, s.currency);
  try {
  await db.$transaction(async (tx) => {
    // First: the group is still open and in the same currency (a closed group's payments are not changed from here).
    await guardGroup(tx, s.group.id, { currency: s.group.currency, actorId: s.link.fromId });
    const leaver = await removedPaymentsBreak(tx, s.group.id, [s.link.paymentId]);
    if (leaver.length) throw new LeaverBreak(leaver[0], "changed here");
    const gone = await tx.payment.updateMany({ where: { id: s.link.paymentId, okAt: null, deletedAt: null }, data: { deletedAt: new Date(), deletedById: s.link.fromId } });
    if (gone.count !== 1) return;
    await tx.payLink.update({ where: { id: s.link.id }, data: { paymentId: "" } });
    await logEvent(tx, {
      groupId: s.group.id,
      actorId: s.link.fromId,
      kind: "payment_deleted",
      text: `took back “paid ${s.toName} ${amountText}”`,
      paymentId: s.link.paymentId,
    });
  });
  } catch (err) {
    if (err instanceof LeaverBreak) back(token, { error: err.message });
    if (err instanceof GroupChanged) back(token, { error: err.reason === "closed" ? "This group is closed, so this can’t be taken back here." : err.reason === "actor_left" ? "You’re no longer in this group, so this can’t be taken back here." : groupChangedText(err) });
    throw err;
  }
  back(token, { undone: "1" });
}
