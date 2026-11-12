"use server";

import { redirect } from "@/lib/fresh-redirect";
import { db } from "@/lib/db";
import { getAccount, getMyMemberId } from "@/lib/identity";
import { cleanPayWays } from "@/lib/pay-links";
import { confirmPayment, rejectPayment } from "@/lib/payment-ok";
import { confirmClaim, declineClaim, makeClaim, tellReceiver, withdrawClaim } from "@/lib/payment-claims";
import { hasLeft, LEFT_ERROR } from "@/lib/active";
import { formatMoney } from "@/lib/money";

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

// "Confirm received" / "Not received" on a payment someone else recorded (older ones that already count).
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

// "I've paid" claims (see lib/payment-claims.ts). Nothing here changes a balance except "Confirm received".
async function claimRow(claimId: string) {
  const c = /^[A-Za-z0-9_-]{6,40}$/.test(claimId) ? await db.paymentClaim.findUnique({ where: { id: claimId } }) : null;
  if (!c) redirect("/");
  return c;
}
const settleUrl = (groupId: string, q: Record<string, string>) => `/groups/${groupId}/settle?${new URLSearchParams(q)}`;

// Settle up → "I've paid ₹X" (the payer's own button).
export async function claimPaidAction(f: FormData) {
  const groupId = field(f, "groupId");
  const myId = await getMyMemberId(groupId);
  if (!myId) redirect("/private");
  const fromId = field(f, "fromId");
  const toId = field(f, "toId");
  const expect = Number(field(f, "amount"));
  if (fromId !== myId) redirect(settleUrl(groupId, { error: "Only the person paying can say they paid. To record someone else’s payment, use Record a different payment." }));
  if (await hasLeft(groupId, myId)) redirect(settleUrl(groupId, { error: LEFT_ERROR }));
  const r = await makeClaim({ groupId, fromId, toId, actorId: myId, source: "app", expectAmount: Number.isSafeInteger(expect) && expect > 0 ? expect : undefined });
  if (!r.ok) redirect(settleUrl(groupId, { error: r.error }));
  if (!r.already) {
    const g = await db.group.findUnique({ where: { id: groupId }, select: { name: true, currency: true } });
    const me = await db.member.findUnique({ where: { id: myId }, select: { name: true } });
    tellReceiver({ claimId: r.claimId, groupId, groupName: g?.name ?? "Loopin", toId, fromName: me?.name ?? "Someone", amountText: formatMoney(r.amount ?? 0, g?.currency ?? "INR"), fromId });
  }
  redirect(settleUrl(groupId, { claimed: "1" }));
}

export async function withdrawClaimAction(f: FormData) {
  const c = await claimRow(field(f, "claimId"));
  const r = await withdrawClaim(c.id, await getMyMemberId(c.groupId));
  redirect(settleUrl(c.groupId, r.ok ? { withdrawn: "1" } : { error: r.error }));
}

export async function confirmClaimAction(f: FormData) {
  const c = await claimRow(field(f, "claimId"));
  const r = await confirmClaim(c.id, await getMyMemberId(c.groupId), { over: field(f, "over") === "1" });
  if (!r.ok && r.over) redirect(settleUrl(c.groupId, { overclaim: c.id, over: String(r.over) }));
  redirect(settleUrl(c.groupId, r.ok ? { ok: "1", ...(r.eventId ? { did: r.eventId } : {}) } : { error: r.error }));
}

export async function declineClaimAction(f: FormData) {
  const c = await claimRow(field(f, "claimId"));
  const r = await declineClaim(c.id, await getMyMemberId(c.groupId));
  redirect(settleUrl(c.groupId, r.ok ? { declined: "1" } : { error: r.error }));
}

// Settle up → "Mark all N paid": every payment shown that someone else makes, recorded at once; the group stays open.
export async function markAllPaidAction(f: FormData) {
  const groupId = field(f, "groupId");
  const myId = await getMyMemberId(groupId);
  if (!myId) redirect("/private");
  const { loadGroup } = await import("@/lib/group-data");
  const { applySettleMin } = await import("@/lib/settle");
  const { markAllPaid, planKey } = await import("@/lib/settle-all");
  const data = await loadGroup(groupId, { events: false });
  if (!data) redirect("/");
  if (planKey(data.transfers) !== field(f, "plan")) redirect(`/groups/${groupId}/settle?${new URLSearchParams({ error: "Balances changed since you opened this. Check the updated list and try again." })}`);
  const { shown } = applySettleMin(data.transfers, data.group.settleMin);
  const { cleanKey } = await import("@/lib/once");
  // Only other people's payments: the ones I make myself go through "I've paid" (a claim the other person confirms).
  const r = await markAllPaid(groupId, myId, shown.filter((t) => t.from !== myId).map((t) => ({ from: t.from, to: t.to, amount: t.amount })), "", true, cleanKey(f.get("rid")));
  redirect(`/groups/${groupId}/settle?${new URLSearchParams(r.ok ? { paid: "all", ...(r.eventId ? { did: r.eventId } : {}) } : { error: r.error })}`);
}
