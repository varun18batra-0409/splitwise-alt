// Numbers for the private stats page, worked out from the app's own data
// (no tracking). Pure function so it can be tested.

export type StatsInput = {
  groups: { id: string; createdAt: Date; deletedAt: Date | null; closed: boolean }[];
  members: { groupId: string; claimedAt: Date | null }[];
  expenses: { groupId: string; createdAt: Date }[];
  events: { groupId: string; createdAt: Date; kind: string }[];
  balancesSettled: Record<string, boolean>; // groupId → everyone square
  accounts: number;
};

const DAY = 86_400_000;

export function computeStats(d: StatsInput, now = new Date()) {
  const live = d.groups.filter((g) => !g.deletedAt);
  const since = (days: number) => new Date(now.getTime() - days * DAY);

  const activeIn = (from: Date, to: Date) =>
    new Set(d.events.filter((e) => e.createdAt >= from && e.createdAt < to).map((e) => e.groupId));
  const weeklyActive = activeIn(since(7), now).size;

  const newGroups7 = live.filter((g) => g.createdAt >= since(7)).length;
  const newGroups30 = live.filter((g) => g.createdAt >= since(30)).length;

  // Time from creating a group to its first expense (median, in minutes).
  const firstExpense = new Map<string, Date>();
  for (const e of d.expenses) {
    const f = firstExpense.get(e.groupId);
    if (!f || e.createdAt < f) firstExpense.set(e.groupId, e.createdAt);
  }
  const waits = live
    .map((g) => (firstExpense.has(g.id) ? (firstExpense.get(g.id)!.getTime() - g.createdAt.getTime()) / 60_000 : null))
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);
  const medianMinutesToFirstExpense = waits.length ? waits[Math.floor((waits.length - 1) / 2)] : null;
  const withExpense = live.filter((g) => firstExpense.has(g.id)).length;

  // Invites that worked: groups where at least 2 people picked their name.
  const claimed = new Map<string, number>();
  for (const m of d.members) if (m.claimedAt) claimed.set(m.groupId, (claimed.get(m.groupId) ?? 0) + 1);
  const invited = live.filter((g) => (claimed.get(g.id) ?? 0) >= 2).length;

  // 4-week retention: groups created 28–56 days ago that were still used in the last 28 days.
  const cohort = live.filter((g) => g.createdAt >= since(56) && g.createdAt < since(28));
  const recent = activeIn(since(28), now);
  const retained = cohort.filter((g) => recent.has(g.id)).length;

  // Settle-up: groups with expenses where everyone is now square.
  const settled = live.filter((g) => firstExpense.has(g.id) && d.balancesSettled[g.id]).length;

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  return {
    totalGroups: live.length,
    weeklyActive,
    newGroups7,
    newGroups30,
    withExpensePct: pct(withExpense, live.length),
    medianMinutesToFirstExpense,
    invitePct: pct(invited, live.length),
    retention4w: { pct: pct(retained, cohort.length), of: cohort.length },
    settledPct: pct(settled, withExpense),
    accounts: d.accounts,
    deletedGroups: d.groups.length - live.length,
  };
}
