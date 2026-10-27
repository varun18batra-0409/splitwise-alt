import { db } from "./db";
import { buildPassport, parseHandPlaces, type PassportTrip } from "./passport";

// Your passport, from every trip group you're in (any phone you signed in on).
export async function loadPassport(account: { id: string; homeCountry: string; places: string }, fallbackHome: string, today: string, opts: { forFriend?: boolean } = {}) {
  const groups = await db.group.findMany({
    where: { type: "trip", deletedAt: null, members: { some: { accountId: account.id } } },
    select: { id: true, name: true, tripStart: true, tripEnd: true, tripPlace: true, tripCountry: true, createdAt: true, _count: { select: { members: true, expenses: { where: { deletedAt: null } } } } },
    orderBy: [{ tripStart: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  // A trip without dates counts from when the group was made, once something was spent
  // (a trip still being planned isn't a stamp yet).
  // Seen by a friend: only trips that are over (a trip happening now would say where you are today).
  // (A trip without dates counts once it's a few days old.)
  const over = (g: { tripStart: string; tripEnd: string; createdAt: Date }) =>
    g.tripEnd || g.tripStart ? (g.tripEnd || g.tripStart) < today : new Date(g.createdAt.getTime() + 3 * 86_400_000).toISOString().slice(0, 10) < today;
  const trips: PassportTrip[] = groups.filter((g) => (g.tripStart || g._count.expenses > 0) && (!opts.forFriend || over(g))).map((g) => ({
    groupId: g.id,
    name: g.name,
    start: g.tripStart || g.createdAt.toISOString().slice(0, 10),
    end: g.tripEnd,
    place: g.tripPlace,
    country: g.tripCountry,
    people: g._count.members,
  }));
  const home = account.homeCountry || fallbackHome;
  const passport = buildPassport(trips, parseHandPlaces(account.places), home, today);
  // Trips we couldn't place: a nudge to add "Where to?".
  const { tripStops } = await import("./geo");
  // (Also a trip whose place we can't put in a country: no country picked and no home country.)
  const unplaced = trips
    .filter((t) => t.start <= today)
    .filter((t) => {
      const stops = tripStops(t.name, t.place, t.country);
      return !stops.length || stops.every((s) => !s.country && !home);
    })
    .map((t) => ({ groupId: t.groupId, name: t.name }));
  return { ...passport, home, unplaced };
}

// Everyone you've shared a group with at some point (they may have left since),
// who's on Loopin: the people whose passports you can open. Deleted groups don't count.
export async function passportFriends(accountId: string) {
  const mine = await db.member.findMany({ where: { accountId, group: { deletedAt: null } }, select: { groupId: true }, take: 500 });
  if (!mine.length) return [];
  const others = await db.member.findMany({
    where: { groupId: { in: mine.map((m) => m.groupId) }, accountId: { not: null, notIn: [accountId] } },
    select: { accountId: true, name: true, groupId: true, group: { select: { name: true } } },
    take: 3000,
  });
  const by = new Map<string, { accountId: string; name: string; groups: string[] }>();
  for (const o of others) {
    const f = by.get(o.accountId!) ?? { accountId: o.accountId!, name: o.name, groups: [] };
    if (!f.groups.includes(o.group.name)) f.groups.push(o.group.name);
    by.set(o.accountId!, f);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

// May this person open that person's passport? Only if they've shared a group
// (not deleted), and the owner lets people in their groups see it.
export async function canSeePassport(viewerAccountId: string, ownerAccountId: string) {
  if (viewerAccountId === ownerAccountId) return { ok: true as const, owner: await db.account.findUnique({ where: { id: ownerAccountId } }), name: undefined as string | undefined };
  const shared = await db.member.findFirst({
    where: { accountId: ownerAccountId, group: { deletedAt: null, members: { some: { accountId: viewerAccountId } } } },
    select: { name: true },
  });
  if (!shared) return { ok: false as const, reason: "stranger" as const, name: undefined as string | undefined };
  const owner = await db.account.findUnique({ where: { id: ownerAccountId } });
  if (!owner) return { ok: false as const, reason: "stranger" as const, name: undefined as string | undefined };
  if (owner.passportShare === "private") return { ok: false as const, reason: "private" as const, name: shared.name as string | undefined };
  return { ok: true as const, owner, name: shared.name as string | undefined };
}
