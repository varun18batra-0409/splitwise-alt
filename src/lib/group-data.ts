import { db } from "./db";
import { blockedEitherWay } from "./blocks";
import { coverFor, coverSeenBy } from "./covers";
import { netBalances } from "./balances";
import { pairwiseDebtCount, smartSettle } from "./settle";
import { payerIds, spentAmount } from "./payers";
import { canRestoreGroup } from "./group-admin";
import { asOfCut, hideLaterNotes, isAboutMeLeaving, leaverCut, membersAsOf, ownShareDetails, scopeBalances, scopeForLeaver, type LeaverCut } from "./left-view";
import { asOfFixes, laterRowEvents, leaverEvents, readableWhere, touchedAfter } from "./left-view-db";
import { netBalancesDb, settleDataDb } from "./balances-db";
import type { Prisma } from "@prisma/client";
import { isDirect, NOT_DIRECT } from "./direct";

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
  if (!me || !cut) return { group, expenses, payments, net, transfers, leaver: null as LeaverCut | null, people: group.members };

  const { before, after } = await leaverEvents(id, cut.leftAt, opts.events === false ? 0 : 500);
  const scoped = scopeForLeaver({ expenses: group.expenses, payments: group.payments, events: [...after, ...before] }, me.id, cut.leftAt, await touchedAfter(id, me.id, cut.leftAt));
  // Rows added before they left show as they were that day (MA-3); only what is shown changes, never the balances above.
  const rowEvents = await laterRowEvents(id, cut.leftAt); // the one list every screen uses, so they all agree
  const asOf = asOfCut({ expenses: scoped.expenses, payments: scoped.payments }, rowEvents.events, me.id, cut.leftAt, { complete: rowEvents.complete });
  scoped.expenses = hideLaterNotes(asOf.expenses, cut.leftAt);
  scoped.payments = asOf.payments;
  const mine = scopeBalances(net, transfers, me.id);
  return {
    // (A group photo put up after they left is not shown to them: the default cover instead.)
    group: coverSeenBy({
      ...group,
      expenses: scoped.expenses,
      payments: scoped.payments,
      // Changes made after they left show only what happened to their own share.
      events: opts.events === false ? [] : scoped.events.slice(0, 500).map((ev) => (ev.createdAt.getTime() > cut.leftAt.getTime() && !isAboutMeLeaving(ev, me.id) ? { ...ev, details: ownShareDetails(ev.details, me.name) } : ev)),
    }, cut.leftAt),
    expenses: active(scoped.expenses),
    payments: active(scoped.payments),
    net: mine.net,
    transfers: mine.transfers,
    leaver: cut as LeaverCut | null,
    // The people as they were the day this viewer left (the filters, charts and Wrapped use these; names on rows still use group.members).
    people: membersAsOf(group.members, me.id, cut.leftAt),
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
      expenses: { orderBy: { createdAt: "desc" }, include: { shares: true } }, // Activity shows each saved rate's source and day
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
  if (!me || !cut) return { group, expenses, payments, net, transfers, leaver: null as LeaverCut | null, people: group.members };

  const { before, after } = await leaverEvents(id, cut.leftAt, opts.events === false ? 0 : 500);
  const scoped = scopeForLeaver({ expenses: group.expenses, payments: group.payments, events: [...after, ...before] }, me.id, cut.leftAt, await touchedAfter(id, me.id, cut.leftAt));
  // Rows added before they left show as they were that day (MA-3); only what is shown changes, never the balances above.
  const rowEvents = await laterRowEvents(id, cut.leftAt); // the one list every screen uses, so they all agree
  const asOf = asOfCut({ expenses: scoped.expenses, payments: scoped.payments }, rowEvents.events, me.id, cut.leftAt, { complete: rowEvents.complete });
  scoped.expenses = hideLaterNotes(asOf.expenses, cut.leftAt);
  scoped.payments = asOf.payments;
  const mine = scopeBalances(net, transfers, me.id);
  return {
    // (A group photo put up after they left is not shown to them: the default cover instead.)
    group: coverSeenBy({
      ...group,
      expenses: scoped.expenses,
      payments: scoped.payments,
      events: opts.events === false ? [] : scoped.events.slice(0, 500).map((ev) => (ev.createdAt.getTime() > cut.leftAt.getTime() && !isAboutMeLeaving(ev, me.id) ? { ...ev, details: ownShareDetails(ev.details, me.name) } : ev)),
    }, cut.leftAt),
    expenses: active(scoped.expenses),
    payments: active(scoped.payments),
    net: mine.net,
    transfers: mine.transfers,
    leaver: cut as LeaverCut | null,
    // The people as they were the day this viewer left (the filters, charts and Wrapped use these; names on rows still use group.members).
    people: membersAsOf(group.members, me.id, cut.leftAt),
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
// Pairs (type "direct") are left out unless `includeDirect` (only "My data", so it stays complete).
export async function loadMyGroups(memberships: Record<string, string>, opts: { includeDirect?: boolean } = {}) {
  const groups = await db.group.findMany({
    where: { id: { in: Object.keys(memberships) }, deletedAt: null, ...(opts.includeDirect ? {} : NOT_DIRECT) },
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
        const visible = {
          expenses: g.expenses.filter((e) => e.createdAt.getTime() <= upTo || myExpense(e) || touched.expenseIds.includes(e.id)),
          payments: g.payments.filter((p) => p.createdAt.getTime() <= upTo || p.fromId === myId || p.toId === myId || touched.paymentIds.includes(p.id)),
        };
        // As they were on the day they left (MA-3): one query for the group's later changes to rows.
        const rowEvents = await laterRowEvents(g.id, cut.leftAt);
        const asOf = asOfCut(visible, rowEvents.events, myId, cut.leftAt, { complete: rowEvents.complete });
        rows = { expenses: hideLaterNotes(asOf.expenses, cut.leftAt), payments: asOf.payments };
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
      return { group: cut ? coverSeenBy(g, cut.leftAt) : g, expenses, payments, myId, net: shown.net, transfers: shown.transfers, myBalance: net[myId] ?? 0, lastActivity, spent, leaver: cut, people };
    }),
  );
}

// The Home screen's version of loadMyGroups: identical rows, balances and leaver handling, minus
// columns Home never reads (the saved rate details of each expense, the group's invite code).
// loadMyGroups stays as it is for the other screens.
export async function loadMyGroupsLean(memberships: Record<string, string>) {
  const groups = await db.group.findMany({
    where: { id: { in: Object.keys(memberships) }, deletedAt: null, ...NOT_DIRECT },
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
        const visible = {
          expenses: g.expenses.filter((e) => e.createdAt.getTime() <= upTo || myExpense(e) || touched.expenseIds.includes(e.id)),
          payments: g.payments.filter((p) => p.createdAt.getTime() <= upTo || p.fromId === myId || p.toId === myId || touched.paymentIds.includes(p.id)),
        };
        // As they were on the day they left (MA-3): one query for the group's later changes to rows.
        const rowEvents = await laterRowEvents(g.id, cut.leftAt);
        const asOf = asOfCut(visible, rowEvents.events, myId, cut.leftAt, { complete: rowEvents.complete });
        rows = { expenses: hideLaterNotes(asOf.expenses, cut.leftAt), payments: asOf.payments };
      }
      const expenses = cut ? active(rows.expenses) : full;
      const payments = cut ? active(rows.payments) : fullPayments;
      const lastActivity = [rows.expenses[0]?.createdAt, rows.payments[0]?.createdAt, g.createdAt]
        .filter((d): d is Date => Boolean(d))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      const spent = expenses.reduce((s, e) => s + spentAmount(e), 0);
      const shown = cut ? scopeBalances(net, transfers, myId) : { net, transfers };
      const people = (cut ? membersAsOf(g.members, myId, cut.leftAt) : g.members).filter((m) => !m.leftAt).length;
      return { group: cut ? coverSeenBy(g, cut.leftAt) : g, expenses, payments, myId, net: shown.net, transfers: shown.transfers, myBalance: net[myId] ?? 0, lastActivity, spent, leaver: cut, people };
    }),
  );
}

