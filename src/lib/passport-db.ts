import { db } from "./db";
import { NOT_DIRECT } from "./direct"; // a pair of two people is not "sharing a group"
import { JOINED, isPending } from "./membership";
import { blockedEitherWay, isBlockedEitherWay } from "./blocks";
import { countryForCurrency } from "./region";
import { buildPassport, parseHandPlaces, passportShared, passportZone, tripOver, undatedTripDay, wentOnTrip, type PassportTrip } from "./passport";
import { leaverCut, leaverWhere, membershipSpan, overlapped, sharedGroupRow } from "./left-view";
import { memberHistory } from "./left-view-db";
import type { Prisma } from "@prisma/client";
import type { TripExtras } from "./passport-cards";

// Someone the admin removed stops counting for passport sharing (both ways); someone who left on their own still counts.
const COUNTS = { ...JOINED, removedAt: null };

// One-time default for accounts made before the home country was saved at sign-up: the currency of the person's own
// non-trip groups (the most-used one) when it points to exactly one country (rupees: India; euros are many countries, so they stay unknown).
// A tie or no such group leaves it unknown. Kept in this one place behind one switch so it is easy to find and to turn off.
export const HOME_FROM_OWN_GROUPS = true;
export async function ensureHomeCountry<T extends { id: string; homeCountry: string }>(account: T): Promise<T> {
  if (account.homeCountry || !HOME_FROM_OWN_GROUPS) return account;
  const rows = await db.member.findMany({
    where: { accountId: account.id, ...JOINED, leftAt: null, removedAt: null, group: { deletedAt: null, type: { notIn: ["trip", "direct"] } } },
    select: { group: { select: { currency: true } } },
    take: 500,
  });
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.group.currency, (n.get(r.group.currency) ?? 0) + 1);
  const ranked = [...n.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0][1])) return account;
  const country = countryForCurrency(ranked[0][0]);
  if (!country) return account;
  // Only fills an empty value, so a country chosen at the same moment is never overwritten.
  await db.account.updateMany({ where: { id: account.id, homeCountry: "" }, data: { homeCountry: country } });
  return { ...account, homeCountry: country };
}

// Record the owner's answer (the "Show" / "Not now" buttons, and the Who can see it switch).
// Either way the answer is stamped, so the question is never asked again.
export async function recordPassportChoice(accountId: string, show: boolean) {
  await db.account.update({ where: { id: accountId }, data: { passportShare: show ? "groups" : "private", passportChoiceAt: new Date() } });
}

