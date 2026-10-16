import { randomBytes } from "node:crypto";
import { db } from "./db";
import { isSupportedCurrency } from "./money";
import { logEvent } from "./events";
import { isGroupType, parseWeight, weightsLabel, type GroupType } from "./group-types";

// Creating groups and changing how a group shares costs (database side).

export type NewGroupInput = { type: string; name: string; yourName: string; currency: string; ratio?: number };

// Makes a group with its creator as the first member.
export async function createGroupFor(account: { id: string }, input: NewGroupInput) {
  const type: GroupType = isGroupType(input.type) ? input.type : "other";
  const ratio = type === "couple" && Number.isInteger(input.ratio) && input.ratio! >= 1 && input.ratio! <= 99 ? input.ratio! : 50;
  const couple = type === "couple" && ratio !== 50;
  return db.group.create({
    data: {
      name: input.name.trim().slice(0, 60),
      type,
      currency: isSupportedCurrency(input.currency) ? input.currency : "INR",
      inviteCode: newInviteCode(),
      joinWeight: couple ? 100 - ratio : 100,
      members: { create: [{ name: input.yourName, claimedAt: new Date(), accountId: account.id, splitWeight: couple ? ratio : 100 }] },
    },
    include: { members: true },
  });
}

export function newInviteCode() {
  return randomBytes(6).toString("base64url"); // 8 characters, hard to guess
}

type Result = { ok: true; eventId?: string } | { ok: false; error: string };

// Settings → "How you share costs": the group type, plus each person's weight
// (shares like "1.2", or a couple's percent like "55").
export async function updateSharing(
  groupId: string,
  actorId: string,
  input: { type: string; weights: Record<string, string> },
): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change this." };
  const type: GroupType = isGroupType(input.type) ? input.type : (group.type as GroupType);
  const active = group.members.filter((m) => !m.leftAt);
  const next: Record<string, number> = {};
  for (const m of active) {
    const raw = input.weights[m.id];
    if (raw === undefined || raw === "") {
      next[m.id] = m.splitWeight;
      continue;
    }
    // A couple types percents (55 / 45); everyone else types shares (1.2).
    const w = type === "couple" ? (/^\d{1,2}$/.test(raw.trim()) ? Number(raw.trim()) : null) : parseWeight(raw);
    if (w === null) return { ok: false, error: type === "couple" ? "Enter a percent between 0 and 99." : "Enter shares like 1 or 1.5 (up to 20)." };
    next[m.id] = w;
  }
  if (active.length && active.every((m) => next[m.id] === 0)) return { ok: false, error: "Someone has to pay a share." };
  const changed = active.filter((m) => next[m.id] !== m.splitWeight);
  if (!changed.length && type === group.type) return { ok: true };

  const label = weightsLabel(active.map((m) => next[m.id])) || "equally";
  const eventId = await db.$transaction(async (tx) => {
    if (type !== group.type) await tx.group.update({ where: { id: group.id }, data: { type } });
    for (const m of changed) await tx.member.update({ where: { id: m.id }, data: { splitWeight: next[m.id] } });
    return logEvent(tx, {
      groupId: group.id,
      actorId,
      kind: "split_changed",
      text: `changed how costs are shared (${label})`,
      details: active.map((m) => `${m.name}: ${type === "couple" ? `${next[m.id]}%` : `${Number((next[m.id] / 100).toFixed(2))} share${next[m.id] === 100 ? "" : "s"}`}`),
    });
  });
  return { ok: true, eventId };
}
