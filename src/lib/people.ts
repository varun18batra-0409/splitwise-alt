import { db } from "./db";
import { LEFT_ERROR } from "./active";
import { netBalances } from "./balances";
import { logEvent } from "./events";
import { cleanNames, sameName } from "./names";
import { formatMoney } from "./money";
import { isGroupAdmin, pickAdmin } from "./group-admin";

// Renaming people and leaving / rejoining a group. Every change is logged,
// notifies the others, and can be undone.
//
// - Rename: any member can fix anyone's name (no two people with the same name).
// - Leave: only with a zero balance. They stay in the history and balances,
//   but aren't offered when adding new expenses or payments.
// - Rejoin: brings them back.
// - Removed: when someone else (the admin) takes a person out, it is "removed", not
//   "left": removedAt is set, they can't rejoin on their own or with the link, and
//   only the admin can bring them back. Undoing the removal clears it.

type Result = { ok: true; eventId?: string } | { ok: false; error: string };

export async function renameMember(groupId: string, actorId: string, memberId: string, rawName: string): Promise<Result> {
  const name = cleanNames([rawName])[0];
  if (!name) return { ok: false, error: "Type a name." };
  return setMember(groupId, actorId, memberId, { name });
}

export async function setMemberLeft(groupId: string, actorId: string, memberId: string, left: boolean): Promise<Result> {
  return setMember(groupId, actorId, memberId, { leftAt: left ? new Date().toISOString() : null });
}

