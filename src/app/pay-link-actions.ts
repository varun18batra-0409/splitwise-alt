"use server";

import { headers } from "next/headers";
import { redirect } from "@/lib/fresh-redirect";
import { flashTo } from "@/lib/flash";
import { db } from "@/lib/db";
import { allow, clientIp } from "@/lib/rate-limit";
import { readPayLink, recordLinkPayment } from "@/lib/pay-link";
import { changePayment } from "@/lib/payment-change";

// The "I've paid" link (no sign-in): say you paid what you owe. It is recorded as a payment right away and counts now; the person paid is
// told and can delete it if it is wrong. Taking it back from here is allowed only to the payer, and only while nobody has left.

const tokenOf = (f: FormData) => {
  const t = String(f.get("token") ?? "");
  return /^[A-Za-z0-9_-]{20,40}$/.test(t) ? t : "";
};
const back = async (token: string, q: Record<string, string>): Promise<never> => {
  const { error, ...rest } = q;
  return redirect(await flashTo(["p", token], error !== undefined ? { error } : {}, rest));
};

async function slowDown(token: string) {
  const ip = clientIp(await headers());
  return (await allow(`paylink-ip:${ip}`, 30, 3600)) && (await allow(`paylink:${token}`, 12, 3600));
}

export async function iPaidAction(f: FormData) {
  const token = tokenOf(f);
  if (!token) redirect("/");
  if (!(await slowDown(token))) await back(token, { error: "Too many taps. Try again in a little while." });
  const read = await readPayLink(token);
  if (read.kind !== "owes") redirect(`/p/${token}`); // gone, already paid, all square, or closed: the page explains
  const s = read;
  const done = await recordLinkPayment({ link: s.link, amount: s.amount, currency: s.group.currency, toName: s.toName });
  if (!done) await back(token, { error: "That didn’t go through. Open the link again to see where things stand." });
  await back(token, { paid: "1" });
}

export async function undoIPaidAction(f: FormData) {
  const token = tokenOf(f);
  if (!token) redirect("/");
  if (!(await slowDown(token))) await back(token, { error: "Too many taps. Try again in a little while." });
  const read = await readPayLink(token);
  if (read.kind !== "paid") redirect(`/p/${token}`);
  const s = read;
  // Someone with no sign-in never brings anyone back into the group: if either person has left, this is for them to do in Loopin.
  // That is checked inside the same transaction as the delete, so a leaving that lands in between can't be missed.
  const r = await changePayment(s.link.paymentId, s.link.fromId, true, { noLeavers: true });
  if (!r.ok) await back(token, { error: r.error });
  // The link forgets that payment, so it asks for what is owed again.
  await db.payLink.updateMany({ where: { id: s.link.id, paymentId: s.link.paymentId }, data: { paymentId: "" } });
  await back(token, { undone: "1" });
}