// "Our passports" for one group: who is listed, from the viewer's side. The same rule as canSeePassport:
// the viewer must have really joined and not been removed (else null: the screen sends them away), and the
// list holds only people who have really joined and were not removed (plus the viewer). Someone who
// left on their own still counts, and if the viewer is that someone, only people who joined by the day they left. Hiding a passport ("private") is decided per person by the screen.
type RosterMember = { id: string; addedBy: string; seenAt: Date | null; removedAt: Date | null; createdAt?: Date; leftAt?: Date | null };
export function passportRoster<T extends RosterMember>(members: T[], viewerId: string): T[] | null {
  const me = members.find((m) => m.id === viewerId);
  if (!me || isPending(me) || me.removedAt) return null;
  // Someone who left on their own sees only the people who were in the group by the day they left (the same rule as membersAsOf in
  // left-view.ts): nobody who joined after they left.
  const day = me.leftAt ? me.leftAt.getTime() : null;
  return members.filter((m) => m.id === viewerId || (!isPending(m) && !m.removedAt && (day === null || !m.createdAt || m.createdAt.getTime() <= day)));
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

type SpendingMe = { id: string; leftAt: Date | null; removedAt?: Date | null };
type RawFact = { count: number; latest: { spentAt: Date | null; createdAt: Date } | null };
const UNDATED_BATCH = 40; // trips asked about in one query (keeps the number of values in one query small)

// Rows with the same filter share one answer. (A leaver's filter depends on who they are and when they left.)
const undatedKey = (groupId: string, me: SpendingMe) => {
  const cut = leaverCut(me);
  return cut ? `${groupId}|${me.id}|${cut.leftAt.getTime()}` : groupId;
};

// The counts and latest rows for many undated trips at once: one grouped count and one read of the latest rows per batch, instead of
// two queries per trip. Each trip keeps its OWN filter (a leaver's cut is per group and per person): the filters are joined with OR, and
// a batch never holds two filters for the same group, so the grouping by group can't mix them up.
async function undatedRaw(rows: { groupId: string; me: SpendingMe }[]): Promise<Map<string, RawFact>> {
  const out = new Map<string, RawFact>();
  const todo = new Map<string, { groupId: string; where: Prisma.ExpenseWhereInput }>();
  for (const r of rows) {
    const key = undatedKey(r.groupId, r.me);
    if (!todo.has(key)) todo.set(key, { groupId: r.groupId, where: undatedSpendingWhere(r.groupId, r.me) });
  }
  const left = [...todo.entries()];
  while (left.length) {
    const batch: [string, { groupId: string; where: Prisma.ExpenseWhereInput }][] = [];
    const used = new Set<string>();
    for (let i = 0; i < left.length && batch.length < UNDATED_BATCH; ) {
      if (used.has(left[i][1].groupId)) i++;
      else {
        used.add(left[i][1].groupId);
        batch.push(left[i]);
        left.splice(i, 1);
      }
    }
    const counts = await db.expense.groupBy({ by: ["groupId"], where: { OR: batch.map(([, e]) => e.where) }, _count: { _all: true }, _max: { createdAt: true } });
    const byGroup = new Map(counts.map((c) => [c.groupId, c]));
    const withRows = batch.filter(([, e]) => (byGroup.get(e.groupId)?._count._all ?? 0) > 0);
    for (const [key, e] of batch) if (!withRows.some(([k]) => k === key)) out.set(key, { count: 0, latest: null });
    if (!withRows.length) continue;
    // The latest row of each trip: the newest createdAt, and among those the highest id (as the one-trip read ordered them).
    const latestRows = await db.expense.findMany({
      where: { OR: withRows.map(([, e]) => ({ AND: [e.where, { createdAt: byGroup.get(e.groupId)!._max.createdAt! }] })) },
      select: { groupId: true, id: true, spentAt: true, createdAt: true },
    });
    const best = new Map<string, (typeof latestRows)[number]>();
    for (const r of latestRows) {
      const cur = best.get(r.groupId);
      if (!cur || r.id > cur.id) best.set(r.groupId, r);
    }
    for (const [key, e] of withRows) {
      const b = best.get(e.groupId);
      out.set(key, { count: byGroup.get(e.groupId)!._count._all, latest: b ? { spentAt: b.spentAt, createdAt: b.createdAt } : null });
    }
  }
  return out;
}

function undatedFactsFrom(raw: Map<string, RawFact>, rows: { groupId: string; me: SpendingMe }[], tz: string): Map<string, { count: number; day: string } | null> {
  const out = new Map<string, { count: number; day: string } | null>();
  for (const r of rows) {
    const f = raw.get(undatedKey(r.groupId, r.me));
    out.set(r.groupId, f && f.count && f.latest ? { count: f.count, day: undatedTripDay(f.latest, tz) } : null);
  }
  return out;
}

// For each undated trip: how many rows of spending this person may see and the day of the latest (null = none, so no stamp).
// Home and the passport both read this, so they always agree. (The pure twin is undatedFacts in passport.ts.)
export async function undatedTripFacts(rows: { groupId: string; me: SpendingMe }[], tz: string): Promise<Map<string, { count: number; day: string } | null>> {
  return undatedFactsFrom(await undatedRaw(rows), rows, tz);
}

type PassportAccount = { id: string; homeCountry: string; places: string; timeZone: string };
type PassportGroup = {
  id: string; name: string; tripStart: string; tripEnd: string; tripPlace: string; tripCountry: string; createdAt: Date;
  _count: { members: number };
  members: { id: string; leftAt: Date | null; removedAt: Date | null; createdAt: Date; claimedAt: Date | null; seenAt: Date | null; seenEventsAt: Date | null }[]; // this account's own rows (the dates say when they were in the group)
};
// A trip whose stamp rests on its spending, and the row to judge it by: the account's still-in row if any, else its first row.
// (A dated trip with no end day is also read for a friend: it is over 3 days after its latest spending, not the day after it starts.)
const undatedRowsOf = (groups: PassportGroup[], forFriend: boolean) =>
  groups.filter((g) => !g.tripStart || (forFriend && !g.tripEnd)).map((g) => ({ groupId: g.id, me: g.members.find((m) => !m.leftAt && !m.removedAt) ?? g.members[0] })).filter((x) => x.me);

const PASSPORT_ORDER: Prisma.GroupOrderByWithRelationInput[] = [{ tripStart: "desc" }, { createdAt: "desc" }, { id: "asc" }];
const PASSPORT_SELECT = { id: true, name: true, tripStart: true, tripEnd: true, tripPlace: true, tripCountry: true, createdAt: true, _count: { select: { members: true } } } satisfies Prisma.GroupSelect;
const PASSPORT_MAX = 300;

// The passport as Our passports compares it: everyone, the viewer included, by the friend's rule (a trip still going on is not in it),
// so the same trip counts the same way for every person in the list.
export async function loadComparePassport(account: { id: string; homeCountry: string; places: string; timeZone: string }, today: string) {
  return loadPassport(account, today, { forFriend: true });
}

// Your passport, from every trip group you're in (any phone you signed in on).
export async function loadPassport(account: PassportAccount, today: string, opts: { forFriend?: boolean; withMoments?: boolean } = {}) {
  return passportFrom(account, today, opts);
}

// The passports of several people at once, as seen by a friend (what loadPassport(a, today, { forFriend: true }) gives for each,
// in the same order). One read of all their trips and one batched read of the undated trips' spending, instead of that per person.
// Everything after the reads is the same code as loadPassport, so the numbers and what is hidden (a leaver's own cut, trips
// still going on) can't differ.
export async function passportsForFriends(accounts: PassportAccount[], today: string) {
  if (!accounts.length) return [];
  const ids = accounts.map((a) => a.id);
  const all = await db.group.findMany({
    where: { type: "trip", deletedAt: null, members: { some: { accountId: { in: ids }, ...JOINED } } },
    select: { ...PASSPORT_SELECT, members: { where: { accountId: { in: ids } }, select: { id: true, leftAt: true, removedAt: true, createdAt: true, claimedAt: true, seenAt: true, seenEventsAt: true, accountId: true, addedBy: true } } },
    orderBy: PASSPORT_ORDER,
  });
  const per = accounts.map((a) => {
    const groups: PassportGroup[] = [];
    for (const g of all) {
      const mine = g.members.filter((m) => m.accountId === a.id);
      if (!mine.some((m) => !isPending(m))) continue; // (JOINED, as the database filter says it)
      groups.push({ ...g, members: mine.map((m) => ({ id: m.id, leftAt: m.leftAt, removedAt: m.removedAt, createdAt: m.createdAt, claimedAt: m.claimedAt, seenAt: m.seenAt, seenEventsAt: m.seenEventsAt })) });
      if (groups.length >= PASSPORT_MAX) break;
    }
    return groups;
  });
  const rowsPer = per.map((g) => undatedRowsOf(g, true));
  const raw = await undatedRaw(rowsPer.flat());
  return Promise.all(accounts.map((a, i) => passportFrom(a, today, { forFriend: true }, { groups: per[i], facts: undatedFactsFrom(raw, rowsPer[i], passportZone(a)) })));
}

async function passportFrom(
  account: PassportAccount,
  today: string,
  opts: { forFriend?: boolean; withMoments?: boolean },
  pre?: { groups: PassportGroup[]; facts: Map<string, { count: number; day: string } | null> },
) {
  const groups: PassportGroup[] =
    pre?.groups ??
    (await db.group.findMany({
      where: { type: "trip", deletedAt: null, members: { some: { accountId: account.id, ...JOINED } } }, // added-but-never-opened trips don't count; people who left still do
      select: {
        ...PASSPORT_SELECT,
        // Your own row (did you leave before the trip? when were you in it?).
        members: { where: { accountId: account.id }, select: { id: true, leftAt: true, removedAt: true, createdAt: true, claimedAt: true, seenAt: true, seenEventsAt: true } },
      },
      orderBy: PASSPORT_ORDER,
      take: PASSPORT_MAX,
    }));
  const tz = passportZone(account);
  // A trip without dates counts once something was spent that you may see, from its latest spending (not the group's creation: a
  // flight booked early isn't a stamp yet). Game results and deleted rows don't count; someone who left sees only what was added
  // up to the day they left, or what has them in it.
  // (A dated trip with no end day is also read for a friend: it is over 3 days after its latest spending, not the day after it starts.)
  const facts = pre?.facts ?? (await undatedTripFacts(undatedRowsOf(groups, Boolean(opts.forFriend)), tz));
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
        select: { id: true, groupId: true, name: true, accountId: true, createdAt: true, claimedAt: true, seenAt: true, seenEventsAt: true, leftAt: true, removedAt: true },
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
  // Only the home country saved on the account: never guessed from where the phone is. Unknown ("") is handled in buildPassport.
  const home = account.homeCountry;
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
    // All at once (each check is a few trips to the database; one trip after another they added up). The rules are unchanged.
    const counts = await Promise.all(
      newest.map(async (t) => {
        const mine = groups.find((g) => g.id === t.groupId)?.members[0];
        if (!mine || mine.removedAt) return null;
        try {
          return (await momentStrip(await loadMomentViewer(t.groupId, mine.id))).count;
        } catch {
          return null; // a card must never break the page: no count means "Relive trip"
        }
      }),
    );
    newest.forEach((t, i) => {
      const n = counts[i];
      if (n !== null && n > 0) (extras[t.groupId] ??= { names: [] }).moments = n;
    });
  }
  return { ...passport, home, unplaced, trips, extras };
}

// Everyone you've shared a group with at some point (they may have left since),
// who's on Loopin: the people whose passports you can open. Deleted groups don't count.
export async function passportFriends(accountId: string) {
  // (Your own row must be joined too: a group someone added you to but you never opened shows you nobody.)
  const SPAN = { createdAt: true, claimedAt: true, seenAt: true, seenEventsAt: true, leftAt: true, removedAt: true } as const;
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
  const SPAN = { createdAt: true, claimedAt: true, seenAt: true, seenEventsAt: true, leftAt: true, removedAt: true } as const;
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
    const found = await db.account.findUnique({ where: { id } });
    if (!found) continue;
    const a = await ensureHomeCountry(found);
    // With no home country saved, nothing is abroad (buildPassport's unknown-home rule), so there are no abroad milestones to celebrate.
    const p = await loadPassport(a, today);
    if (await celebrateMarks(a, p.marks)) sent++;
  }
  return sent;
}
