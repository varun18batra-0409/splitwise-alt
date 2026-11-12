import { db } from "./db";
import { coverFor } from "./covers";
import { netBalances } from "./balances";
import { smartSettle } from "./settle";
import { payerIds, spentAmount } from "./payers";
import { canRestoreGroup } from "./group-admin";
import { leaverCut, membersAsOf, ownShareDetails, scopeBalances, scopeForLeaver, type LeaverCut } from "./left-view";
import { leaverEvents, touchedAfter } from "./left-view-db";

// Deleted expenses and payments stay in the database (and in history) but never count.
const active = <T extends { deletedAt: Date | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt);

// Loads a group with everything needed for balances, Smart Settle and history.
// `events: false` skips the history (up to 500 rows) for screens that only need balances.
// `viewer`: the person looking. If they left (or were removed) they get the view they're allowed:
// the group up to the day they left plus later changes to their own share, and only their own
// balance (from the full ledger). Leave it out for money writes and the daily job: they use everything.
export async function loadGroup(id: string, opts: { events?: boolean; viewer?: string } = {}) {
  const group = await db.group.findUnique({
    where: { id },
    include: {
      members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      expenses: { orderBy: { createdAt: "desc" }, include: { shares: true } },
      payments: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" }, take: opts.events === false ? 0 : 500 },
    },
  });
  if (!group || group.deletedAt) return null;
  const memberIds = group.members.map((m) => m.id);
  const expenses = active(group.expenses);
  const payments = active(group.payments);
  const net = netBalances(memberIds, expenses, payments);
  const transfers = smartSettle(net);
  const me = opts.viewer ? group.members.find((m) => m.id === opts.viewer) : undefined;
  const cut = me ? leaverCut(me) : null;
  if (!me || !cut) return { group, expenses, payments, net, transfers, leaver: null as LeaverCut | null };

  const { before, after } = await leaverEvents(id, cut.leftAt, opts.events === false ? 0 : 500);
  const scoped = scopeForLeaver({ expenses: group.expenses, payments: group.payments, events: [...after, ...before] }, me.id, cut.leftAt);
  const mine = scopeBalances(net, transfers, me.id);
  return {
    group: {
      ...group,
      expenses: scoped.expenses,
      payments: scoped.payments,
      // Changes made after they left show only what happened to their own share.
      events: opts.events === false ? [] : scoped.events.slice(0, 500).map((ev) => (ev.createdAt.getTime() > cut.leftAt.getTime() ? { ...ev, details: ownShareDetails(ev.details, me.name) } : ev)),
    },
    expenses: active(scoped.expenses),
    payments: active(scoped.payments),
    net: mine.net,
    transfers: mine.transfers,
    leaver: cut as LeaverCut | null,
  };
}

