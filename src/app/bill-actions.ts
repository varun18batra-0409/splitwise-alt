"use server";

import { SITE_URL } from "@/lib/site";
import { isGroupAdmin } from "@/lib/group-admin";

import { redirect } from "@/lib/fresh-redirect";
import { billCommand, saveBillFor, toggleMissedDayFor } from "@/lib/home/bill-setup";
import { addListItem, buyListItems, goingShopping, removeListItem, toggleListItem } from "@/lib/home/list-db";
import { cleanKey } from "@/lib/once";
import { tripFromGoalOnce } from "@/lib/goal-trip";
import { saveBudgetsFor } from "@/lib/home/budgets-db";
import { MOVE_OUT_KEY_CHANGED, moveOut, moveBackInFor, returnDepositFor, saveDepositFor, setMoveInFor } from "@/lib/home/moving-db";
import { isPairGroup } from "@/lib/direct-guard";
import { db } from "@/lib/db";
import { addGoalEntryFor, deleteGoalFor, saveGoalFor } from "@/lib/home/goals-db";
import { getAccount, getMyMemberId, setMyMemberId } from "@/lib/identity";
import { createGroupFor } from "@/lib/group-setup";
import { addRegistered, freeName } from "@/lib/invites";
import { headers } from "next/headers";
import { after } from "next/server";
import { flashTo } from "@/lib/flash";
import { getTimeZone } from "@/lib/tz";
import { gateGuest, refusalNotes } from "@/lib/guest-rules";
import { FORM_OUT_OF_DATE, formCurrencyRefusal } from "@/lib/form-currency";

// Home & Couple groups: bills (set up, change, skip / pause / stop, the daily
// calendar), settle-up rules, and the shopping list.

// Who's acting: must still be in the group (not just carry its cookie).
// Bills, budgets, deposits, goals and moving out are group-wide money setup: they need an account, so a guest is sent to the group
// with the sign-in note (the sheet opens there). The shopping list uses meOpen: a guest may use it.
async function meOpen(groupId: string) {
  const id = await getMyMemberId(groupId);
  if (!id || !(await db.member.findFirst({ where: { id, groupId, leftAt: null }, select: { id: true } }))) redirect("/private");
  return id;
}
async function me(groupId: string) {
  const id = await meOpen(groupId);
  const refused = await gateGuest(id);
  if (refused) redirect(await flashTo(["groups", groupId], refusalNotes(refused)));
  return id;
}

// A form that posts amounts must carry the currency its page was drawn in (see form-currency.ts): null = fine.
async function staleForm(groupId: string, formData: FormData): Promise<string | null> {
  const g = await db.group.findUnique({ where: { id: groupId }, select: { currency: true } });
  return g ? formCurrencyRefusal(formData.get("currency"), g.currency) : null;
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
  const stale = await staleForm(groupId, formData);
  if (stale) redirect(await flashTo(billId ? ["groups", groupId, "bills", billId] : ["groups", groupId, "bills", "new"], { error: stale }));
  // Editing: the bill as the form showed it. Missing = a page opened before this check: look again.
  const billWas = String(formData.get("billWas") ?? "");
  if (billId && !billWas) redirect(await flashTo(["groups", groupId, "bills", billId], { error: FORM_OUT_OF_DATE }));
  const r = await saveBillFor(groupId, actor, {
    billId,
    was: billId ? billWas : undefined,
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
    key: billId ? undefined : cleanKey(formData.get("rid")),
    currency: String(formData.get("currency") ?? ""),
  });
  if (!r.ok) redirect(await flashTo(billId ? ["groups", groupId, "bills", billId] : ["groups", groupId, "bills", "new"], { error: r.error }));
  redirect(`/groups/${groupId}?tab=bills&saved=bill`);
}

export async function changeBill(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const billId = String(formData.get("billId") ?? "");
  const command = String(formData.get("command") ?? "");
  const actor = await me(groupId);
  // Skip names the month it was shown for. A form from before this (no month) is not guessed at: look again.
  const period = formData.get("period");
  if (command === "skip" && period === null) redirect(await flashTo(["groups", groupId, "bills", billId], { error: FORM_OUT_OF_DATE }));
  const r = await billCommand(groupId, actor, billId, command, new Date(), command === "skip" ? { period: String(period) } : {});
  if (!r.ok) redirect(await flashTo(["groups", groupId, "bills", billId], { error: r.error }));
  redirect(formData.get("command") === "stop" ? `/groups/${groupId}?tab=bills` : `/groups/${groupId}/bills/${billId}?saved=1`);
}

export async function toggleMissedDay(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const billId = String(formData.get("billId") ?? "");
  const r = await toggleMissedDayFor(groupId, await me(groupId), billId, String(formData.get("period") ?? ""), Number(formData.get("day")));
  if (!r.ok) redirect(await flashTo(["groups", groupId, "bills", billId], { error: r.error }));
  redirect(`/groups/${groupId}/bills/${billId}#calendar`);
}

// ---------- Shopping list ----------

export async function listAdd(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const r = await addListItem(groupId, await meOpen(groupId), String(formData.get("text") ?? ""));
  redirect(await flashTo(["groups", groupId], r.ok ? {} : { error: r.error }, { tab: "list" }));
}

