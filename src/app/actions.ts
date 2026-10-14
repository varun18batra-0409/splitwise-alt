"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMemberships, getMyMemberId, setMyMemberId } from "@/lib/identity";
import { cleanNames, cleanPeople, sameName } from "@/lib/names";
import { isSupportedCurrency, parseAmount, parsePercent } from "@/lib/money";
import { getRate, type RateAnswer } from "@/lib/rate-cache";
import { deletePayment, saveExpense, setExpenseDeleted, setPaymentDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { removeMembers, undoEvent } from "@/lib/undo";
import { isMemberUsed, renameMember, setMemberLeft } from "@/lib/people";
import { settleAllAndClose } from "@/lib/settle-all";
import { changeGroupCurrency, updateGroupBasics } from "@/lib/group-changes";
import { logEvent } from "@/lib/events";
import { formatMoney } from "@/lib/money";

function newInviteCode() {
  return randomBytes(6).toString("base64url"); // 8 characters, hard to guess
}

export async function createGroup(formData: FormData) {
  const groupName = String(formData.get("groupName") ?? "").trim().slice(0, 60);
  const yourName = cleanNames([String(formData.get("yourName") ?? "")])[0];
  if (!groupName || !yourName) redirect("/groups/new?error=missing");

  // Other people, typed or picked from contacts (names + phones in the same order).
  const { people: others } = cleanPeople(
    formData.getAll("member").map(String),
    formData.getAll("memberPhone").map(String),
    [yourName],
  );

  const baseCurrency = String(formData.get("currency") ?? "INR");

  const group = await db.group.create({
    data: {
      name: groupName,
      currency: isSupportedCurrency(baseCurrency) ? baseCurrency : "INR",
      inviteCode: newInviteCode(),
      members: { create: [{ name: yourName }, ...others] },
    },
    include: { members: true },
  });

  const me = group.members.find((m) => m.name === yourName)!;
  await setMyMemberId(group.id, me.id);
  redirect(`/groups/${group.id}`);
}

// Add more people to an existing group (typed or from contacts).
export async function addMembers(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

  const { people, skipped } = cleanPeople(
    formData.getAll("member").map(String),
    formData.getAll("memberPhone").map(String),
    group.members.map((m) => m.name),
  );
  let did = "";
  if (people.length > 0) {
    did = await db.$transaction(async (tx) => {
      const created: { id: string }[] = [];
      for (const p of people) created.push(await tx.member.create({ data: { ...p, groupId: group.id } }));
      return logEvent(tx, {
        groupId: group.id,
        actorId: myId,
        kind: "members_added",
        text: `added ${people.map((p) => p.name).join(", ")} to the group`,
        undo: { type: "members_remove", memberIds: created.map((m) => m.id) },
      });
    });
  }
  const q = new URLSearchParams({ added: String(people.length) });
  if (skipped.length) q.set("skipped", skipped.join(", "));
  q.set("tab", "balances");
  if (did) q.set("did", did);
  redirect(`/groups/${group.id}?${q}`);
}

// "I'm already in this group" — pick your name from the list.
export async function joinAsExisting(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const member = await db.member.findFirst({
    where: { id: memberId, group: { inviteCode: code } },
  });
  if (!member) redirect(`/join/${code}`);
  await setMyMemberId(member.groupId, member.id);
  redirect(`/groups/${member.groupId}`);
}

// "I'm new" — type a name to be added to the group.
export async function joinAsNew(formData: FormData) {
  const code = String(formData.get("code") ?? "");
  const name = cleanNames([String(formData.get("name") ?? "")])[0];
  const group = await db.group.findUnique({
    where: { inviteCode: code },
    include: { members: true },
  });
  if (!group) redirect("/");
  if (!name) redirect(`/join/${code}?error=missing`);
  if (group.members.some((m) => sameName(m.name, name))) {
    redirect(`/join/${code}?error=taken`);
  }

  const member = await db.member.create({ data: { name, groupId: group.id } });
  await logEvent(db, {
    groupId: group.id,
    actorId: member.id,
    kind: "members_added",
    text: "joined the group",
    undo: { type: "members_remove", memberIds: [member.id] },
  });
  await setMyMemberId(group.id, member.id);
  redirect(`/groups/${group.id}`);
}

// Saves a new expense — or changes an existing one — then goes back to the group page.
export async function addExpense(input: SaveExpenseInput): Promise<{ error: string }> {
  const result = await saveExpense(input, await getMyMemberId(input.groupId), getRate);
  if (!result.ok) return { error: result.error };
  redirect(`/groups/${input.groupId}?tab=activity${result.eventId ? `&did=${result.eventId}` : ""}`);
}

// Delete / restore an expense (only whoever added it). History keeps it.
export async function deleteExpense(formData: FormData) {
  await toggleExpense(formData, true);
}
export async function restoreExpense(formData: FormData) {
  await toggleExpense(formData, false);
}
async function toggleExpense(formData: FormData, deleted: boolean) {
  const groupId = String(formData.get("groupId") ?? "");
  const expenseId = String(formData.get("expenseId") ?? "");
  const r = await setExpenseDeleted(expenseId, await getMyMemberId(groupId), deleted);
  const q = r.ok ? (r.eventId ? `did=${r.eventId}` : "") : `error=${encodeURIComponent(r.error)}`;
  redirect(`/groups/${groupId}?tab=activity&${q}`);
}

// Delete a settle-up payment (only whoever recorded it). History keeps it.
export async function removePayment(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const r = await deletePayment(paymentId, await getMyMemberId(groupId));
  redirect(`/groups/${groupId}?tab=activity&${r.ok ? (r.eventId ? `did=${r.eventId}` : "") : `error=${encodeURIComponent(r.error)}`}`);
}

// Bring back a deleted settle-up payment.
export async function restorePayment(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const paymentId = String(formData.get("paymentId") ?? "");
  const r = await setPaymentDeleted(paymentId, await getMyMemberId(groupId), false);
  redirect(`/groups/${groupId}?tab=activity&${r.ok ? (r.eventId ? `did=${r.eventId}` : "") : `error=${encodeURIComponent(r.error)}`}`);
}

// Undo (or redo) any change in a group. `back` says which page to return to.
export async function undoChange(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const back = String(formData.get("back") ?? "group");
  const r = await undoEvent(eventId, await getMyMemberId(groupId));
  const q = r.ok ? `undone=1${r.eventId ? `&did=${r.eventId}` : ""}` : `error=${encodeURIComponent(r.error)}`;
  if (back === "home") redirect(`/?${q}&g=${groupId}`);
  if (back === "people") redirect(`/groups/${groupId}/people?${q}`);
  redirect(`/groups/${groupId}?tab=${back === "balances" ? "balances" : "activity"}&${q}`);
}

// Looks up today's exchange rate when a currency is picked (not on every keystroke).
export async function lookupRate(from: string, to: string): Promise<RateAnswer> {
  if (!isSupportedCurrency(from) || !isSupportedCurrency(to)) {
    return { ok: false, reason: "unsupported", message: "That currency isn't supported. Enter the rate yourself." };
  }
  return getRate(from, to);
}

// Group settings: name, currency and foreign card markup. Every change is logged for everyone.
export async function updateGroupSettings(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: { select: { id: true } }, _count: { select: { expenses: true, payments: true } } },
  });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

  const back = `/groups/${group.id}/settings`;

  // Markup: "0" | "200" | "300" | "400" | "custom" (+ customMarkup like "3.5")
  const choice = String(formData.get("markup") ?? "0");
  let markupBp: number | null;
  if (choice === "custom") {
    markupBp = parsePercent(String(formData.get("customMarkup") ?? ""));
  } else {
    markupBp = ["0", "200", "300", "400"].includes(choice) ? Number(choice) : null;
  }
  if (markupBp === null || markupBp > 2000) redirect(`${back}?error=markup`);

  const name = String(formData.get("name") ?? group.name);
  const secondaryCurrency = String(formData.get("secondaryCurrency") ?? group.secondaryCurrency);
  const basics = await updateGroupBasics(group.id, myId, { name, markupBp, secondaryCurrency });
  if (!basics.ok) redirect(`${back}?error=name`);
  const did = basics.eventId ? `&did=${basics.eventId}` : "";

  const currency = String(formData.get("currency") ?? group.currency);
  if (currency !== group.currency) {
    if (!isSupportedCurrency(currency)) redirect(`${back}?error=currency`);
    // With money already in the group, confirm the conversion rate first.
    if (group._count.expenses + group._count.payments > 0) redirect(`${back}?convert=${currency}`);
    const c = await changeGroupCurrency(group.id, myId, currency, "1");
    if (c.ok && c.eventId) redirect(`/groups/${group.id}?saved=settings&did=${c.eventId}`);
  }
  redirect(`/groups/${group.id}?saved=settings${did}`);
}

