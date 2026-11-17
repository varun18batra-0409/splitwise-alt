import { db } from "./db";
import { computeStats, settledByGroup, signedInPeople } from "./stats";

// The numbers behind the private Stats page. Read only AFTER the admin check (see the page), and kept for five minutes (the page wraps
// this in unstable_cache). Only groups that are not in the bin have their people, expenses and payments read; the people list shows the
// newest 100 accounts and the page says how many there are in all. Dates are returned as text so the cached copy comes back the same.
export const STATS_PEOPLE_SHOWN = 100;

export async function loadStatsData() {
  const [groups, accountsTotal, newest, events] = await Promise.all([
    db.group.findMany({ select: { id: true, createdAt: true, deletedAt: true, closed: true } }),
    db.account.count(),
    db.account.findMany({ select: { id: true, email: true, name: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: STATS_PEOPLE_SHOWN }),
    db.groupEvent.findMany({ where: { createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) } }, select: { groupId: true, createdAt: true, kind: true } }),
  ]);
  const liveIds = groups.filter((g) => !g.deletedAt).map((g) => g.id);
  const inLive = { group: { deletedAt: null } }; // (a filter on the group, not a long list of ids)
  const [members, expenses, payments] = await Promise.all([
    db.member.findMany({ where: inLive, select: { id: true, groupId: true, claimedAt: true, accountId: true, leftAt: true, removedAt: true } }),
    db.expense.findMany({ where: { deletedAt: null, ...inLive }, select: { groupId: true, createdAt: true, paidById: true, payers: true, kind: true, amount: true, shares: { select: { memberId: true, amount: true } } } }),
    db.payment.findMany({ where: { deletedAt: null, ...inLive }, select: { groupId: true, fromId: true, toId: true, amount: true } }),
  ]);
  const balancesSettled = settledByGroup(groups, members, expenses, payments);
  const s = computeStats({ groups, members, expenses, events, balancesSettled, accounts: accountsTotal });
  const people = signedInPeople(newest, members, new Set(liveIds)).map((p) => ({ ...p, since: p.since.toISOString() }));
  return { s, people, accountsTotal };
}