export async function listToggle(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const r = await toggleListItem(groupId, await meOpen(groupId), String(formData.get("itemId") ?? ""));
  redirect(await flashTo(["groups", groupId], r.ok ? {} : { error: r.error }, { tab: "list" }));
}

export async function listRemove(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const r = await removeListItem(groupId, await meOpen(groupId), String(formData.get("itemId") ?? ""));
  redirect(await flashTo(["groups", groupId], r.ok ? {} : { error: r.error }, { tab: "list" }));
}

export async function listBuy(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const key = cleanKey(formData.get("rid")) ?? `buy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const stale = await staleForm(groupId, formData);
  if (stale) redirect(await flashTo(["groups", groupId], { error: stale }, { tab: "list" }));
  const r = await buyListItems(groupId, await meOpen(groupId), String(formData.get("amount") ?? ""), key);
  if (!r.ok) redirect(await flashTo(["groups", groupId], { error: r.error }, { tab: "list" }));
  redirect(`/groups/${groupId}?tab=list&bought=1`);
}

export async function listGoingShopping(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const r = await goingShopping(groupId, await meOpen(groupId));
  redirect(await flashTo(["groups", groupId], r.ok ? {} : { error: r.error }, { tab: "list", ...(r.ok ? { told: "1" } : {}) }));
}

// ---------- Budgets ----------

export async function saveBudgets(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const amounts: Record<string, string> = {};
  const was: Record<string, string> = {}; // what each box showed (the amount in minor units, or "")
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("b_")) amounts[k.slice(2)] = String(v);
    else if (k.startsWith("was_")) was[k.slice(4)] = String(v).slice(0, 14);
  }
  const stale = await staleForm(groupId, formData);
  if (stale) redirect(await flashTo(["groups", groupId, "budgets"], { error: stale }));
  const r = await saveBudgetsFor(groupId, await me(groupId), amounts, { was, currency: String(formData.get("currency") ?? "") });
  if (!r.ok) redirect(await flashTo(["groups", groupId, "budgets"], { error: r.error }));
  redirect(`/groups/${groupId}`);
}

// ---------- Moving in / out and the deposit ----------

export async function setMoveIn(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const actor = await me(groupId);
  if (await isPairGroup(groupId)) redirect(`/people/${groupId}`); // a pair has no moving in
  const memberId = String(formData.get("memberId") ?? "");
  const day = String(formData.get("day") ?? "");
  // Everything is checked in setMoveInFor (a flat only, open, a real date, the person still here); a refusal shows on the People page.
  const r = await setMoveInFor(groupId, actor, memberId, day);
  if (!r.ok) redirect(await flashTo(["groups", groupId, "people"], { error: r.error }));
  redirect(`/groups/${groupId}/people`);
}

// "C has moved back in" (People page): someone settling up only is a member again from the day picked.
export async function movedBackIn(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const actor = await me(groupId);
  if (await isPairGroup(groupId)) redirect(`/people/${groupId}`);
  const memberId = String(formData.get("memberId") ?? "");
  const day = String(formData.get("day") ?? "");
  const r = await moveBackInFor(groupId, actor, memberId, day);
  if (!r.ok) redirect(await flashTo(["groups", groupId, "people"], { error: r.error }));
  redirect(`/groups/${groupId}/people`);
}

export async function moveOutAction(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const leaverId = String(formData.get("leaverId") ?? "");
  const lastDay = String(formData.get("lastDay") ?? "");
  const myId = await me(groupId);
  // A pair has no moving out (the lib refuses too).
  if (await isPairGroup(groupId)) redirect(`/people/${groupId}`);
  // You can move yourself out; moving someone else out is for whoever looks after the flat.
  if (myId && leaverId !== myId && !(await isGroupAdmin(groupId, myId))) {
    redirect(await flashTo(["groups", groupId, "people", leaverId, "move"], { error: "Only the person moving out, or whoever looks after this flat, can do this." }, { day: lastDay }));
  }
  // The final payments the page showed (with or without the daily charges, as ticked). Missing = a form from before this check: look again.
  const addDaily = formData.get("addDaily") === "1";
  const expectKey = formData.get(addDaily ? "expectKeyDaily" : "expectKey");
  if (expectKey === null) {
    redirect(await flashTo(["groups", groupId, "people", leaverId, "move"], { error: MOVE_OUT_KEY_CHANGED }, { day: lastDay }));
  }
  // The leaver's held deposit the page showed ("" = none). Missing = a form from before this check: look again.
  const expectDeposit = formData.get("expectDeposit");
  if (expectDeposit === null) {
    redirect(await flashTo(["groups", groupId, "people", leaverId, "move"], { error: FORM_OUT_OF_DATE }, { day: lastDay }));
  }
  const r = await moveOut(groupId, myId, {
    leaverId,
    lastDay,
    depositTo: String(formData.get("depositTo") ?? "") || undefined,
    addDaily,
    expectKey: String(expectKey),
    expectDeposit: String(expectDeposit),
    requestKey: cleanKey(formData.get("rid")) ?? `move-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  }, new Date(), { tz: await getTimeZone() });
  if (!r.ok) redirect(await flashTo(["groups", groupId, "people", leaverId, "move"], { error: r.error }, { day: lastDay }));
  // `did`: the move-out's own line, so the person who moved out (or whoever marked them) gets the Undo bar.
  redirect(`/groups/${groupId}?tab=activity${r.eventId ? `&did=${r.eventId}` : ""}`);
}