// Second step of changing the currency: convert everything at the confirmed rate.
export async function convertGroupCurrency(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const currency = String(formData.get("currency") ?? "");
  const rate = String(formData.get("rate") ?? "").replace(/[,\s]/g, "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);
  const r = await changeGroupCurrency(group.id, myId, currency, rate);
  if (!r.ok) redirect(`/groups/${group.id}/settings?convert=${currency}&error=${encodeURIComponent(r.error)}`);
  redirect(`/groups/${group.id}?saved=settings${r.eventId ? `&did=${r.eventId}` : ""}`);
}

// Records that one person paid another back (from Smart Settle's "Mark as paid").
// This is only a record — the app never moves real money.
export async function recordPayment(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const fromId = String(formData.get("fromId") ?? "");
  const toId = String(formData.get("toId") ?? "");
  const amount = Number(formData.get("amount") ?? 0);

  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group) redirect("/");
  const ids = group.members.map((m) => m.id);
  const myId = await getMyMemberId(group.id);
  if (!myId || !ids.includes(myId)) redirect(`/join/${group.inviteCode}`);
  if (!ids.includes(fromId) || !ids.includes(toId) || fromId === toId) redirect(`/groups/${group.id}?tab=balances`);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2_000_000_000) redirect(`/groups/${group.id}?tab=balances`);

  const names = await db.member.findMany({ where: { id: { in: [fromId, toId] } }, select: { id: true, name: true } });
  const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? "Someone";
  const did = await db.$transaction(async (tx) => {
    const p = await tx.payment.create({ data: { groupId: group.id, fromId, toId, amount, createdById: myId } });
    return logEvent(tx, {
      groupId: group.id,
      actorId: myId,
      kind: "payment_recorded",
      text: `recorded ${nameOf(fromId)} paid ${nameOf(toId)} ${formatMoney(amount, group.currency)}`,
      paymentId: p.id,
      undo: { type: "payment_delete", paymentId: p.id },
    });
  });
  redirect(`/groups/${group.id}?tab=balances&paid=1&did=${did}`);
}

