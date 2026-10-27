"use server";

import { headers } from "next/headers";
import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { formatMoney } from "@/lib/money";
import { needsOkFor } from "@/lib/payment-ok";
import { allow, clientIp } from "@/lib/rate-limit";
import { readPayLink } from "@/lib/pay-link";

// The "I've paid" link (no sign-in): say you paid what you owe, or take it back
// while it's still waiting for the other person's "Got it".

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
  const amountText = formatMoney(s.amount, s.group.currency);
  const to = await db.member.findUnique({ where: { id: s.link.toId }, select: { id: true, accountId: true, claimedAt: true } });
  let ok = false;
  try {
    ok = await db.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: { groupId: s.group.id, fromId: s.link.fromId, toId: s.link.toId, amount: s.amount, createdById: s.link.fromId, needsOk: needsOkFor(to ?? undefined, s.link.fromId) },
      });
      // Only one tap wins: the link still points at the payment we read.
      const claimed = await tx.payLink.updateMany({ where: { id: s.link.id, paymentId: s.link.paymentId }, data: { paymentId: p.id } });
      if (claimed.count !== 1) throw new Error("double tap");
      await logEvent(tx, {
        groupId: s.group.id,
        actorId: s.link.fromId,
        kind: "payment_recorded",
        text: `paid ${s.toName} ${amountText} (from the reminder link)`,
        paymentId: p.id,
        undo: { type: "payment_delete", paymentId: p.id },
      });
      return true;
    });
  } catch {
    ok = false;
  }
  back(token, ok ? { paid: "1" } : {});
}

export async function undoIPaidAction(f: FormData) {
  const token = tokenOf(f);
  if (!token) redirect("/");
  if (!(await slowDown(token))) back(token, { error: "Too many taps. Try again in a little while." });
  const read = await readPayLink(token);
  if (read.kind !== "said") redirect(`/p/${token}`);
  const s = read;
  const amountText = formatMoney(s.amount, s.group.currency);
  await db.$transaction(async (tx) => {
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
  back(token, { undone: "1" });
}
