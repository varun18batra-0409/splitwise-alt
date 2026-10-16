"use server";

import { redirect } from "next/navigation";
import { getMyMemberId } from "@/lib/identity";
import { billCommand, saveBillFor, saveSettleRulesFor, toggleMissedDayFor } from "@/lib/home/bill-setup";
import { addListItem, buyListItems, goingShopping, removeListItem, toggleListItem } from "@/lib/home/list-db";
import { cleanKey } from "@/lib/once";
import { saveBudgetsFor } from "@/lib/home/budgets-db";
import { moveOut, returnDepositFor, saveDepositFor } from "@/lib/home/moving-db";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { niceDate } from "@/lib/format";

// Home & Couple groups: bills (set up, change, skip / pause / stop, the daily
// calendar), settle-up rules, and the shopping list.

async function me(groupId: string) {
  const id = await getMyMemberId(groupId);
  if (!id) redirect("/private");
  return id;
}

export async function saveBill(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const actor = await me(groupId);
  const billId = String(formData.get("billId") ?? "") || undefined;
  const r = await saveBillFor(groupId, actor, {
    billId,
    template: String(formData.get("template") ?? "other"),
    name: String(formData.get("name") ?? ""),
    nature: String(formData.get("nature") ?? "fixed"),
    amount: String(formData.get("amount") ?? ""),
    day: String(formData.get("day") ?? "1"),
    payer: String(formData.get("payer") ?? ""),
    split: String(formData.get("split") ?? "group"),
    ids: formData.getAll("ids").map(String),
  });
  const back = billId ? `/groups/${groupId}/bills/${billId}` : `/groups/${groupId}/bills/new`;
  if (!r.ok) redirect(`${back}?error=${encodeURIComponent(r.error)}`);
  redirect(`/groups/${groupId}?tab=bills&saved=bill`);
}

export async function changeBill(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const billId = String(formData.get("billId") ?? "");
  const r = await billCommand(groupId, await me(groupId), billId, String(formData.get("command") ?? ""));
  if (!r.ok) redirect(`/groups/${groupId}/bills/${billId}?error=${encodeURIComponent(r.error)}`);
  redirect(formData.get("command") === "stop" ? `/groups/${groupId}?tab=bills` : `/groups/${groupId}/bills/${billId}?saved=1`);
}

export async function toggleMissedDay(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const billId = String(formData.get("billId") ?? "");
  const r = await toggleMissedDayFor(groupId, await me(groupId), billId, String(formData.get("period") ?? ""), Number(formData.get("day")));
  if (!r.ok) redirect(`/groups/${groupId}/bills/${billId}?error=${encodeURIComponent(r.error)}`);
  redirect(`/groups/${groupId}/bills/${billId}#calendar`);
}

export async function saveSettleRules(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const r = await saveSettleRulesFor(groupId, await me(groupId), {
    reminders: formData.get("reminders") === "on",
    settleDay: Number(formData.get("settleDay") ?? 0),
    settleMin: String(formData.get("settleMin") ?? ""),
  });
  if (!r.ok) redirect(`/groups/${groupId}/settings?error=${encodeURIComponent(r.error)}#settling`);
  redirect(`/groups/${groupId}/settings?saved=settling#settling`);
}

// ---------- Shopping list ----------

export async function listAdd(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const r = await addListItem(groupId, await me(groupId), String(formData.get("text") ?? ""));
  redirect(`/groups/${groupId}?tab=list${r.ok ? "" : `&error=${encodeURIComponent(r.error)}`}`);
}

export async function listToggle(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await toggleListItem(groupId, await me(groupId), String(formData.get("itemId") ?? ""));
  redirect(`/groups/${groupId}?tab=list`);
}

export async function listRemove(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await removeListItem(groupId, await me(groupId), String(formData.get("itemId") ?? ""));
  redirect(`/groups/${groupId}?tab=list`);
}

export async function listBuy(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const key = cleanKey(formData.get("rid")) ?? `buy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const r = await buyListItems(groupId, await me(groupId), String(formData.get("amount") ?? ""), key);
  if (!r.ok) redirect(`/groups/${groupId}?tab=list&error=${encodeURIComponent(r.error)}`);
  redirect(`/groups/${groupId}?tab=list&bought=1`);
}

export async function listGoingShopping(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await goingShopping(groupId, await me(groupId));
  redirect(`/groups/${groupId}?tab=list&told=1`);
}

// ---------- Budgets ----------

export async function saveBudgets(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const amounts: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("b_")) amounts[k.slice(2)] = String(v);
  const r = await saveBudgetsFor(groupId, await me(groupId), amounts);
  if (!r.ok) redirect(`/groups/${groupId}/budgets?error=${encodeURIComponent(r.error)}`);
  redirect(`/groups/${groupId}`);
}

// ---------- Moving in / out and the deposit ----------

export async function setMoveIn(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const actor = await me(groupId);
  const memberId = String(formData.get("memberId") ?? "");
  const day = String(formData.get("day") ?? "");
  const member = await db.member.findFirst({ where: { id: memberId, groupId } });
  if (!member) redirect(`/groups/${groupId}/people`);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T12:00:00Z`) : null;
  await db.member.update({ where: { id: member.id }, data: { joinedFrom: date } });
  await logEvent(db, {
    groupId,
    actorId: actor,
    kind: "bill_changed",
    text: date ? `noted ${member.name} moved in on ${niceDate(day)}` : `cleared ${member.name}’s moving-in date`,
    details: date ? ["Bills that month are shared from that day"] : [],
  });
  redirect(`/groups/${groupId}/people`);
}

export async function moveOutAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const leaverId = String(formData.get("leaverId") ?? "");
  const lastDay = String(formData.get("lastDay") ?? "");
  const r = await moveOut(groupId, await me(groupId), {
    leaverId,
    lastDay,
    depositTo: String(formData.get("depositTo") ?? "") || undefined,
    requestKey: cleanKey(formData.get("rid")) ?? `move-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  });
  if (!r.ok) redirect(`/groups/${groupId}/people/${leaverId}/move?day=${encodeURIComponent(lastDay)}&error=${encodeURIComponent(r.error)}`);
  redirect(`/groups/${groupId}?tab=activity`);
}

export async function saveDeposit(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const amounts: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("d_")) amounts[k.slice(2)] = String(v);
  const r = await saveDepositFor(groupId, await me(groupId), { heldBy: String(formData.get("heldBy") ?? ""), amounts });
  if (!r.ok) redirect(`/groups/${groupId}/deposit?error=${encodeURIComponent(r.error)}`);
  redirect(`/groups/${groupId}/deposit?saved=1`);
}

export async function returnDeposit(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const r = await returnDepositFor(groupId, await me(groupId), String(formData.get("deductions") ?? ""));
  if (!r.ok) redirect(`/groups/${groupId}/deposit?error=${encodeURIComponent(r.error)}`);
  redirect(`/groups/${groupId}/deposit?returned=1`);
}