// Close a group (hide it from the main list, stop new expenses) or reopen it.
export async function setGroupClosed(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const closed = formData.get("closed") === "1";
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

  let did = "";
  if (group.closed !== closed) {
    did = await db.$transaction(async (tx) => {
      await tx.group.update({ where: { id: group.id }, data: { closed, closedAt: closed ? new Date() : null } });
      return logEvent(tx, {
        groupId: group.id,
        actorId: myId,
        kind: closed ? "group_closed" : "group_reopened",
        text: closed ? "closed the group" : "reopened the group",
        undo: { type: "group_set", data: { closed: group.closed, closedAt: group.closedAt ? group.closedAt.toISOString() : null } },
      });
    });
  }
  redirect(closed ? `/?closed=1${did ? `&did=${did}&g=${group.id}` : ""}` : `/groups/${group.id}${did ? `?did=${did}` : ""}`);
}

// Smart Settle across groups: records each group's part of a combined settle-up.
// Every part is re-checked against that group's current Smart Settle first.
export async function settleAcrossGroups(formData: FormData) {
  let parts: { groupId: string; fromId: string; toId: string; amount: number }[] = [];
  try {
    const raw = JSON.parse(String(formData.get("parts") ?? "[]"));
    if (Array.isArray(raw)) parts = raw;
  } catch {
    redirect("/?settle=error#settle");
  }
  const { loadGroup } = await import("@/lib/group-data");
  const memberships = await getMemberships();
  const checked: { groupId: string; fromId: string; toId: string; amount: number; currency: string; names: Map<string, string> }[] = [];

  for (const p of parts) {
    const myId = memberships[String(p.groupId)];
    const data = myId ? await loadGroup(String(p.groupId)) : null;
    if (!data || !myId) redirect("/?settle=error#settle");
    const ok = data.transfers.some((t) => t.from === p.fromId && t.to === p.toId && t.amount === p.amount) && (p.fromId === myId || p.toId === myId);
    if (!ok) redirect("/?settle=changed#settle"); // balances moved since the page loaded
    checked.push({ ...p, currency: data.group.currency, names: new Map(data.group.members.map((m) => [m.id, m.name])) });
  }

  await db.$transaction(async (tx) => {
    for (const c of checked) {
      const myId = memberships[c.groupId];
      const pay = await tx.payment.create({ data: { groupId: c.groupId, fromId: c.fromId, toId: c.toId, amount: c.amount, createdById: myId } });
      await logEvent(tx, {
        groupId: c.groupId,
        actorId: myId,
        undo: { type: "payment_delete", paymentId: pay.id },
        kind: "payment_recorded",
        text: `recorded ${c.names.get(c.fromId) ?? "Someone"} paid ${c.names.get(c.toId) ?? "Someone"} ${formatMoney(c.amount, c.currency)} (Smart Settle across groups)`,
        paymentId: pay.id,
      });
    }
  });
  redirect("/?settle=done#settle");
}

