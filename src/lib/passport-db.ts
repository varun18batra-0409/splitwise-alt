import { db } from "./db";
import { NOT_DIRECT } from "./direct"; // a pair of two people is not "sharing a group"
import { JOINED, isPending } from "./membership";
import { blockedEitherWay, isBlockedEitherWay } from "./blocks";
import { buildPassport, parseHandPlaces, passportShared, passportZone, tripOver, undatedTripDay, wentOnTrip, type PassportTrip } from "./passport";
import { leaverCut, leaverWhere, membershipSpan, overlapped, sharedGroupRow } from "./left-view";
import { memberHistory } from "./left-view-db";
import type { Prisma } from "@prisma/client";
import type { TripExtras } from "./passport-cards";

// Someone the admin removed stops counting for passport sharing (both ways); someone who left on their own still counts.
const COUNTS = { ...JOINED, removedAt: null };

// Record the owner's answer (the "Show" / "Not now" buttons, and the Who can see it switch).
// Either way the answer is stamped, so the question is never asked again.
export async function recordPassportChoice(accountId: string, show: boolean) {
  await db.account.update({ where: { id: accountId }, data: { passportShare: show ? "groups" : "private", passportChoiceAt: new Date() } });
}

// "Our passports" for one group: who is listed, from the viewer's side. The same rule as canSeePassport:
// the viewer must have really joined and not been removed (else null: the screen sends them away), and the
// list holds only people who have really joined and were not removed (plus the viewer). Someone who
// left on their own still counts. Hiding a passport ("private") is decided per person by the screen.
type RosterMember = { id: string; addedBy: string; seenAt: Date | null; removedAt: Date | null };
export function passportRoster<T extends RosterMember>(members: T[], viewerId: string): T[] | null {
  const me = members.find((m) => m.id === viewerId);
  if (!me || isPending(me) || me.removedAt) return null;
  return members.filter((m) => m.id === viewerId || (!isPending(m) && !m.removedAt));
}

// The spending an undated trip's stamp rests on, as one database filter: not deleted, not a card-game result, and (for someone who
// left or was removed) only what they may see: added on or before the day they left, or with them in it.
export function undatedSpendingWhere(groupId: string, me: { id: string; leftAt: Date | null; removedAt?: Date | null }): Prisma.ExpenseWhereInput {
  const cut = leaverCut(me);
  return {
    groupId,
    deletedAt: null,
    kind: { not: "pot" },
    ...(cut ? { AND: [leaverWhere(me.id, cut.leftAt, { expenseIds: [], paymentIds: [] }).expenses] } : {}),
  };
}

