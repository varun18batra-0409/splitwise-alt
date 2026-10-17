"use server";

import { redirect } from "next/navigation";
import { billCommand, saveBillFor, saveSettleRulesFor, toggleMissedDayFor } from "@/lib/home/bill-setup";
import { addListItem, buyListItems, goingShopping, removeListItem, toggleListItem } from "@/lib/home/list-db";
import { cleanKey } from "@/lib/once";
import { saveBudgetsFor } from "@/lib/home/budgets-db";
import { moveOut, returnDepositFor, saveDepositFor } from "@/lib/home/moving-db";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { niceDate } from "@/lib/format";
import { addGoalEntryFor, deleteGoalFor, saveGoalFor } from "@/lib/home/goals-db";
import { getAccount, getMyMemberId, setMyMemberId } from "@/lib/identity";
import { createGroupFor } from "@/lib/group-setup";
import { addRegistered } from "@/lib/invites";
import { headers } from "next/headers";
import { after } from "next/server";
import { claimOnce } from "@/lib/push";

// Home & Couple groups: bills (set up, change, skip / pause / stop, the daily
// calendar), settle-up rules, and the shopping list.

// Who's acting: must still be in the group (not just carry its cookie).
async function me(groupId: string) {
  const id = await getMyMemberId(groupId);
  if (!id || !(await db.member.findFirst({ where: { id, groupId, leftAt: null }, select: { id: true } }))) redirect("/private");
  return id;
}

// "p_<memberId>" → { memberId: value } for the percentage / amount boxes.
function perPerson(formData: FormData, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = String(v).slice(0, 20);
  return out;
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
    pct: perPerson(formData, "p_"),
    amt: perPerson(formData, "a_"),
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

// ---------- Savings goals ----------

export async function saveGoal(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const goalId = String(formData.get("goalId") ?? "") || undefined;
  const r = await saveGoalFor(groupId, await me(groupId), {
    goalId,
    name: String(formData.get("name") ?? ""),
    target: String(formData.get("target") ?? ""),
    byDate: String(formData.get("byDate") ?? ""),
  });
  if (!r.ok) redirect(`/groups/${groupId}/goals/${goalId ?? "new"}?error=${encodeURIComponent(r.error)}`);
  redirect(`/groups/${groupId}/goals/${r.id}`);
}

export async function addGoalEntry(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const goalId = String(formData.get("goalId") ?? "");
  const r = await addGoalEntryFor(
    groupId,
    await me(groupId),
    goalId,
    String(formData.get("amount") ?? ""),
    cleanKey(formData.get("rid")) ?? `goal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  redirect(`/groups/${groupId}/goals/${goalId}${r.ok ? "?added=1" : `?error=${encodeURIComponent(r.error)}`}`);
}

export async function deleteGoal(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  await deleteGoalFor(groupId, await me(groupId), String(formData.get("goalId") ?? ""));
  redirect(`/groups/${groupId}`);
}

// Goal reached: start a trip group with the same people (signed in only).
export async function tripFromGoal(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const actor = await me(groupId);
  const account = await getAccount();
  const goal = await db.goal.findFirst({ where: { id: String(formData.get("goalId") ?? ""), groupId, deletedAt: null, reachedAt: { not: null } }, include: { group: { include: { members: true } } } });
  const meMember = goal?.group.members.find((m) => m.id === actor);
  if (!goal || !account || !meMember) redirect(`/groups/${groupId}`);
  // Once per goal: a second tap (or a retry) doesn't make a second trip.
  if (!(await claimOnce(`trip-from-goal:${goal.id}`))) redirect("/");
  const trip = await createGroupFor(account, { type: "trip", name: goal.name, yourName: meMember.name, currency: goal.group.currency });
  await setMyMemberId(trip.id, trip.members[0].id);
  const { origin } = await originOf();
  for (const m of goal.group.members) if (!m.leftAt && m.accountId && m.id !== actor) await addRegistered(trip.id, trip.members[0].id, m.accountId, origin, { later: (job) => after(job) });
  redirect(`/groups/${trip.id}`);
}

async function originOf() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return { origin: `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}` };
}