// "Record a payment": any amount (full or part) between any two people in the group.
export async function recordCustomPayment(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const fromId = String(formData.get("fromId") ?? "");
  const toId = String(formData.get("toId") ?? "");
  const amountText = String(formData.get("amount") ?? "");

  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true, name: true } } } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);

  const back = (error: string) =>
    redirect(`/groups/${group.id}/pay?${new URLSearchParams({ from: fromId, to: toId, amount: amountText, error })}`);
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name;
  if (!nameOf(fromId) || !nameOf(toId)) back("Pick who paid and who they paid.");
  if (fromId === toId) back("Pick two different people.");
  const amount = parseAmount(amountText, group.currency);
  if (amount === null) back("Enter a valid amount, like 500 or 99.50.");

  const did = await db.$transaction(async (tx) => {
    const p = await tx.payment.create({ data: { groupId: group.id, fromId, toId, amount: amount!, createdById: myId } });
    return logEvent(tx, {
      groupId: group.id,
      actorId: myId,
      kind: "payment_recorded",
      text: `recorded ${nameOf(fromId)} paid ${nameOf(toId)} ${formatMoney(amount!, group.currency)}`,
      paymentId: p.id,
      undo: { type: "payment_delete", paymentId: p.id },
    });
  });
  redirect(`/groups/${group.id}?tab=balances&paid=1&did=${did}`);
}

// People screen: rename, remove (never used), leave / rejoin.
async function peopleContext(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);
  return { groupId, memberId, myId };
}

function backToPeople(groupId: string, r: { ok: true; eventId?: string } | { ok: false; error: string }): never {
  const q = r.ok ? (r.eventId ? `did=${r.eventId}` : "") : `error=${encodeURIComponent(r.error)}`;
  redirect(`/groups/${groupId}/people${q ? `?${q}` : ""}`);
}

export async function renamePerson(formData: FormData) {
  const { groupId, memberId, myId } = await peopleContext(formData);
  backToPeople(groupId, await renameMember(groupId, myId, memberId, String(formData.get("name") ?? "")));
}

export async function removePerson(formData: FormData) {
  const { groupId, memberId, myId } = await peopleContext(formData);
  if (await isMemberUsed(memberId)) backToPeople(groupId, { ok: false, error: "They’re already part of expenses or payments. They can leave instead, once settled up." });
  backToPeople(groupId, await removeMembers(groupId, myId, [memberId], false));
}

export async function setPersonLeft(formData: FormData) {
  const { groupId, memberId, myId } = await peopleContext(formData);
  backToPeople(groupId, await setMemberLeft(groupId, myId, memberId, formData.get("left") === "1"));
}

// "We settled outside the app": record every Smart Settle payment and close the group.
export async function settleEverything(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) redirect(`/join/${group.inviteCode}`);
  const r = await settleAllAndClose(group.id, myId, String(formData.get("plan") ?? ""));
  if (!r.ok) redirect(`/groups/${group.id}?tab=balances&error=${encodeURIComponent(r.error)}`);
  redirect(`/?closed=1&did=${r.eventId}&g=${group.id}`);
}
