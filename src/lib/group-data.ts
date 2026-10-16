import { db } from "./db";
import { netBalances } from "./balances";
import { smartSettle } from "./settle";

// Deleted expenses and payments stay in the database (and in history) but never count.
const active = <T extends { deletedAt: Date | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);

// Loads a group with everything needed for balances, Smart Settle and history.
export async function loadGroup(id: string) {
  const group = await db.group.findUnique({
    where: { id },
    include: {
      members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      expenses: { orderBy: { createdAt: "desc" }, include: { shares: true } },
      payments: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" }, take: 500 },
    },
  });
  if (!group || group.deletedAt) return null;
  const memberIds = group.members.map((m) => m.id);
  const expenses = active(group.expenses);
  const payments = active(group.payments);
  const net = netBalances(memberIds, expenses, payments);
  return { group, expenses, payments, net, transfers: smartSettle(net) };
}

// For the home screen: every group this phone belongs to, with my balance in each.
export async function loadMyGroups(memberships: Record<string, string>) {
  const groups = await db.group.findMany({
    where: { id: { in: Object.keys(memberships) }, deletedAt: null },
    include: {
      members: { select: { id: true, name: true, phone: true, leftAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      expenses: { include: { shares: true }, orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return groups
    .filter((g) => g.members.some((m) => m.id === memberships[g.id]))
    .map((g) => {
      const myId = memberships[g.id];
      const expenses = active(g.expenses);
      const payments = active(g.payments);
      const net = netBalances(g.members.map((m) => m.id), expenses, payments);
      const lastActivity = [g.expenses[0]?.createdAt, g.payments[0]?.createdAt, g.createdAt]
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const spent = expenses.reduce((s, e) => s + e.amount, 0);
      return { group: g, expenses, payments, myId, net, transfers: smartSettle(net), myBalance: net[myId] ?? 0, lastActivity, spent };
    });
}

// Notifications: things other people did in my groups since I last looked.
export async function loadNotifications(memberships: Record<string, string>, limit = 50) {
  const members = await db.member.findMany({
    where: { id: { in: Object.values(memberships) } },
    include: { group: { select: { id: true, name: true, currency: true } } },
  });
  const valid = members.filter((m) => memberships[m.groupId] === m.id);
  if (valid.length === 0) return { items: [], unread: 0 };

  const events = await db.groupEvent.findMany({
    where: { OR: valid.map((m) => ({ groupId: m.groupId, actorId: { not: m.id } })) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const actorIds = [...new Set(events.map((e) => e.actorId))];
  const actors = await db.member.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const byGroup = new Map(valid.map((m) => [m.groupId, m]));

  const items = events.map((e) => {
    const me = byGroup.get(e.groupId)!;
    const seen = me.seenEventsAt ?? me.createdAt;
    return {
      event: e,
      actorName: actors.find((a) => a.id === e.actorId)?.name ?? "Someone",
      groupName: me.group.name,
      unread: e.createdAt > seen,
    };
  });

  const unread = await db.groupEvent.count({
    where: { OR: valid.map((m) => ({ groupId: m.groupId, actorId: { not: m.id }, createdAt: { gt: m.seenEventsAt ?? m.createdAt } })) },
  });
  return { items, unread };
}

export async function markNotificationsSeen(memberships: Record<string, string>) {
  const ids = Object.values(memberships);
  if (ids.length) await db.member.updateMany({ where: { id: { in: ids } }, data: { seenEventsAt: new Date() } });
}

// Groups I'm in that someone deleted in the last 30 days (they can be restored).
export const RESTORE_DAYS = 30;
export async function loadDeletedGroups(memberships: Record<string, string>, now = new Date()) {
  const since = new Date(now.getTime() - RESTORE_DAYS * 86_400_000);
  const groups = await db.group.findMany({
    where: { id: { in: Object.keys(memberships) }, deletedAt: { gt: since } },
    include: { members: { select: { id: true, name: true } } },
    orderBy: { deletedAt: "desc" },
  });
  return groups
    .filter((g) => g.members.some((m) => m.id === memberships[g.id]))
    .map((g) => ({
      id: g.id,
      name: g.name,
      deletedBy: g.deletedById === memberships[g.id] ? "You" : g.members.find((m) => m.id === g.deletedById)?.name ?? "Someone",
      daysLeft: Math.max(1, Math.ceil((g.deletedAt!.getTime() + RESTORE_DAYS * 86_400_000 - now.getTime()) / 86_400_000)),
    }));
}

// The group switcher: up to 5 of my other open groups, most recently active
// first. Names only, so it doesn't load every group's whole ledger.
export async function loadSwitchList(memberships: Record<string, string>, currentId: string) {
  const ids = Object.keys(memberships).filter((id) => id !== currentId);
  if (ids.length === 0) return [];
  const groups = await db.group.findMany({
    where: { id: { in: ids }, closed: false, deletedAt: null, members: { some: { id: { in: Object.values(memberships) } } } },
    select: { id: true, name: true, createdAt: true },
  });
  const latest = await db.groupEvent.groupBy({ by: ["groupId"], where: { groupId: { in: groups.map((g) => g.id) } }, _max: { createdAt: true } });
  const last = new Map(latest.map((l) => [l.groupId, l._max.createdAt?.getTime() ?? 0]));
  return groups
    .sort((a, b) => (last.get(b.id) ?? b.createdAt.getTime()) - (last.get(a.id) ?? a.createdAt.getTime()))
    .slice(0, 5)
    .map((g) => ({ id: g.id, name: g.name }));
}