// Read-only version of loadGroup for the group screens (Activity, Balances, Charts, This month...):
// the same rows and the same balances, Smart Settle and leaver view, but without columns no
// read-only screen uses (the saved rate source, who-added/who-removed notes, the invite code...).
// loadGroup stays as it is for everything that writes, settles, makes pay links or handles claims.
// The `omit` lists are checked by TypeScript: a screen that reads a missing column won't compile.
export async function loadGroupView(id: string, opts: { events?: boolean; viewer?: string } = {}) {
  const group = await db.group.findUnique({
    where: { id },
    omit: { inviteCode: true, joinWeight: true },
    include: {
      members: { omit: { notify: true, addedBy: true, seenAt: true, removedById: true, seenEventsAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      expenses: { omit: { rateSource: true }, orderBy: { createdAt: "desc" }, include: { shares: true } },
      payments: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" }, take: opts.events === false ? 0 : 500 },
    },
  });
  if (!group || group.deletedAt) return null;
  const memberIds = group.members.map((m) => m.id);
  const expenses = active(group.expenses);
  const payments = active(group.payments);
  const net = netBalances(memberIds, expenses, payments);
  const transfers = smartSettle(net);
  const me = opts.viewer ? group.members.find((m) => m.id === opts.viewer) : undefined;
  const cut = me ? leaverCut(me) : null;
  if (!me || !cut) return { group, expenses, payments, net, transfers, leaver: null as LeaverCut | null };

  const { before, after } = await leaverEvents(id, cut.leftAt, opts.events === false ? 0 : 500);
  const scoped = scopeForLeaver({ expenses: group.expenses, payments: group.payments, events: [...after, ...before] }, me.id, cut.leftAt);
  const mine = scopeBalances(net, transfers, me.id);
  return {
    group: {
      ...group,
      expenses: scoped.expenses,
      payments: scoped.payments,
      events: opts.events === false ? [] : scoped.events.slice(0, 500).map((ev) => (ev.createdAt.getTime() > cut.leftAt.getTime() ? { ...ev, details: ownShareDetails(ev.details, me.name) } : ev)),
    },
    expenses: active(scoped.expenses),
    payments: active(scoped.payments),
    net: mine.net,
    transfers: mine.transfers,
    leaver: cut as LeaverCut | null,
  };
}

// For the Undo bar on screens that skip the history: that one change and everything after it.
// That is all canUndo looks at (it only asks whether a newer change stands in the way).
// Same-moment changes are included (>=), so the id tie-break in canUndo still works.
export async function eventsFrom(groupId: string, eventId: string, take = 500) {
  const ev = await db.groupEvent.findFirst({ where: { id: eventId, groupId }, select: { createdAt: true } });
  if (!ev) return [];
  return db.groupEvent.findMany({ where: { groupId, createdAt: { gte: ev.createdAt } }, orderBy: { createdAt: "desc" }, take });
}

// For the home screen: every group this phone belongs to, with my balance in each.
export async function loadMyGroups(memberships: Record<string, string>) {
  const groups = await db.group.findMany({
    where: { id: { in: Object.keys(memberships) }, deletedAt: null },
    include: {
      members: { select: { id: true, name: true, phone: true, leftAt: true, removedAt: true, accountId: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      expenses: { include: { shares: true }, orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  const mine = groups.filter((g) => g.members.some((m) => m.id === memberships[g.id]));
  return Promise.all(
    mine.map(async (g) => {
      const myId = memberships[g.id];
      const full = active(g.expenses);
      const fullPayments = active(g.payments);
      const net = netBalances(g.members.map((m) => m.id), full, fullPayments);
      const transfers = smartSettle(net);
      // Someone who left sees the group up to that day (plus later changes to their own share); their balance is the full one.
      const cut = leaverCut(g.members.find((m) => m.id === myId)!);
      let rows = { expenses: g.expenses, payments: g.payments };
      if (cut) {
        const touched = await touchedAfter(g.id, myId, cut.leftAt);
        const upTo = cut.leftAt.getTime();
        const myExpense = (e: (typeof g.expenses)[number]) => e.paidById === myId || e.shares.some((s) => s.memberId === myId) || payerIds(e).includes(myId);
        rows = {
          expenses: g.expenses.filter((e) => e.createdAt.getTime() <= upTo || myExpense(e) || touched.expenseIds.includes(e.id)),
          payments: g.payments.filter((p) => p.createdAt.getTime() <= upTo || p.fromId === myId || p.toId === myId || touched.paymentIds.includes(p.id)),
        };
      }
      const expenses = cut ? active(rows.expenses) : full;
      const payments = cut ? active(rows.payments) : fullPayments;
      const lastActivity = [rows.expenses[0]?.createdAt, rows.payments[0]?.createdAt, g.createdAt]
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const spent = expenses.reduce((s, e) => s + spentAmount(e), 0);
      const shown = cut ? scopeBalances(net, transfers, myId) : { net, transfers };
      // How many people to say are in it: for a leaver, as it was on the day they left.
      const people = (cut ? membersAsOf(g.members, myId, cut.leftAt) : g.members).filter((m) => !m.leftAt).length;
      return { group: g, expenses, payments, myId, net: shown.net, transfers: shown.transfers, myBalance: net[myId] ?? 0, lastActivity, spent, leaver: cut, people };
    }),
  );
}

// The Home screen's version of loadMyGroups: identical rows, balances and leaver handling, minus
// columns Home never reads (the saved rate details of each expense, the group's invite code).
// loadMyGroups stays as it is for the other screens.
export async function loadMyGroupsLean(memberships: Record<string, string>) {
  const groups = await db.group.findMany({
    where: { id: { in: Object.keys(memberships) }, deletedAt: null },
    omit: { inviteCode: true, joinWeight: true },
    include: {
      members: { select: { id: true, name: true, phone: true, leftAt: true, removedAt: true, accountId: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      expenses: { omit: { rateSource: true, rateDate: true, exchangeRate: true, paymentMethod: true }, include: { shares: true }, orderBy: { createdAt: "desc" } },
      payments: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  const mine = groups.filter((g) => g.members.some((m) => m.id === memberships[g.id]));
  return Promise.all(
    mine.map(async (g) => {
      const myId = memberships[g.id];
      const full = active(g.expenses);
      const fullPayments = active(g.payments);
      const net = netBalances(g.members.map((m) => m.id), full, fullPayments);
      const transfers = smartSettle(net);
      const cut = leaverCut(g.members.find((m) => m.id === myId)!);
      let rows = { expenses: g.expenses, payments: g.payments };
      if (cut) {
        const touched = await touchedAfter(g.id, myId, cut.leftAt);
        const upTo = cut.leftAt.getTime();
        const myExpense = (e: (typeof g.expenses)[number]) => e.paidById === myId || e.shares.some((s) => s.memberId === myId) || payerIds(e).includes(myId);
        rows = {
          expenses: g.expenses.filter((e) => e.createdAt.getTime() <= upTo || myExpense(e) || touched.expenseIds.includes(e.id)),
          payments: g.payments.filter((p) => p.createdAt.getTime() <= upTo || p.fromId === myId || p.toId === myId || touched.paymentIds.includes(p.id)),
        };
      }
      const expenses = cut ? active(rows.expenses) : full;
      const payments = cut ? active(rows.payments) : fullPayments;
      const lastActivity = [rows.expenses[0]?.createdAt, rows.payments[0]?.createdAt, g.createdAt]
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const spent = expenses.reduce((s, e) => s + spentAmount(e), 0);
      const shown = cut ? scopeBalances(net, transfers, myId) : { net, transfers };
      const people = (cut ? membersAsOf(g.members, myId, cut.leftAt) : g.members).filter((m) => !m.leftAt).length;
      return { group: g, expenses, payments, myId, net: shown.net, transfers: shown.transfers, myBalance: net[myId] ?? 0, lastActivity, spent, leaver: cut, people };
    }),
  );
}

// Alerts for someone who left: what happened up to that day, plus later changes that touched their share.
function leaverEventScope(m: { id: string; leftAt: Date | null; removedAt: Date | null }) {
  const cut = leaverCut(m);
  return cut ? { OR: [{ createdAt: { lte: cut.leftAt } }, { touches: { contains: m.id } }] } : {};
}

// Notifications: things other people did in my groups since I last looked.
export async function loadNotifications(memberships: Record<string, string>, limit = 50) {
  const members = await db.member.findMany({
    where: { id: { in: Object.values(memberships) } },
    include: { group: { select: { id: true, name: true, currency: true, type: true, cover: true, coverAt: true } } },
  });
  const valid = members.filter((m) => memberships[m.groupId] === m.id);
  if (valid.length === 0) return { items: [], unread: 0 };

  const events = await db.groupEvent.findMany({
    where: { OR: valid.map((m) => ({ groupId: m.groupId, actorId: { not: m.id }, ...leaverEventScope(m) })) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const actorIds = [...new Set(events.map((e) => e.actorId))];
  const actors = await db.member.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const byGroup = new Map(valid.map((m) => [m.groupId, m]));

  const items = events.map((raw) => {
    const me = byGroup.get(raw.groupId)!;
    const cut = leaverCut(me);
    const e = cut && raw.createdAt.getTime() > cut.leftAt.getTime() ? { ...raw, details: ownShareDetails(raw.details, me.name) } : raw;
    const seen = me.seenEventsAt ?? me.createdAt;
    return {
      event: e,
      actorName: actors.find((a) => a.id === e.actorId)?.name ?? "Someone",
      groupName: me.group.name,
      myName: me.name,
      groupCover: coverFor(me.group),
      unread: e.createdAt > seen,
    };
  });

  const unread = await db.groupEvent.count({
    where: { OR: valid.map((m) => ({ groupId: m.groupId, actorId: { not: m.id }, createdAt: { gt: m.seenEventsAt ?? m.createdAt }, ...leaverEventScope(m) })) },
  });
  return { items, unread };
}

// Just the number on the Alerts bell (asked on every screen change): two small
// queries instead of loading the list.
export async function countUnread(memberships: Record<string, string>): Promise<number> {
  const ids = Object.values(memberships);
  if (!ids.length) return 0;
  const members = await db.member.findMany({ where: { id: { in: ids } }, select: { id: true, groupId: true, seenEventsAt: true, createdAt: true, leftAt: true, removedAt: true } });
  const valid = members.filter((m) => memberships[m.groupId] === m.id);
  if (!valid.length) return 0;
  return db.groupEvent.count({
    where: { OR: valid.map((m) => ({ groupId: m.groupId, actorId: { not: m.id }, createdAt: { gt: m.seenEventsAt ?? m.createdAt }, ...leaverEventScope(m) })) },
  });
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
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, claimedAt: true, leftAt: true, addedBy: true, seenAt: true } } },
    orderBy: { deletedAt: "desc" },
  });
  return groups
    // Only the groups this person is allowed to bring back (restoreGroup's rule): whoever deleted it or
    // looks after it, and not someone who left.
    .filter((g) => canRestoreGroup(g, g.members, memberships[g.id]))
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
    select: { id: true, name: true, createdAt: true, type: true, cover: true, coverAt: true },
  });
  const latest = await db.groupEvent.groupBy({ by: ["groupId"], where: { groupId: { in: groups.map((g) => g.id) } }, _max: { createdAt: true } });
  const last = new Map(latest.map((l) => [l.groupId, l._max.createdAt?.getTime() ?? 0]));
  return groups
    .sort((a, b) => (last.get(b.id) ?? b.createdAt.getTime()) - (last.get(a.id) ?? a.createdAt.getTime()))
    .slice(0, 5)
    .map((g) => ({ id: g.id, name: g.name, pic: coverFor(g) }));
}

// The number on the Alerts bell: group changes plus personal notes (Collect).
export async function countAllUnread(memberships: Record<string, string>, accountId?: string | null): Promise<number> {
  const [groups, notes] = await Promise.all([
    countUnread(memberships),
    accountId ? db.accountNote.count({ where: { accountId, seenAt: null } }) : Promise.resolve(0),
  ]);
  return groups + notes;
}
