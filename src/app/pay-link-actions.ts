"use server";

import { headers } from "next/headers";
import { redirect } from "@/lib/fresh-redirect";
import { flashTo } from "@/lib/flash";
import { allow, clientIp } from "@/lib/rate-limit";
import { readPayLink, recordLinkPayment } from "@/lib/pay-link";
import { changePayment } from "@/lib/payment-change";
import { formatMoney } from "@/lib/money";
import { FORM_OUT_OF_DATE } from "@/lib/form-currency";

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

// "I've paid" is bound to what the page showed: the amount (whole minor units) and the currency are posted as hidden fields. If either
// no longer matches what is owed right now, nothing is recorded. A form without them (a page opened before this) is refused once.
const WHOLE_UNITS = /^[0-9]{1,15}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

export async function iPaidAction(f: FormData) {
  const token = tokenOf(f);
  if (!token) redirect("/");
  if (!(await slowDown(token))) await back(token, { error: "Too many taps. Try again in a little while." });
  const rawAmount = f.get("amount");
  const rawCurrency = f.get("currency");
  const amountText = typeof rawAmount === "string" ? rawAmount : "";
  const currency = typeof rawCurrency === "string" ? rawCurrency : "";
  if (!WHOLE_UNITS.test(amountText) || !CURRENCY_CODE.test(currency) || !Number.isSafeInteger(Number(amountText)) || Number(amountText) < 1) {
    await back(token, { error: FORM_OUT_OF_DATE });
  }
  const amount = Number(amountText);
  const read = await readPayLink(token);
  if (read.kind !== "owes") redirect(`/p/${token}`); // gone, already paid (a retry lands here: one payment), all square, or closed: the page explains
  const s = read;
  if (currency !== s.group.currency) {
    await back(token, { error: `${s.group.name} now uses ${s.group.currency}, so nothing was recorded. Here’s the new amount.` });
  }
  if (amount !== s.amount) {
    const now = formatMoney(s.amount, s.group.currency);
    await back(token, {
      error: `Since you opened this page, what you owe ${s.toName} changed to ${now}, so nothing was recorded. If you already paid ${formatMoney(amount, currency)}, tell ${s.toName} so they can record it. Otherwise pay ${now} and tap I’ve paid.`,
    });
  }
  const done = await recordLinkPayment({ link: s.link, amount, currency, toName: s.toName });
  if (!done) await back(token, { error: "That didn’t go through. Open the link again to see where things stand." });
  await back(token, { paid: "1" });
}

export async function undoIPaidAction(f: FormData) {
  const token = tokenOf(f);
  if (!token) redirect("/");
  if (!(await slowDown(token))) await back(token, { error: "Too many taps. Try again in a little while." });
  const shown = String(f.get("paymentId") ?? "");
  if (!shown) await back(token, { error: FORM_OUT_OF_DATE });
  const read = await readPayLink(token);
  if (read.kind !== "paid") redirect(`/p/${token}`);
  const s = read;
  const STALE = "This page is out of date: a newer payment was recorded since, so nothing was taken back.";
  // Only the payment this page showed can be taken back from it.
  if (shown !== s.link.paymentId) await back(token, { error: STALE });
  // Someone with no sign-in never brings anyone back into the group: if either person has left, this is for them to do in Loopin.
  // That is checked inside the same transaction as the delete, so a leaving that lands in between can't be missed.
  // The link forgets that payment (so it asks for what is owed again) in the SAME transaction, and only if it still points at it.
  let r: Awaited<ReturnType<typeof changePayment>>;
  try {
    r = await changePayment(s.link.paymentId, s.link.fromId, true, {
      noLeavers: true,
      inside: async (tx) => {
        const reset = await tx.payLink.updateMany({ where: { id: s.link.id, paymentId: s.link.paymentId }, data: { paymentId: "" } });
        if (reset.count !== 1) throw new Error("link moved");
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "link moved") await back(token, { error: STALE });
    throw err;
  }
  if (!r.ok) await back(token, { error: r.error });
  await back(token, { undone: "1" });
}
