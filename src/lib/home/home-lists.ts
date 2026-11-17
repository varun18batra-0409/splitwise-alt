
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

// Bills for Home's row: soonest due first (then by id), so "due tomorrow" is never cut off by the limit.
export async function homeBills(groupIds: string[]) {
  if (!groupIds.length) return [];
  const { db } = await import("@/lib/db");
  return db.bill.findMany({ where: { groupId: { in: groupIds }, deletedAt: null, paused: false }, orderBy: [{ day: "asc" }, { id: "asc" }], take: 200 });
}

// A story about a game links to a page that people who left can't open, so there is no story for a group the viewer left.
export function gamesForStories<G extends { groupId: string }>(rows: G[], open: { group: { id: string }; leaver?: unknown | null }[]): G[] {
  return rows.filter((gm) => {
    const g = open.find((x) => x.group.id === gm.groupId);
    return Boolean(g) && !g!.leaver;
  });
}