export async function saveDeposit(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const amounts: Record<string, string> = {};
  const versions: Record<string, string> = {}; // what each box showed (see depositVersion)
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("d_")) amounts[k.slice(2)] = String(v);
    else if (k.startsWith("v_")) versions[k.slice(2)] = String(v).slice(0, 60);
  }
  const stale = await staleForm(groupId, formData);
  if (stale) redirect(await flashTo(["groups", groupId, "deposit"], { error: stale }));
  const r = await saveDepositFor(groupId, await me(groupId), { heldBy: String(formData.get("heldBy") ?? ""), heldByWas: formData.has("heldByWas") ? String(formData.get("heldByWas")) : undefined, amounts, versions, currency: String(formData.get("currency") ?? "") });
  if (!r.ok) redirect(await flashTo(["groups", groupId, "deposit"], { error: r.error }));
  redirect(`/groups/${groupId}/deposit?saved=1`);
}

export async function returnDeposit(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const stale = await staleForm(groupId, formData);
  if (stale) redirect(await flashTo(["groups", groupId, "deposit"], { error: stale }));
  const r = await returnDepositFor(groupId, await me(groupId), String(formData.get("deductions") ?? ""), { currency: String(formData.get("currency") ?? "") });
  if (!r.ok) redirect(await flashTo(["groups", groupId, "deposit"], { error: r.error }));
  redirect(`/groups/${groupId}/deposit?returned=1`);
}

// ---------- Savings goals ----------

export async function saveGoal(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const goalId = String(formData.get("goalId") ?? "") || undefined;
  const stale = await staleForm(groupId, formData);
  if (stale) redirect(await flashTo(["groups", groupId, "goals", goalId ?? "new"], { error: stale }));
  const r = await saveGoalFor(groupId, await me(groupId), {
    goalId,
    name: String(formData.get("name") ?? ""),
    target: String(formData.get("target") ?? ""),
    byDate: String(formData.get("byDate") ?? ""),
  });
  if (!r.ok) redirect(await flashTo(["groups", groupId, "goals", goalId ?? "new"], { error: r.error }));
  redirect(`/groups/${groupId}/goals/${r.id}`);
}

export async function addGoalEntry(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const goalId = String(formData.get("goalId") ?? "");
  const stale = await staleForm(groupId, formData);
  if (stale) redirect(await flashTo(["groups", groupId, "goals", goalId], { error: stale }));
  const r = await addGoalEntryFor(
    groupId,
    await me(groupId),
    goalId,
    String(formData.get("amount") ?? ""),
    // No usable key (the field was empty): none, so the server's double-tap guard applies instead of a made-up key.
    cleanKey(formData.get("rid")),
  );
  redirect(await flashTo(["groups", groupId, "goals", goalId], r.ok ? {} : { error: r.error }, r.ok ? { added: "1" } : {}));
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
  // Once per goal (see goal-trip.ts): a second tap goes to the trip the first one made; a failed attempt can be retried.
  const made = await tripFromGoalOnce(goal.id, () => createGroupFor(account, { type: "trip", name: goal.name, yourName: meMember.name, currency: goal.group.currency }));
  if ("existing" in made) {
    // Straight to the trip if you are in it (your own retry); otherwise back to this group (someone else already made it).
    const inIt = made.existing && await db.member.findFirst({ where: { groupId: made.existing, accountId: account.id, leftAt: null }, select: { id: true } });
    redirect(inIt ? `/groups/${made.existing}` : `/groups/${groupId}`);
  }
  // The trip it made was deleted but can still be brought back: show Recently deleted with a note (no second trip).
  if ("deleted" in made) redirect("/groups?deleted=trip");
  if ("busy" in made) redirect(`/groups/${groupId}`);
  const trip = made.trip;
  await setMyMemberId(trip.id, trip.members[0].id);
  const { origin } = await originOf();
  const taken = trip.members.map((x) => x.name);
  for (const m of goal.group.members) {
    if (m.leftAt || !m.accountId || m.id === actor) continue;
    const r = await addRegistered(trip.id, trip.members[0].id, m.accountId, origin, { later: (job) => after(job) });
    // Someone the search rule won't add by account (for example added to the goal's group but who never opened it) is still part of "the same
    // people": carried over as a plain name, never silently dropped. They can be invited from People as usual.
    if (!r.ok) {
      const name = freeName(taken, m.name);
      taken.push(name);
      await db.member.create({ data: { name, groupId: trip.id } });
    }
  }
  redirect(`/groups/${trip.id}`);
}

async function originOf() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  if (process.env.VERCEL_ENV === "production") return { origin: SITE_URL };
  return { origin: `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}` };
}
