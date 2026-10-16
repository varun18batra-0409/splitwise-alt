"use server";

import { redirect } from "next/navigation";
import { getMyMemberId } from "@/lib/identity";
import { billCommand, saveBillFor, toggleMissedDayFor } from "@/lib/home/bill-setup";

// Bills: set up, change, skip / pause / stop, and the daily calendar.

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