// Shared by the actions above and by undo/redo.
export async function setMember(
  groupId: string,
  actorId: string,
  memberId: string,
  data: { name?: string; leftAt?: string | null; removedAt?: string | null; removedById?: string },
  undoing = false,
): Promise<Result> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } },
  });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change it." };
  // Someone who left can only rejoin themselves (undo checks the person undoing).
  const rejoiningSelf = memberId === actorId && data.leftAt === null && data.name === undefined;
  if (!undoing && !rejoiningSelf && group.members.find((x) => x.id === actorId)?.leftAt) return { ok: false, error: LEFT_ERROR };
  const m = group.members.find((x) => x.id === memberId);
  if (!m) return { ok: false, error: "That person is no longer in the group." };
  const who = memberId === actorId ? "themselves" : m.name;
  const tag = undoing ? " (undo)" : "";

  if (data.name !== undefined) {
    const name = data.name;
    if (name === m.name) return { ok: true };
    const clash = group.members.find((x) => x.id !== memberId && sameName(x.name, name));
    if (clash) return { ok: false, error: `Someone called ${clash.name} is already in the group.` };
    const eventId = await db.$transaction(async (tx) => {
      await tx.member.update({ where: { id: memberId }, data: { name } });
      return logEvent(tx, {
        groupId,
        actorId,
        kind: "member_renamed",
        text: `renamed ${m.name} to ${name}${tag}`,
        undo: { type: "member_set", memberId, data: { name: m.name } },
      });
    });
    return { ok: true, eventId };
  }

  if (data.leftAt !== undefined) {
    const leaving = data.leftAt !== null;
    const alreadyLeft = m.leftAt !== null;
    // Someone who left on their own, now taken out by the person who looks after the group: "left" becomes "removed".
    const promoting = leaving && alreadyLeft && !m.removedAt && memberId !== actorId && !undoing && data.removedAt === undefined;
    if (promoting && !(await isGroupAdmin(groupId, actorId))) return { ok: false, error: "Only the person who looks after this group can remove people." };
    // Removed state after this change: removing sets it, bringing back clears it (even if leftAt was somehow already empty), otherwise unchanged.
    const wantRemoved = promoting ? true : data.removedAt !== undefined ? Boolean(data.removedAt) : !leaving ? false : m.removedAt !== null;
    if (leaving === alreadyLeft && wantRemoved === (m.removedAt !== null)) return { ok: true };
    if (!leaving && m.removedAt && !undoing) {
      // Removed by the admin: they can't come back on their own, and only the admin can bring them back.
      if (memberId === actorId) {
        const by = group.members.find((x) => x.id === m.removedById)?.name ?? pickAdmin(group.members)?.name ?? "The person who looks after the group";
        return { ok: false, error: `${by} removed you from this group. Ask them to invite you again.` };
      }
      if (!(await isGroupAdmin(groupId, actorId))) return { ok: false, error: "Only the person who looks after this group can bring back someone they removed." };
    }
    if (leaving && !alreadyLeft) {
      const net = netBalances(group.members.map((x) => x.id), group.expenses, group.payments)[memberId] ?? 0;
      if (net !== 0) {
        const amount = formatMoney(Math.abs(net), group.currency);
        const subject = memberId === actorId ? "You" : m.name;
        const verb = memberId === actorId ? (net > 0 ? "are owed" : "owe") : net > 0 ? "is owed" : "owes";
        return { ok: false, error: `${subject} still ${verb} ${amount}. Settle up first, then leave.` };
      }
    }
    // Someone else taking a person out is a removal (an undo spells it out in its data instead).
    const removing = (leaving && !alreadyLeft && memberId !== actorId && !undoing && data.removedAt === undefined) || promoting;
    const removal: { removedAt?: Date | null; removedById?: string } = removing
      ? { removedAt: new Date(), removedById: actorId }
      : data.removedAt !== undefined
        ? { removedAt: data.removedAt ? new Date(data.removedAt) : null, removedById: data.removedAt ? data.removedById ?? "" : "" }
        : !leaving && m.removedAt
          ? { removedAt: null, removedById: "" }
          : {};
    // Taking out someone who had already left keeps the day they left.
    const leftAtNext = leaving ? (promoting ? m.leftAt! : new Date(data.leftAt!)) : null;
    const eventId = await db.$transaction(async (tx) => {
      await tx.member.update({ where: { id: memberId }, data: { leftAt: leftAtNext, ...removal } });
      return logEvent(tx, {
        groupId,
        actorId,
        kind: leaving ? "member_left" : "member_rejoined",
        text: leaving
          ? memberId === actorId ? `left the group${tag}` : removal.removedAt ? `removed ${who} from the group${tag}` : `marked ${who} as left${tag}`
          : memberId === actorId ? `rejoined the group${tag}` : `brought ${who} back into the group${tag}`,
        undo: {
          type: "member_set",
          memberId,
          data: leaving
            ? removal.removedAt
              ? { leftAt: alreadyLeft ? m.leftAt!.toISOString() : null, removedAt: null, removedById: "" }
              : m.removedAt
                ? // Undoing a removal back to "left": redoing it must remove them again, not bring them back.
                  { leftAt: (m.leftAt ?? m.removedAt).toISOString(), removedAt: m.removedAt.toISOString(), removedById: m.removedById }
                : { leftAt: null }
            : m.removedAt
              ? { leftAt: (m.leftAt ?? m.removedAt).toISOString(), removedAt: m.removedAt.toISOString(), removedById: m.removedById }
              : { leftAt: m.leftAt!.toISOString() },
        },
      });
    });
    return { ok: true, eventId };
  }
  return { ok: true };
}

// The People screen's three lists. Everyone is in exactly one: in the group, left on their own, or removed by the
// admin (a removed person is listed only under Removed, whatever their "left" mark says).
export function groupPeople<T extends { leftAt: Date | null; removedAt: Date | null }>(members: T[]): { active: T[]; left: T[]; removed: T[] } {
  return {
    active: members.filter((m) => !m.leftAt && !m.removedAt),
    left: members.filter((m) => m.leftAt && !m.removedAt),
    removed: members.filter((m) => m.removedAt),
  };
}

// True once someone is part of any expense or payment (so they can only leave, not be removed).
export async function isMemberUsed(memberId: string): Promise<boolean> {
  const groupId = (await db.member.findUnique({ where: { id: memberId }, select: { groupId: true } }))?.groupId;
  if (!groupId) return false;
  const used =
    (await db.expenseShare.count({ where: { memberId } })) +
    (await db.expense.count({ where: { groupId, OR: [{ paidById: memberId }, { createdById: memberId }, { payers: { contains: memberId } }] } })) +
    (await db.payment.count({ where: { OR: [{ fromId: memberId }, { toId: memberId }] } }));
  return used > 0;
}
