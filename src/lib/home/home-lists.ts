import { dayKey, DEFAULT_TIME_ZONE } from "../dates";
import { daysBetween } from "../countdown";
import { nextDueDay } from "./bills";

// (db is loaded when a list is asked for, so the pure helper below can be tested without a database.)
// The lists Home reads, with a fixed order so a limit keeps the right ones (not whichever rows the database happens to hand back first).

// Card-night games finished since `since`: the newest ten.
export async function recentGames(potIds: string[], since: Date) {
  if (!potIds.length) return [];
  const { db } = await import("@/lib/db");
  return db.potGame.findMany({
    where: { groupId: { in: potIds }, status: "done", deletedAt: null, finishedAt: { gte: since } },
    include: { moves: { where: { deletedAt: null } } },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    take: 10,
  });
}

// Bills for Home's row: the one due soonest first (then by id), so "due tomorrow" is never cut off by the limit. "Soonest" is days
// until the next due date from today, wrapping into next month: on the 25th, a bill due on the 26th comes before one due on the 3rd.
// (The database can only order by day of the month, which puts the 3rd first, so the order is worked out here.) A bill with no
// next date (paused, or ended) goes last.
type SortableBill = { id: string; day: number; every: number; startMonth: string; endMonth: string; paused: boolean; tz: string; nature: string };
export function sortBillsByNextDue<B extends SortableBill>(bills: B[], now: Date): B[] {
  const rank = new Map(
    bills.map((b) => {
      const due = nextDueDay(b, now);
      return [b.id, due ? daysBetween(dayKey(now, b.tz || DEFAULT_TIME_ZONE), due) : Number.MAX_SAFE_INTEGER] as const;
    }),
  );
  return [...bills].sort((a, b) => rank.get(a.id)! - rank.get(b.id)! || a.id.localeCompare(b.id));
}

export async function homeBills(groupIds: string[], now = new Date()) {
  if (!groupIds.length) return [];
  const { db } = await import("@/lib/db");
  const rows = await db.bill.findMany({ where: { groupId: { in: groupIds }, deletedAt: null, paused: false }, orderBy: [{ day: "asc" }, { id: "asc" }], take: 1000 });
  return sortBillsByNextDue(rows, now).slice(0, 200);
}

// The pot groups whose games Home may tell stories about: not one the viewer left (it links to a page they can't open). Taken
// BEFORE the newest-ten limit, so games from a group they left can't push out the ones they should see.
export function potIdsToShow(open: { group: { id: string; type: string }; leaver?: unknown | null }[]): string[] {
  return open.filter((g) => g.group.type === "pot" && !g.leaver).map((g) => g.group.id);
}

// A story about a game links to a page that people who left can't open, so there is no story for a group the viewer left.
export function gamesForStories<G extends { groupId: string }>(rows: G[], open: { group: { id: string }; leaver?: unknown | null }[]): G[] {
  return rows.filter((gm) => {
    const g = open.find((x) => x.group.id === gm.groupId);
    return Boolean(g) && !g!.leaver;
  });
}
