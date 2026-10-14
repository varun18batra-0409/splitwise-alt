"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId, setMyMemberId } from "@/lib/identity";
import { cleanNames, cleanPeople, sameName } from "@/lib/names";
import { isSupportedCurrency, parsePercent } from "@/lib/money";
import { getRate, type RateAnswer } from "@/lib/rate-cache";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";

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
  if (people.length > 0) {
    await db.member.createMany({ data: people.map((p) => ({ ...p, groupId: group.id })) });
  }
  const q = new URLSearchParams({ added: String(people.length) });
  if (skipped.length) q.set("skipped", skipped.join(", "));
  redirect(`/groups/${group.id}?${q}#people`);
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
  await setMyMemberId(group.id, member.id);
  redirect(`/groups/${group.id}`);
}

// Saves a new expense, then goes back to the group page.
export async function addExpense(input: SaveExpenseInput): Promise<{ error: string }> {
  const result = await saveExpense(input, await getMyMemberId(input.groupId), getRate);
  if (!result.ok) return { error: result.error };
  redirect(`/groups/${input.groupId}`);
}

// Looks up today's exchange rate when a currency is picked (not on every keystroke).
export async function lookupRate(from: string, to: string): Promise<RateAnswer> {
  if (!isSupportedCurrency(from) || !isSupportedCurrency(to)) {
    return { ok: false, reason: "unsupported", message: "That currency isn't supported. Enter the rate yourself." };
  }
  return getRate(from, to);
}

// Group settings: base currency and foreign card markup.
export async function updateGroupSettings(formData: FormData) {
  const groupId = String(formData.get("groupId") ?? "");
  const group = await db.group.findUnique({ where: { id: groupId }, include: { _count: { select: { expenses: true } } } });
  if (!group) redirect("/");
  const myId = await getMyMemberId(group.id);
  if (!myId) redirect(`/join/${group.inviteCode}`);

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

  // Base currency can only change while the group has no expenses,
  // so saved amounts never silently change meaning.
  const currency = String(formData.get("currency") ?? group.currency);
  if (currency !== group.currency) {
    if (!isSupportedCurrency(currency)) redirect(`${back}?error=currency`);
    if (group._count.expenses > 0) redirect(`${back}?error=locked`);
  }

  await db.group.update({ where: { id: group.id }, data: { currency, cardMarkupBp: markupBp } });
  redirect(`/groups/${group.id}?saved=settings`);
}
