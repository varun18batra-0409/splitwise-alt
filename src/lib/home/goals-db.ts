import { db } from "../db";
import { logEvent } from "../events";
import { formatMoney, parseAmount } from "../money";
import { GroupChanged, groupChangedText, guardGroup } from "../money-guard";
import { claimKey, fingerprintOf, isDuplicateKey, keyState, STALE_KEY_ERROR } from "../once";

type Result = { ok: true; id: string } | { ok: false; error: string };

async function member(groupId: string, actorId: string) {
  return db.member.findFirst({ where: { id: actorId, groupId, leftAt: null } });
}

// Start (or change) a goal.
export async function saveGoalFor(groupId: string, actorId: string, input: { goalId?: string; name: string; target: string; byDate: string }): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!(await member(groupId, actorId))) return { ok: false, error: "Only people in this group can do this." };
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) return { ok: false, error: "Give the goal a name, like “Bali in March”." };
  const target = parseAmount(input.target, group.currency);
  if (target === null || target <= 0) return { ok: false, error: "Enter how much you want to save, like 200000." };
  const byDate = /^\d{4}-\d{2}-\d{2}$/.test(input.byDate) ? input.byDate : "";
  if (input.goalId) {
    const g = await db.goal.findFirst({ where: { id: input.goalId, groupId, deletedAt: null } });
    if (!g) return { ok: false, error: "That goal no longer exists." };
    try {
      await db.$transaction(async (tx) => {
        await guardGroup(tx, groupId, { currency: group.currency, actorId, allowClosed: true });
        await tx.goal.update({ where: { id: g.id }, data: { name, target, byDate } });
        await logEvent(tx, { groupId, actorId, kind: "bill_changed", text: `changed the goal ${name} (${formatMoney(target, group.currency)})` });
      });
    } catch (err) {
      if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
      throw err;
    }
    return { ok: true, id: g.id };
  }
  let g;
  try {
  g = await db.$transaction(async (tx) => {
    // The target was typed in the group's currency as read: still the same one?
    await guardGroup(tx, groupId, { currency: group.currency, actorId, allowClosed: true });
    const created = await tx.goal.create({ data: { groupId, name, target, byDate, createdById: actorId } });
    await logEvent(tx, { groupId, actorId, kind: "bill_changed", text: `started a goal: ${name} (${formatMoney(target, group.currency)})` });
    return created;
  });
  } catch (err) {
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    throw err;
  }
  return { ok: true, id: g.id };
}

// Without a key (an empty one counts as none), the same person setting aside the same amount for the same
// goal within this many seconds is taken for a double tap.
export const GOAL_TAP_SECONDS = 10;

// The stand-in key for a tap that came without one.
export function tapKey(memberId: string, goalId: string, amount: number, now = Date.now()): string {
  return `goal-${fingerprintOf("goal-tap", memberId, goalId, amount, Math.floor(now / (GOAL_TAP_SECONDS * 1000)))}`;
}

// "I set money aside": counted once per tap; reaching the target is noted once.
export async function addGoalEntryFor(groupId: string, actorId: string, goalId: string, amountText: string, requestKey?: string): Promise<Result> {
  const fp = fingerprintOf("goal-entry", groupId, goalId, amountText.trim());
  const ks = await keyState(requestKey || undefined, fp);
  if (ks.state === "stale") return { ok: false, error: STALE_KEY_ERROR };
  if (ks.state === "done") return { ok: true, id: goalId };
  const goal = await db.goal.findFirst({ where: { id: goalId, groupId, deletedAt: null }, include: { group: true } });
  if (!goal) return { ok: false, error: "That goal no longer exists." };
  const me = await member(groupId, actorId);
  if (!me) return { ok: false, error: "Only people in this group can do this." };
  const amount = parseAmount(amountText, goal.group.currency);
  if (amount === null || amount === 0) return { ok: false, error: "Enter the amount you set aside." };
  try {
    await db.$transaction(async (tx) => {
      // The amount was typed in the group's currency as read: still the same one?
      await guardGroup(tx, groupId, { currency: goal.group.currency, actorId, allowClosed: true });
      // No key from the screen: a key worked out from who, which goal, how much and the current 10 seconds, so two taps
      // racing each other can only save once (the second one finds the key already taken).
      await claimKey(tx, requestKey || tapKey(actorId, goal.id, amount), goal.id, requestKey ? fp : "");
      if (!requestKey && (await tx.goalEntry.count({ where: { goalId: goal.id, memberId: actorId, amount, createdAt: { gt: new Date(Date.now() - GOAL_TAP_SECONDS * 1000) } } })) > 0) return; // a double tap without a key: kept once, answered the same
      await tx.goalEntry.create({ data: { goalId: goal.id, memberId: actorId, amount } });
      const saved = (await tx.goalEntry.aggregate({ where: { goalId: goal.id }, _sum: { amount: true } }))._sum.amount ?? 0;
      const money = (n: number) => formatMoney(n, goal.group.currency);
      // Reached for the first time: one celebration, never repeated.
      const reached = saved >= goal.target && (await tx.goal.updateMany({ where: { id: goal.id, reachedAt: null }, data: { reachedAt: new Date() } })).count === 1;
      await logEvent(tx, {
        groupId,
        actorId,
        kind: "bill_changed",
        text: reached ? `reached the goal ${goal.name} 🎉 (${money(saved)})` : `set aside ${money(amount)} for ${goal.name}`,
      });
    });
  } catch (err) {
    if (isDuplicateKey(err)) return { ok: true, id: goalId };
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    throw err;
  }
  return { ok: true, id: goal.id };
}

export async function deleteGoalFor(groupId: string, actorId: string, goalId: string): Promise<Result> {
  if (!(await member(groupId, actorId))) return { ok: false, error: "Only people in this group can do this." };
  const g = await db.goal.findFirst({ where: { id: goalId, groupId, deletedAt: null } });
  if (!g) return { ok: false, error: "That goal no longer exists." };
  const group = await db.group.findUnique({ where: { id: groupId }, select: { currency: true } });
  try {
    await db.$transaction(async (tx) => {
      await guardGroup(tx, groupId, { currency: group?.currency ?? "INR", actorId, allowClosed: true });
      await tx.goal.update({ where: { id: g.id }, data: { deletedAt: new Date() } });
      await logEvent(tx, { groupId, actorId, kind: "bill_changed", text: `removed the goal ${g.name}` });
    });
  } catch (err) {
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    throw err;
  }
  return { ok: true, id: g.id };
}
