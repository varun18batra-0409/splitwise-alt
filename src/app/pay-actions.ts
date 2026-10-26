"use server";

import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { getAccount, getMyMemberId } from "@/lib/identity";
import { cleanPayWays } from "@/lib/pay-links";
import { confirmPayment, rejectPayment } from "@/lib/payment-ok";

const field = (f: FormData, k: string) => String(f.get(k) ?? "");

// You page → "How friends pay you back".
export async function savePayWays(f: FormData) {
  const account = await getAccount();
  if (!account) redirect("/signin?back=/account");
  const r = cleanPayWays({ upiId: field(f, "upiId").slice(0, 120), payLink: field(f, "payLink").slice(0, 300) });
  if (!r.ok) redirect(`/account?${new URLSearchParams({ pay: "error", payError: r.error })}#pay`);
  await db.account.update({ where: { id: account.id }, data: { upiId: r.ways.upiId, payLink: r.ways.payLink } });
  redirect("/account?pay=saved#pay");
}

// "Got it ✓" / "Not received" on a payment someone else recorded.
async function paymentGroup(paymentId: string) {
  const p = /^[A-Za-z0-9_-]{6,40}$/.test(paymentId) ? await db.payment.findUnique({ where: { id: paymentId }, select: { groupId: true } }) : null;
  if (!p) redirect("/");
  return p.groupId;
}

export async function confirmPaymentAction(f: FormData) {
  const paymentId = field(f, "paymentId");
  const groupId = await paymentGroup(paymentId);
  const r = await confirmPayment(paymentId, await getMyMemberId(groupId));
  redirect(`/groups/${groupId}/settle?${new URLSearchParams(r.ok ? { ok: "1" } : { error: r.error })}`);
}

export async function rejectPaymentAction(f: FormData) {
  const paymentId = field(f, "paymentId");
  const groupId = await paymentGroup(paymentId);
  const r = await rejectPayment(paymentId, await getMyMemberId(groupId));
  redirect(`/groups/${groupId}/settle?${new URLSearchParams(r.ok ? { notgot: "1", ...(r.eventId ? { did: r.eventId } : {}) } : { error: r.error })}`);
}

// Settle up → "Mark all paid": every payment shown, recorded at once; the group stays open.
export async function markAllPaidAction(f: FormData) {
  const groupId = field(f, "groupId");
  const myId = await getMyMemberId(groupId);
  if (!myId) redirect("/private");
  const { loadGroup } = await import("@/lib/group-data");
  const { applySettleMin } = await import("@/lib/settle");
  const { markAllPaid, planKey } = await import("@/lib/settle-all");
  const data = await loadGroup(groupId);
  if (!data) redirect("/");
  if (planKey(data.transfers) !== field(f, "plan")) redirect(`/groups/${groupId}/settle?${new URLSearchParams({ error: "Balances changed since you opened this. Check the updated list and try again." })}`);
  const { shown } = applySettleMin(data.transfers, data.group.settleMin);
  const r = await markAllPaid(groupId, myId, shown.map((t) => ({ from: t.from, to: t.to, amount: t.amount })), "");
  redirect(`/groups/${groupId}/settle?${new URLSearchParams(r.ok ? { paid: "all", ...(r.eventId ? { did: r.eventId } : {}) } : { error: r.error })}`);
}
