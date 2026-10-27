import { db } from "./db";
import { buildPassport, parseHandPlaces, type PassportTrip } from "./passport";

// Your passport, from every trip group you're in (any phone you signed in on).
export async function loadPassport(account: { id: string; homeCountry: string; places: string }, fallbackHome: string, today: string) {
  const groups = await db.group.findMany({
    where: { type: "trip", deletedAt: null, members: { some: { accountId: account.id } } },
    select: { id: true, name: true, tripStart: true, tripEnd: true, tripPlace: true, tripCountry: true, createdAt: true, _count: { select: { members: true, expenses: { where: { deletedAt: null } } } } },
    orderBy: [{ tripStart: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  // A trip without dates counts from when the group was made, once something was spent
  // (a trip still being planned isn't a stamp yet).
  const trips: PassportTrip[] = groups.filter((g) => g.tripStart || g._count.expenses > 0).map((g) => ({
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
