import { db } from "../db";
import { logEvent } from "../events";
import { formatMoney, parseAmount } from "../money";
import { claimKey, isDuplicateKey, previousResult } from "../once";

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
    await db.goal.update({ where: { id: g.id }, data: { name, target, byDate } });
    await logEvent(db, { groupId, actorId, kind: "bill_changed", text: `changed the goal ${name} (${formatMoney(target, group.currency)})` });
    return { ok: true, id: g.id };
  }
  const g = await db.$transaction(async (tx) => {
    const created = await tx.goal.create({ data: { groupId, name, target, byDate, createdById: actorId } });
    await logEvent(tx, { groupId, actorId, kind: "bill_changed", text: `started a goal: ${name} (${formatMoney(target, group.currency)})` });
    return created;
  });
  return { ok: true, id: g.id };
}

// "I set money aside": counted once per tap; reaching the target is noted once.
export async function addGoalEntryFor(groupId: string, actorId: string, goalId: string, amountText: string, requestKey: string): Promise<Result> {
  if ((await previousResult(requestKey)) !== null) return { ok: true, id: goalId };
  const goal = await db.goal.findFirst({ where: { id: goalId, groupId, deletedAt: null }, include: { group: true } });
  if (!goal) return { ok: false, error: "That goal no longer exists." };
  const me = await member(groupId, actorId);
  if (!me) return { ok: false, error: "Only people in this group can do this." };
  const amount = parseAmount(amountText, goal.group.currency);
  if (amount === null || amount === 0) return { ok: false, error: "Enter the amount you set aside." };
  try {
    await db.$transaction(async (tx) => {
      await claimKey(tx, requestKey, goal.id);
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
    throw err;
  }
  return { ok: true, id: goal.id };
}

export async function deleteGoalFor(groupId: string, actorId: string, goalId: string): Promise<Result> {
  if (!(await member(groupId, actorId))) return { ok: false, error: "Only people in this group can do this." };
  const g = await db.goal.findFirst({ where: { id: goalId, groupId, deletedAt: null } });
  if (!g) return { ok: false, error: "That goal no longer exists." };
  await db.goal.update({ where: { id: g.id }, data: { deletedAt: new Date() } });
  await logEvent(db, { groupId, actorId, kind: "bill_changed", text: `removed the goal ${g.name}` });
  return { ok: true, id: g.id };
}