// What the group Settle page needs and nothing more: the plan, how many expenses and payments there are, how much
// has been paid back, and how many debts Smart Settle replaced. The balances are added up by the database
// (see balances-db.ts), so the page doesn't load every expense and share. This is for DISPLAY: the settle actions
// and pay links keep loadGroup's full loader and recheck the plan there, and the two give the same plan.
// Someone who left keeps the full loader's scoped view.
export async function loadGroupSettle(id: string, viewer?: string | null) {
  const group = await db.group.findUnique({ where: { id }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || group.deletedAt) return null;
  const me = viewer ? group.members.find((m) => m.id === viewer) : undefined;
  if (me && leaverCut(me)) {
    const full = await loadGroup(id, { viewer: me.id, events: false });
    if (!full) return null;
    return {
      group: full.group as typeof group,
      transfers: full.transfers,
      expenseCount: full.expenses.length,
      paymentCount: full.payments.length,
      paidSoFar: full.payments.filter((p) => p.fromId === me.id || p.toId === me.id).reduce((t, p) => t + p.amount, 0), // their own payments only (not other people's in the group)
      before: pairwiseDebtCount(full.expenses, full.payments),
      leaver: full.leaver,
    };
  }
  // The balances and the facts are read together, in one transaction, so they come from the same moment.
  const { balances, facts } = await settleDataDb(id, group.members.map((m) => m.id));
  return { group, transfers: balances.transfers, ...facts, leaver: null as LeaverCut | null };
}

// Home, Your groups and Settle across groups: the same entries as loadMyGroupsLean (balances, Smart Settle, leaver
// handling, last activity, what was spent, how many people) without loading any group's expenses or payments.
// Balances are added up by the database (balances-db.ts); counts, totals and dates come from grouped queries.
// `expenseCount` / `paymentCount` count what is not deleted (and, for someone who left, what they may see).
// `readable`: for someone who left, the filters for the rows they may read (Home's Latest uses them); null otherwise.
// Pairs (type "direct") are left out unless `includeDirect`: only overview.ts asks for them, and splits them off again.
export async function loadMyGroupsLight(memberships: Record<string, string>, opts: { includeDirect?: boolean } = {}) {
  const groups = await db.group.findMany({
    where: { id: { in: Object.keys(memberships) }, deletedAt: null, ...(opts.includeDirect ? {} : NOT_DIRECT) },
    omit: { inviteCode: true, joinWeight: true },
    include: { members: { select: { id: true, name: true, phone: true, leftAt: true, removedAt: true, accountId: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    orderBy: { createdAt: "desc" },
  });
  const mine = groups.filter((g) => g.members.some((m) => m.id === memberships[g.id]));
  if (mine.length === 0) return [];
  const stayers = mine.filter((g) => !leaverCut(g.members.find((m) => m.id === memberships[g.id])!));
  const leavers = mine.filter((g) => leaverCut(g.members.find((m) => m.id === memberships[g.id])!));
  const [balances, stayerStats, leaverStats] = await Promise.all([
    netBalancesDb(mine.map((g) => g.id), { members: Object.fromEntries(mine.map((g) => [g.id, g.members.map((m) => m.id)])) }),
    stayers.length ? visibleStats({ groupId: { in: stayers.map((g) => g.id) } }, { groupId: { in: stayers.map((g) => g.id) } }) : Promise.resolve(new Map<string, VisibleStats>()),
    Promise.all(
      leavers.map(async (g) => {
        const scope = (await readableWhere(g.id, g.members.find((m) => m.id === memberships[g.id])!))!;
        // Rows that were changed or deleted after they left count as they stood that day (MA-3). (Read alongside the totals; the
        // as-of work is shared with Home's Latest list within the request.)
        const [stats, fix] = await Promise.all([
          visibleStats({ groupId: g.id, AND: [scope.expenses] }, { groupId: g.id, AND: [scope.payments] }),
          asOfFixes(g.id, g.members.find((m) => m.id === memberships[g.id])!),
        ]);
        const base = stats.get(g.id) ?? NO_STATS;
        return { id: g.id, scope, stats: { ...base, spent: base.spent + fix.spentDelta, expenseCount: base.expenseCount + fix.countDelta } };
      }),
    ),
  ]);
  const scopeOf = new Map(leaverStats.map((l) => [l.id, l.scope]));
  return mine.map((g) => {
    const myId = memberships[g.id];
    const cut = leaverCut(g.members.find((m) => m.id === myId)!);
    const b = balances.get(g.id)!;
    const st = (cut ? leaverStats.find((l) => l.id === g.id)?.stats : stayerStats.get(g.id)) ?? NO_STATS;
    const lastActivity = [st.lastExpenseAt, st.lastPaymentAnyAt, g.createdAt].filter((d): d is Date => Boolean(d)).sort((a, c) => c.getTime() - a.getTime())[0];
    const shown = cut ? scopeBalances(b.net, b.transfers, myId) : { net: b.net, transfers: b.transfers };
    const people = (cut ? membersAsOf(g.members, myId, cut.leftAt) : g.members).filter((m) => !m.leftAt).length;
    return {
      group: cut ? coverSeenBy(g, cut.leftAt) : g,
      myId,
      net: shown.net,
      transfers: shown.transfers,
      myBalance: b.net[myId] ?? 0,
      lastActivity,
      spent: st.spent,
      leaver: cut,
      people,
      expenseCount: st.expenseCount,
      paymentCount: st.paymentCount,
      lastPaymentAt: st.lastPaymentAt,
      readable: scopeOf.get(g.id) ?? null,
    };
  });
}

type VisibleStats = {
  expenseCount: number; // not deleted
  spent: number; // spentAmount summed: money back takes away, card-game results are not spending
  lastExpenseAt: Date | null; // newest expense added, deleted ones too (like "last activity" always was)
  lastPaymentAnyAt: Date | null; // newest payment recorded, deleted ones too
  paymentCount: number; // not deleted
  lastPaymentAt: Date | null; // newest payment that counts
};
const NO_STATS: VisibleStats = { expenseCount: 0, spent: 0, lastExpenseAt: null, lastPaymentAnyAt: null, paymentCount: 0, lastPaymentAt: null };

// Counts, totals and newest dates per group for the rows matching these filters (one grouped query each).
async function visibleStats(expenseWhere: Prisma.ExpenseWhereInput, paymentWhere: Prisma.PaymentWhereInput): Promise<Map<string, VisibleStats>> {
  const [byKind, lastE, lastP, paid] = await Promise.all([
    db.expense.groupBy({ by: ["groupId", "kind"], where: { AND: [expenseWhere, { deletedAt: null }] }, _sum: { amount: true }, _count: { _all: true } }),
    db.expense.groupBy({ by: ["groupId"], where: expenseWhere, _max: { createdAt: true } }),
    db.payment.groupBy({ by: ["groupId"], where: paymentWhere, _max: { createdAt: true } }),
    db.payment.groupBy({ by: ["groupId"], where: { AND: [paymentWhere, { deletedAt: null }] }, _count: { _all: true }, _max: { createdAt: true } }),
  ]);
  const out = new Map<string, VisibleStats>();
  const of = (gid: string) => out.get(gid) ?? out.set(gid, { ...NO_STATS }).get(gid)!;
  for (const r of byKind) {
    const s = of(r.groupId);
    s.expenseCount += r._count._all;
    s.spent += spentAmount({ amount: r._sum.amount ?? 0, kind: r.kind });
  }
  for (const r of lastE) of(r.groupId).lastExpenseAt = r._max.createdAt;
  for (const r of lastP) of(r.groupId).lastPaymentAnyAt = r._max.createdAt;
  for (const r of paid) {
    const s = of(r.groupId);
    s.paymentCount = r._count._all;
    s.lastPaymentAt = r._max.createdAt;
  }
  return out;
}

// Alerts for someone who left: what happened up to that day, plus later changes that touched their share.
function leaverEventScope(m: { id: string; leftAt: Date | null; removedAt: Date | null }) {
  const cut = leaverCut(m);
  return cut ? { OR: [{ createdAt: { lte: cut.leftAt } }, { touches: { contains: m.id } }] } : {};
}

// The people in these groups (as member ids) with a block between them and this account, either way round. Their activity is left
// out of the Alerts bell only; the group's own screens (expenses, balances, Activity) are never changed, so the money still adds up.
export async function blockedMemberIds(groupIds: string[], accountId: string): Promise<string[]> {
  if (!groupIds.length) return [];
  const blocked = await blockedEitherWay(accountId);
  if (blocked.size === 0) return [];
  const rows = await db.member.findMany({ where: { groupId: { in: groupIds }, accountId: { in: [...blocked] } }, select: { id: true } });
  return rows.map((r) => r.id);
}

// Notifications: things other people did in my groups since I last looked.
export async function loadNotifications(memberships: Record<string, string>, limit = 50, accountId?: string | null) {
  const members = await db.member.findMany({
    where: { id: { in: Object.values(memberships) } },
    include: { group: { select: { id: true, name: true, currency: true, type: true, cover: true, coverAt: true, deletedAt: true } } },
  });
  // A retired pair (deleted when an invite merged it) has no page any more, so its old updates are left out.
  const valid = members.filter((m) => memberships[m.groupId] === m.id && !(isDirect(m.group) && m.group.deletedAt));
  if (valid.length === 0) return { items: [], unread: 0 };
  const hidden = accountId ? await blockedMemberIds(valid.map((m) => m.groupId), accountId) : [];

  const events = await db.groupEvent.findMany({
    where: { OR: valid.map((m) => ({ groupId: m.groupId, actorId: { notIn: [m.id, ...hidden] }, ...leaverEventScope(m) })) },
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
      groupName: isDirect(me.group) ? "Direct" : me.group.name,
      myName: me.name,
      groupCover: coverFor(isDirect(me.group) ? { ...me.group, cover: "plain", coverAt: null } : me.group, false, cut?.leftAt),
      direct: isDirect(me.group),
      unread: e.createdAt > seen,
    };
  });

  const unread = await db.groupEvent.count({
    where: { OR: valid.map((m) => ({ groupId: m.groupId, actorId: { notIn: [m.id, ...hidden] }, createdAt: { gt: m.seenEventsAt ?? m.createdAt }, ...leaverEventScope(m) })) },
  });
  return { items, unread };
}

// Just the number on the Alerts bell (asked on every screen change): two small
// queries instead of loading the list.
export async function countUnread(memberships: Record<string, string>, accountId?: string | null): Promise<number> {
  const ids = Object.values(memberships);
  if (!ids.length) return 0;
  const members = await db.member.findMany({ where: { id: { in: ids } }, select: { id: true, groupId: true, seenEventsAt: true, createdAt: true, leftAt: true, removedAt: true } });
  const valid = members.filter((m) => memberships[m.groupId] === m.id);
  if (!valid.length) return 0;
  const hidden = accountId ? await blockedMemberIds(valid.map((m) => m.groupId), accountId) : [];
  return db.groupEvent.count({
    where: { OR: valid.map((m) => ({ groupId: m.groupId, actorId: { notIn: [m.id, ...hidden] }, createdAt: { gt: m.seenEventsAt ?? m.createdAt }, ...leaverEventScope(m) })) },
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
    where: { id: { in: Object.keys(memberships) }, deletedAt: { gt: since }, ...NOT_DIRECT },
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
    where: { id: { in: ids }, closed: false, deletedAt: null, ...NOT_DIRECT, members: { some: { id: { in: Object.values(memberships) } } } },
    select: { id: true, name: true, createdAt: true, type: true, cover: true, coverAt: true, members: { where: { id: { in: Object.values(memberships) } }, select: { leftAt: true, removedAt: true } } },
  });
  const latest = await db.groupEvent.groupBy({ by: ["groupId"], where: { groupId: { in: groups.map((g) => g.id) } }, _max: { createdAt: true } });
  const last = new Map(latest.map((l) => [l.groupId, l._max.createdAt?.getTime() ?? 0]));
  return groups
    .sort((a, b) => (last.get(b.id) ?? b.createdAt.getTime()) - (last.get(a.id) ?? a.createdAt.getTime()))
    .slice(0, 5)
    .map((g) => ({ id: g.id, name: g.name, pic: coverFor(g, false, g.members[0] ? leaverCut(g.members[0])?.leftAt : null) }));
}

// The number on the Alerts bell: group changes plus personal notes (Collect).
export async function countAllUnread(memberships: Record<string, string>, accountId?: string | null): Promise<number> {
  const [groups, notes] = await Promise.all([
    countUnread(memberships, accountId),
    accountId ? db.accountNote.count({ where: { accountId, seenAt: null } }) : Promise.resolve(0),
  ]);
  return groups + notes;
}
