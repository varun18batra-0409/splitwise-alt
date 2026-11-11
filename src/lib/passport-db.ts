import { db } from "./db";
import { buildPassport, parseHandPlaces, type PassportTrip } from "./passport";

// Your passport, from every trip group you're in (any phone you signed in on).
export async function loadPassport(account: { id: string; homeCountry: string; places: string }, fallbackHome: string, today: string, opts: { forFriend?: boolean } = {}) {
  const groups = await db.group.findMany({
    where: { type: "trip", deletedAt: null, members: { some: { accountId: account.id } } },
    select: {
      id: true, name: true, tripStart: true, tripEnd: true, tripPlace: true, tripCountry: true, createdAt: true,
      _count: { select: { members: true, expenses: { where: { deletedAt: null } } } },
      // Your own row (did you leave before the trip?) and the last thing spent (when an undated trip happened).
      members: { where: { accountId: account.id }, select: { leftAt: true } },
      expenses: { where: { deletedAt: null, kind: { not: "pot" } }, select: { spentAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: [{ tripStart: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  // A trip without dates counts once something was spent, from its latest spending.
  // Seen by a friend: only trips that are over (a trip happening now would say where you are today).
  // (A trip without dates counts once it's a few days old.)
  const over = (g: { tripStart: string; tripEnd: string; createdAt: Date }) =>
    g.tripEnd || g.tripStart ? (g.tripEnd || g.tripStart) < today : new Date(g.createdAt.getTime() + 3 * 86_400_000).toISOString().slice(0, 10) < today;
  // An undated trip happened around its latest spending (not when the group was made,
  // which can be months before: a flight booked early isn't a stamp yet).
  const undatedDay = (g: (typeof groups)[number]) => {
    const e = g.expenses[0];
    return (e ? e.spentAt ?? e.createdAt : g.createdAt).toISOString().slice(0, 10);
  };
  // Someone who left before the trip began didn't go.
  const went = (g: (typeof groups)[number]) => {
    const start = g.tripStart || undatedDay(g);
    return g.members.some((m) => !m.leftAt || m.leftAt.toISOString().slice(0, 10) >= start);
  };
  const trips: PassportTrip[] = groups.filter((g) => (g.tripStart || g._count.expenses > 0) && went(g) && (!opts.forFriend || over(g))).map((g) => ({
    groupId: g.id,
    name: g.name,
    start: g.tripStart || undatedDay(g),
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
    // Someone added straight in by another person counts once they've opened that group.
    where: { groupId: { in: mine.map((m) => m.groupId) }, accountId: { not: null, notIn: [accountId] }, OR: [{ addedBy: "" }, { seenAt: { not: null } }] },
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
    where: { accountId: ownerAccountId, OR: [{ addedBy: "" }, { seenAt: { not: null } }], group: { deletedAt: null, members: { some: { accountId: viewerAccountId } } } },
    select: { name: true },
  });
  if (!shared) return { ok: false as const, reason: "stranger" as const, name: undefined as string | undefined };
  const owner = await db.account.findUnique({ where: { id: ownerAccountId } });
  if (!owner) return { ok: false as const, reason: "stranger" as const, name: undefined as string | undefined };
  if (owner.passportShare === "private") return { ok: false as const, reason: "private" as const, name: shared.name as string | undefined };
  return { ok: true as const, owner, name: shared.name as string | undefined };
}

// New passport moments (5 countries, a new continent…) become one alert, with a
// phone notification if they get those. Each moment is celebrated once. Accounts
// from before this existed start from what they already have, without an alert.
const MARKS_FROM = Date.UTC(2026, 10, 11);
export async function celebrateMarks(account: { id: string; createdAt: Date; passportMarks: string }, marks: { id: string; title: string; body: string; ladder: string; n: number }[]) {
  try {
    const { newestMark } = await import("./passport");
    const fresh = account.passportMarks === "";
    const seen = new Set(account.passportMarks.split(" ").filter((x) => x && x !== "-"));
    const ids = marks.map((m) => m.id);
    if (ids.every((id) => seen.has(id)) && !fresh) return null;
    const next = [...new Set([...seen, ...ids])].join(" ") || "-";
    // Claim the change first, so two phones opening the passport at once alert once.
    const claimed = await db.account.updateMany({ where: { id: account.id, passportMarks: account.passportMarks }, data: { passportMarks: next } });
    if (!claimed.count || (fresh && account.createdAt.getTime() < MARKS_FROM)) return null;
    const mark = newestMark(marks as Parameters<typeof newestMark>[0], seen);
    if (!mark) return null;
    const { deliverNotes } = await import("./account-notes");
    await deliverNotes([{ accountIds: [account.id], kind: "passport_mark", title: mark.title, body: mark.body, url: "/passport", tag: `passport:${mark.id}` }]);
    return mark;
  } catch {
    return null; // a celebration must never break the page that found it
  }
}

// Evening check: everyone on a trip that started in the last two days (a
// started trip is a new stamp). Also run when someone adds countries by hand.
export async function celebrateRecentTrips(today: string, yesterday: string) {
  const members = await db.member.findMany({
    where: { accountId: { not: null }, leftAt: null, group: { type: "trip", deletedAt: null, tripStart: { in: [today, yesterday] } } },
    select: { accountId: true },
    take: 2000,
  });
  let sent = 0;
  for (const id of [...new Set(members.map((m) => m.accountId!))]) {
    const a = await db.account.findUnique({ where: { id } });
    if (!a) continue;
    const p = await loadPassport(a, a.homeCountry || "IN", today);
    if (await celebrateMarks(a, p.marks)) sent++;
  }
  return sent;
}
