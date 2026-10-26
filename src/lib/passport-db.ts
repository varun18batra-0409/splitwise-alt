import { db } from "./db";
import { buildPassport, parseHandPlaces, type PassportTrip } from "./passport";

// Your passport, from every trip group you're in (any phone you signed in on).
export async function loadPassport(account: { id: string; homeCountry: string; places: string }, fallbackHome: string, today: string) {
  const groups = await db.group.findMany({
    where: { type: "trip", deletedAt: null, members: { some: { accountId: account.id } } },
    select: { id: true, name: true, tripStart: true, tripEnd: true, tripPlace: true, tripCountry: true, createdAt: true, _count: { select: { members: true } } },
    take: 300,
  });
  // A trip without dates counts from when the group was made.
  const trips: PassportTrip[] = groups.map((g) => ({
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
  const unplaced = trips.filter((t) => t.start <= today && !tripStops(t.name, t.place, t.country).length).map((t) => ({ groupId: t.groupId, name: t.name }));
  return { ...passport, home, unplaced };
}
