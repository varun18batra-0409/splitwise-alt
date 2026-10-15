import { db } from "./db";
import { netBalances } from "./balances";
import { logEvent } from "./events";
import { cleanNames, sameName } from "./names";
import { formatMoney } from "./money";

// Renaming people and leaving / rejoining a group. Every change is logged,
// notifies the others, and can be undone.
//
// - Rename: any member can fix anyone's name (no two people with the same name).
// - Leave: only with a zero balance. They stay in the history and balances,
//   but aren't offered when adding new expenses or payments.
// - Rejoin: brings them back.

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
  data: { name?: string; leftAt?: string | null },
  undoing = false,
): Promise<Result> {
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } },
  });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change it." };
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
    if (leaving === (m.leftAt !== null)) return { ok: true };
    if (leaving) {
      const net = netBalances(group.members.map((x) => x.id), group.expenses, group.payments)[memberId] ?? 0;
      if (net !== 0) {
        const amount = formatMoney(Math.abs(net), group.currency);
        const subject = memberId === actorId ? "You" : m.name;
        const verb = memberId === actorId ? (net > 0 ? "are owed" : "owe") : net > 0 ? "is owed" : "owes";
        return { ok: false, error: `${subject} still ${verb} ${amount}. Settle up first, then leave.` };
      }
    }
    const eventId = await db.$transaction(async (tx) => {
      await tx.member.update({ where: { id: memberId }, data: { leftAt: leaving ? new Date(data.leftAt!) : null } });
      return logEvent(tx, {
        groupId,
        actorId,
        kind: leaving ? "member_left" : "member_rejoined",
        text: leaving
          ? memberId === actorId ? `left the group${tag}` : `marked ${who} as left${tag}`
          : memberId === actorId ? `rejoined the group${tag}` : `brought ${who} back into the group${tag}`,
        undo: { type: "member_set", memberId, data: { leftAt: leaving ? null : m.leftAt!.toISOString() } },
      });
    });
    return { ok: true, eventId };
  }
  return { ok: true };
}

// True once someone is part of any expense or payment (so they can only leave, not be removed).
export async function isMemberUsed(memberId: string): Promise<boolean> {
  const used =
    (await db.expenseShare.count({ where: { memberId } })) +
    (await db.expense.count({ where: { OR: [{ paidById: memberId }, { createdById: memberId }] } })) +
    (await db.payment.count({ where: { OR: [{ fromId: memberId }, { toId: memberId }] } }));
  return used > 0;
}
