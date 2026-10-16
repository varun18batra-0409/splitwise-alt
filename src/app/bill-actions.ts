"use server";

import { redirect } from "next/navigation";
import { getMyMemberId } from "@/lib/identity";
import { billCommand, saveBillFor, saveSettleRulesFor, toggleMissedDayFor } from "@/lib/home/bill-setup";
import { addListItem, buyListItems, goingShopping, removeListItem, toggleListItem } from "@/lib/home/list-db";
import { cleanKey } from "@/lib/once";

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
