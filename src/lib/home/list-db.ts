import { db } from "../db";
import { getRate } from "../rate-cache";
import { saveExpense } from "../save-expense";
import { claimOnce, sendPushTo } from "../push";
import { splitFields } from "./bills-db";

// The shopping list, database side.

type Result = { ok: true; id: string } | { ok: false; error: string };

async function memberOf(groupId: string, actorId: string) {
  return db.member.findFirst({ where: { id: actorId, groupId, leftAt: null }, select: { id: true, name: true } });
}

export async function addListItem(groupId: string, actorId: string, text: string): Promise<Result> {
  if (!(await memberOf(groupId, actorId))) return { ok: false, error: "Only people in this group can use its list." };
  const t = text.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!t) return { ok: false, error: "Type what to buy." };
  if ((await db.listItem.count({ where: { groupId, expenseId: "" } })) >= 100) return { ok: false, error: "The list is full. Clear some items first." };
  const item = await db.listItem.create({ data: { groupId, text: t, addedById: actorId } });
  return { ok: true, id: item.id };
}

// Tick (I bought it) or untick. Others' ticks can be undone by anyone.
export async function toggleListItem(groupId: string, actorId: string, itemId: string): Promise<Result> {
  if (!(await memberOf(groupId, actorId))) return { ok: false, error: "Only people in this group can use its list." };
  const item = await db.listItem.findFirst({ where: { id: itemId, groupId, expenseId: "" } });
  if (!item) return { ok: false, error: "That item is gone." };
  await db.listItem.update({ where: { id: item.id }, data: item.boughtAt ? { boughtAt: null, boughtById: "" } : { boughtAt: new Date(), boughtById: actorId } });
  return { ok: true, id: item.id };
}

export async function removeListItem(groupId: string, actorId: string, itemId: string): Promise<Result> {
  if (!(await memberOf(groupId, actorId))) return { ok: false, error: "Only people in this group can use its list." };
  await db.listItem.deleteMany({ where: { id: itemId, groupId, expenseId: "" } });
  return { ok: true, id: itemId };
}

// What I ticked becomes one Groceries expense, paid by me, shared the group's way.
export async function buyListItems(groupId: string, actorId: string, amountText: string, requestKey: string): Promise<Result> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, splitWeight: true } } },
  });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can use its list." };
  // A repeat of the same tap: it already happened.
  const done = await db.requestKey.findUnique({ where: { key: requestKey } });
  if (done) return { ok: true, id: done.result };
  const items = await db.listItem.findMany({ where: { groupId, boughtById: actorId, expenseId: "", boughtAt: { not: null } }, orderBy: { boughtAt: "asc" } });
  if (!items.length) return { ok: false, error: "Tick what you bought first." };
  const r = await saveExpense(
    {
      groupId: group.id,
      name: "Groceries",
      category: "groceries",
      amount: amountText,
      currency: group.currency,
      paidById: actorId,
      ...splitFields(JSON.stringify({ mode: "group" }), group.members),
      onePersonId: "",
      exact: {},
      percent: {},
      paymentMethod: "cash",
      markupChoice: "group",
      markupCustom: "",
      rateMode: "auto",
      manualRate: "",
      notes: items.map((i) => i.text).join(", ").slice(0, 300),
    },
    actorId,
    getRate,
    { requestKey },
  );
  if (!r.ok) return { ok: false, error: r.error };
  await db.listItem.updateMany({ where: { id: { in: items.map((i) => i.id) }, expenseId: "" }, data: { expenseId: r.id } });
  return { ok: true, id: r.id };
}

// "Going shopping?": tell the others, at most once an hour per person.
export async function goingShopping(groupId: string, actorId: string): Promise<Result> {
  const me = await memberOf(groupId, actorId);
  if (!me) return { ok: false, error: "Only people in this group can use its list." };
  const hour = new Date().toISOString().slice(0, 13);
  if (!(await claimOnce(`shopping:${actorId}:${hour}`))) return { ok: true, id: "" };
  const group = await db.group.findUnique({ where: { id: groupId }, select: { name: true, members: { where: { leftAt: null }, select: { id: true } } } });
  const others = (group?.members ?? []).map((m) => m.id).filter((id) => id !== actorId);
  await sendPushTo(others, { title: `🛒 ${group?.name ?? "Loopin"}`, body: `${me.name} is going shopping. Add anything you need to the list.`, url: `/groups/${groupId}?tab=list`, tag: `shopping-${groupId}` });
  return { ok: true, id: "" };
}