// For each undated trip: how many rows of spending this person may see and the day of the latest (null = none, so no stamp).
// Home and the passport both read this, so they always agree. (The pure twin is undatedFacts in passport.ts.)
export async function undatedTripFacts(
  rows: { groupId: string; me: { id: string; leftAt: Date | null; removedAt?: Date | null } }[],
  tz: string,
): Promise<Map<string, { count: number; day: string } | null>> {
  const out = new Map<string, { count: number; day: string } | null>();
  for (const r of rows) {
    const where = undatedSpendingWhere(r.groupId, r.me);
    const count = await db.expense.count({ where });
    if (!count) {
      out.set(r.groupId, null);
      continue;
    }
    const latest = await db.expense.findFirst({ where, select: { spentAt: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    out.set(r.groupId, latest ? { count, day: undatedTripDay(latest, tz) } : null);
  }
  return out;
}

// Your passport, from every trip group you're in (any phone you signed in on).
export async function loadPassport(account: { id: string; homeCountry: string; places: string; timeZone: string }, fallbackHome: string, today: string, opts: { forFriend?: boolean; withMoments?: boolean } = {}) {
  const groups = await db.group.findMany({
    where: { type: "trip", deletedAt: null, members: { some: { accountId: account.id, ...JOINED } } }, // added-but-never-opened trips don't count; people who left still do
    select: {
      id: true, name: true, tripStart: true, tripEnd: true, tripPlace: true, tripCountry: true, createdAt: true,
      _count: { select: { members: true } },
      // Your own row (did you leave before the trip? when were you in it?).
      members: { where: { accountId: account.id }, select: { id: true, leftAt: true, removedAt: true, createdAt: true, claimedAt: true, seenAt: true } },
    },
    orderBy: [{ tripStart: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  const tz = passportZone(account);
  // A trip without dates counts once something was spent that you may see, from its latest spending (not the group's creation: a
  // flight booked early isn't a stamp yet). Game results and deleted rows don't count; someone who left sees only what was added
  // up to the day they left, or what has them in it.
  // (A dated trip with no end day is also read for a friend: it is over 3 days after its latest spending, not the day after it starts.)
  const facts = await undatedTripFacts(
    groups.filter((g) => !g.tripStart || (opts.forFriend && !g.tripEnd)).map((g) => ({ groupId: g.id, me: g.members.find((m) => !m.leftAt && !m.removedAt) ?? g.members[0] })).filter((x) => x.me),
    tz,
  );
  // Seen by a friend: only trips that are over (a trip happening now would say where you are today).
  // (A trip without an end day counts as over once nothing has been spent for 3 days: spending today would otherwise tell a friend
  // where you are now. See tripOver.)
  const over = (g: (typeof groups)[number]) => tripOver({ tripStart: g.tripStart, tripEnd: g.tripEnd }, facts.get(g.id)?.day, today);
  // Someone who left before the trip began (in their own time zone) didn't go. (Only a real start day counts: an undated trip has none to miss.)
  const went = (g: (typeof groups)[number]) => g.members.some((m) => wentOnTrip(g.tripStart, m.leftAt, tz));
  // Who was there with you: only people whose time in the group overlapped yours (not someone who joined after you left, and not
  // people added but never opened it, or removed). Your own view only: a friend is never shown the count. (SB-5)
  const owner = new Map(groups.map((g) => [g.id, g.members.find((m) => !m.leftAt && !m.removedAt) ?? g.members[0]]));
  const together = new Map<string, { name: string; accountId: string | null }[]>();
  if (!opts.forFriend && groups.length) {
    const [rows, history] = await Promise.all([
      db.member.findMany({
        where: { groupId: { in: groups.map((g) => g.id) }, ...COUNTS },
        select: { id: true, groupId: true, name: true, accountId: true, createdAt: true, claimedAt: true, seenAt: true, leftAt: true, removedAt: true },
        orderBy: { createdAt: "asc" },
        take: 6000,
      }),
      memberHistory(groups.map((g) => g.id)), // leaving and coming back leaves a gap that isn't time together
    ]);
    for (const r of rows) {
      const me = owner.get(r.groupId);
      if (!me || (r.accountId && r.accountId === account.id) || !overlapped(membershipSpan(me, history.get(me.id)), membershipSpan(r, history.get(r.id)))) continue;
      (together.get(r.groupId) ?? together.set(r.groupId, []).get(r.groupId)!).push({ name: r.name, accountId: r.accountId });
    }
  }
  const trips: PassportTrip[] = groups.filter((g) => (g.tripStart || facts.get(g.id)) && went(g) && (!opts.forFriend || over(g))).map((g) => ({
    groupId: g.id,
    name: g.name,
    start: g.tripStart || facts.get(g.id)!.day,
    end: g.tripEnd,
    place: g.tripPlace,
    country: g.tripCountry,
    people: opts.forFriend ? g._count.members : (together.get(g.id)?.length ?? 0) + 1, // the others who overlapped, plus you
    undated: !g.tripStart,
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
  // Your own view only: who else went, for the faces on each trip card (never shown to a friend).
  const extras: Record<string, TripExtras> = {};
  // Only for groups you are still part of the story of: not one you were removed from (their people are none of your business now),
  // and only people who really joined and weren't removed themselves.
  const stillIn = new Set(groups.filter((g) => g.members.some((m) => !m.removedAt)).map((g) => g.id));
  const faceGroups = trips.map((t) => t.groupId).filter((id) => stillIn.has(id));
  if (!opts.forFriend && faceGroups.length) {
    const blocked = await blockedEitherWay(account.id);
    for (const id of faceGroups) {
      for (const o of together.get(id) ?? []) {
        if (o.accountId && blocked.has(o.accountId)) continue;
        const first = o.name.trim().split(/\s+/)[0];
        if (!first) continue;
        const x = (extras[id] ??= { names: [] });
        if (x.names.length < 3) x.names.push(first);
      }
    }
  }
  // Your own view only: how many moments you can see in each recent trip (decides "View memories" on its card). The same
  // access rules as the moments page: loadMomentViewer + momentStrip. Only the 12 newest trips (the cards shown first).
  if (opts.withMoments && !opts.forFriend) {
    const { loadMomentViewer } = await import("./moments-access");
    const { momentStrip } = await import("./moments-db");
    const newest = [...trips].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 12);
    for (const t of newest) {
      const mine = groups.find((g) => g.id === t.groupId)?.members[0];
      if (!mine || mine.removedAt) continue;
      try {
        const n = (await momentStrip(await loadMomentViewer(t.groupId, mine.id))).count;
        if (n > 0) (extras[t.groupId] ??= { names: [] }).moments = n;
      } catch {
        // a card must never break the page: no count means "Relive trip"
      }
    }
  }
  return { ...passport, home, unplaced, trips, extras };
}

// Everyone you've shared a group with at some point (they may have left since),
// who's on Loopin: the people whose passports you can open. Deleted groups don't count.
export async function passportFriends(accountId: string) {
  // (Your own row must be joined too: a group someone added you to but you never opened shows you nobody.)
  const SPAN = { createdAt: true, claimedAt: true, seenAt: true, leftAt: true, removedAt: true } as const;
  const mine = await db.member.findMany({ where: { accountId, ...COUNTS, group: { ...NOT_DIRECT, deletedAt: null } }, select: { id: true, groupId: true, ...SPAN }, take: 500 });
  if (!mine.length) return [];
  const [others, history] = await Promise.all([
    db.member.findMany({
      // Someone added straight in by another person counts once they've opened that group.
      where: { groupId: { in: mine.map((m) => m.groupId) }, accountId: { not: null, notIn: [accountId] }, ...COUNTS },
      select: { id: true, accountId: true, name: true, groupId: true, group: { select: { name: true } }, ...SPAN },
      take: 3000,
    }),
    memberHistory(mine.map((m) => m.groupId)),
  ]);
  const by = new Map<string, { accountId: string; name: string; groups: string[] }>();
  const blocked = await blockedEitherWay(accountId);
  for (const o of others) {
    if (blocked.has(o.accountId!)) continue;
    // Only people who were in that group at the same time as you (not someone who joined after you left, or left before you joined).
    if (!mine.some((m) => m.groupId === o.groupId && overlapped(membershipSpan(m, history.get(m.id)), membershipSpan(o, history.get(o.id))))) continue;
    const f = by.get(o.accountId!) ?? { accountId: o.accountId!, name: o.name, groups: [] };
    if (!f.groups.includes(o.group.name)) f.groups.push(o.group.name);
    by.set(o.accountId!, f);
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

// May this person open that person's passport? Only if they've shared a group
// (not deleted) and both really joined it (neither is still "added by someone, never opened it"
// or removed by the admin; leaving on your own later doesn't matter), and the owner has said yes (no recorded answer counts as no).
export async function canSeePassport(viewerAccountId: string, ownerAccountId: string) {
  if (viewerAccountId === ownerAccountId) return { ok: true as const, owner: await db.account.findUnique({ where: { id: ownerAccountId } }), name: undefined as string | undefined };
  // A block between the two (either way round) closes the door; it looks the same as not sharing a group.
  if (await isBlockedEitherWay(viewerAccountId, ownerAccountId)) return { ok: false as const, reason: "stranger" as const, name: undefined as string | undefined };
  // Both must have been in a shared group AT THE SAME TIME (someone who left before the other joined was never there with them).
  const SPAN = { createdAt: true, claimedAt: true, seenAt: true, leftAt: true, removedAt: true } as const;
  const ownerRows = await db.member.findMany({
    where: { accountId: ownerAccountId, ...COUNTS, group: { ...NOT_DIRECT, deletedAt: null, members: { some: { accountId: viewerAccountId, ...COUNTS } } } },
    select: { id: true, name: true, groupId: true, ...SPAN },
    take: 500,
  });
  const viewerRows = ownerRows.length ? await db.member.findMany({ where: { accountId: viewerAccountId, ...COUNTS, groupId: { in: ownerRows.map((r) => r.groupId) } }, select: { id: true, groupId: true, ...SPAN }, take: 500 }) : [];
  // (Someone who left and was brought back was away in between: that gap is not time together.)
  const history = ownerRows.length ? await memberHistory([...new Set(ownerRows.map((r) => r.groupId))]) : new Map();
  const shared = sharedGroupRow(ownerRows, viewerRows, (r) => membershipSpan(r, history.get((r as { id?: string }).id ?? "")));
  if (!shared) return { ok: false as const, reason: "stranger" as const, name: undefined as string | undefined };
  const owner = await db.account.findUnique({ where: { id: ownerAccountId } });
  if (!owner) return { ok: false as const, reason: "stranger" as const, name: undefined as string | undefined };
  if (!passportShared(owner)) return { ok: false as const, reason: (owner.passportShare === "private" ? "private" : "unanswered") as "private" | "unanswered", name: shared.name as string | undefined };
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
