"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId, setMyMemberId } from "@/lib/identity";
import { cleanNames, sameName } from "@/lib/names";
import { computeSplit, type SplitType } from "@/lib/split";
import { guessCategory, isCategory } from "@/lib/categories";

function newInviteCode() {
  return randomBytes(6).toString("base64url"); // 8 characters, hard to guess
}

export async function createGroup(formData: FormData) {
  const groupName = String(formData.get("groupName") ?? "").trim().slice(0, 60);
  const yourName = cleanNames([String(formData.get("yourName") ?? "")])[0];
  if (!groupName || !yourName) redirect("/groups/new?error=missing");

  const others = cleanNames(formData.getAll("member").map(String)).filter(
    (n) => !sameName(n, yourName),
  );

  const group = await db.group.create({
    data: {
      name: groupName,
      inviteCode: newInviteCode(),
      members: { create: [{ name: yourName }, ...others.map((name) => ({ name }))] },
    },
    include: { members: true },
  });

  const me = group.members.find((m) => m.name === yourName)!;
  await setMyMemberId(group.id, me.id);
  redirect(`/groups/${group.id}`);
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

export type ExpenseInput = {
  groupId: string;
  amount: string; // as typed, e.g. "250.50"
  description: string;
  category: string; // "" = guess from the description
  paidById: string;
  splitType: SplitType;
  participants: string[];
  exact: Record<string, string>;
  percent: Record<string, string>;
};

// Saves a new expense. Re-checks everything here on the server, so a
// mistake on the phone can never store numbers that don't add up.
export async function addExpense(input: ExpenseInput): Promise<{ error: string }> {
  const group = await db.group.findUnique({
    where: { id: input.groupId },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  if (!group) return { error: "This group no longer exists." };

  const myId = await getMyMemberId(group.id);
  const memberIds = group.members.map((m) => m.id);
  if (!myId || !memberIds.includes(myId)) return { error: "Please join this group first." };
  if (!memberIds.includes(input.paidById)) return { error: "Pick who paid." };
  if (!["equal", "exact", "percent"].includes(input.splitType)) return { error: "Pick how to split." };

  const result = computeSplit({ ...input, memberIds, currency: group.currency });
  if (!result.ok || result.total === null) return { error: result.ok ? "Enter an amount." : result.error };

  const description = input.description.trim().slice(0, 80) || "Expense";
  const category = isCategory(input.category) ? input.category : guessCategory(description);

  await db.expense.create({
    data: {
      groupId: group.id,
      description,
      category,
      amount: result.total,
      splitType: input.splitType,
      paidById: input.paidById,
      shares: { create: result.shares.map((s) => ({ memberId: s.memberId, amount: s.amount })) },
    },
  });
  redirect(`/groups/${group.id}`);
}
