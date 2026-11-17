import { db } from "../db";
import { getRate } from "../rate-cache";
import { saveExpense } from "../save-expense";
import { claimOnce, sendPushTo } from "../push";
import { CLOSED_LIST_ERROR } from "../active";
import { splitFields } from "./bills-db";

// The shopping list, database side.

const GONE_LIST_ERROR = "This group no longer exists.";

type Result = { ok: true; id: string } | { ok: false; error: string };

async function memberOf(groupId: string, actorId: string) {
  const m = await db.member.findFirst({ where: { id: actorId, groupId, leftAt: null }, select: { id: true, name: true, group: { select: { closed: true, deletedAt: true } } } });
  return m ? { id: m.id, name: m.name, closed: m.group.closed, deleted: Boolean(m.group.deletedAt) } : null;
}

export async function addListItem(groupId: string, actorId: string, text: string): Promise<Result> {
  if ((await db.group.findUnique({ where: { id: groupId }, select: { type: true } }))?.type === "direct") return { ok: false, error: "This is just between two people, so it has none of these extras." };
  const who = await memberOf(groupId, actorId);
  if (!who) return { ok: false, error: "Only people in this group can use its list." };
  if (who.deleted) return { ok: false, error: GONE_LIST_ERROR };
  if (who.closed) return { ok: false, error: CLOSED_LIST_ERROR };
  const t = text.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!t) return { ok: false, error: "Type what to buy." };
  if ((await db.listItem.count({ where: { groupId, expenseId: "" } })) >= 100) return { ok: false, error: "The list is full. Clear some items first." };
  const item = await db.listItem.create({ data: { groupId, text: t, addedById: actorId } });
  return { ok: true, id: item.id };
}

// Tick (I bought it) or untick. Others' ticks can be undone by anyone.
export async function toggleListItem(groupId: string, actorId: string, itemId: string): Promise<Result> {
  const who = await memberOf(groupId, actorId);
  if (!who) return { ok: false, error: "Only people in this group can use its list." };
  if (who.deleted) return { ok: false, error: GONE_LIST_ERROR };
  if (who.closed) return { ok: false, error: CLOSED_LIST_ERROR };
  const item = await db.listItem.findFirst({ where: { id: itemId, groupId, expenseId: "" } });
  if (!item) return { ok: false, error: "That item is gone." };
  await db.listItem.update({ where: { id: item.id }, data: item.boughtAt ? { boughtAt: null, boughtById: "" } : { boughtAt: new Date(), boughtById: actorId } });
  return { ok: true, id: item.id };
}

export async function removeListItem(groupId: string, actorId: string, itemId: string): Promise<Result> {
  const who = await memberOf(groupId, actorId);
  if (!who) return { ok: false, error: "Only people in this group can use its list." };
  if (who.deleted) return { ok: false, error: GONE_LIST_ERROR };
  if (who.closed) return { ok: false, error: CLOSED_LIST_ERROR };
  await db.listItem.deleteMany({ where: { id: itemId, groupId, expenseId: "" } });
  return { ok: true, id: itemId };
}

export const LIST_CHANGED = "These items were just added as an expense by someone else. Check the list.";
class ListChanged extends Error {}

// What I ticked becomes one Groceries expense, paid by me, shared the group's way.
// The expense, its request key and the link from each item to it are written in ONE transaction: if any item was
// already taken by another purchase, nothing is saved. `afterRead` is for tests only (runs before the write begins).
export async function buyListItems(groupId: string, actorId: string, amountText: string, requestKey: string, opts: { afterRead?: () => Promise<void> } = {}): Promise<Result> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, leftAt: true, splitWeight: true } } },
  });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can use its list." };
  if (group.closed) return { ok: false, error: CLOSED_LIST_ERROR };
  // A repeat of the same tap: it already happened (the key and the links are written together, so a used key means linked items).
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
    {
      requestKey,
      afterRead: opts.afterRead,
      alsoInTx: async (tx, expenseId) => {
        const linked = await tx.listItem.updateMany({ where: { id: { in: items.map((i) => i.id) }, expenseId: "", boughtById: actorId, boughtAt: { not: null } }, data: { expenseId } });
        if (linked.count !== items.length) throw new ListChanged();
      },
    },
  ).catch((err) => {
    if (err instanceof ListChanged) return { ok: false as const, error: LIST_CHANGED };
    throw err;
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, id: r.id };
}

// "Going shopping?": tell the others, at most once an hour per person.
export async function goingShopping(groupId: string, actorId: string): Promise<Result> {
  const me = await memberOf(groupId, actorId);
  if (!me) return { ok: false, error: "Only people in this group can use its list." };
  if (me.deleted) return { ok: false, error: GONE_LIST_ERROR };
  if (me.closed) return { ok: false, error: CLOSED_LIST_ERROR };
  const hour = new Date().toISOString().slice(0, 13);
  if (!(await claimOnce(`shopping:${actorId}:${hour}`))) return { ok: true, id: "" };
  const group = await db.group.findUnique({ where: { id: groupId }, select: { name: true, members: { where: { leftAt: null }, select: { id: true } } } });
  const others = (group?.members ?? []).map((m) => m.id).filter((id) => id !== actorId);
  await sendPushTo(others, { title: `🛒 ${group?.name ?? "Loopin"}`, body: `${me.name} is going shopping. Add anything you need to the list.`, url: `/groups/${groupId}?tab=list`, tag: `shopping-${groupId}` }, "groups.shopping", actorId);
  return { ok: true, id: "" };
}
