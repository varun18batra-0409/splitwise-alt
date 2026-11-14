import { db } from "./db";
import { blockedEitherWay, isBlockedEitherWay } from "./blocks";
import { JOINED } from "./membership";
import { cleanNames } from "./names";
import { countryOf } from "./geo";
import { isDuplicateKey, previousResult } from "./once";
import { SHARE_ALL, SHARE_ROW_LIMIT, WISH_LIMIT, cleanCountries, cleanCountry, cleanScope, mutualMatches, visibleTo } from "./wishes";

// "Want to go", with the database. EVERY access check for the list is in this file:
//  - Your own list: only you.
//  - A friend sees one of your countries only if (1) a WishShare row for that country (or "*") exists, (2) you are in a group
//    together right now (both joined, neither left nor removed, the group not deleted) and (3) neither has blocked the other.
//    All three are checked on every read; a leftover row for someone who is no longer a friend shows nothing.
//  - You can share only with a current friend; a match needs both of you to have shared that country with each other.

const NOW = { ...JOINED, leftAt: null, removedAt: null }; // in the group right now

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

// The people you are in a group with right now (on Loopin, joined), without anyone blocked either way round.
// Stricter than passportFriends (which still counts people who left) and like loopinFriends plus "not removed".
export async function currentFriends(accountId: string): Promise<{ id: string; name: string }[]> {
  const mine = await db.member.findMany({ where: { accountId, ...NOW, group: { deletedAt: null } }, select: { groupId: true }, take: 500 });
  if (!mine.length) return [];
  const others = await db.member.findMany({
    where: { groupId: { in: mine.map((m) => m.groupId) }, accountId: { not: null }, ...NOW },
    select: { accountId: true, name: true },
    take: 3000,
  });
  const blocked = await blockedEitherWay(accountId);
  const ids = [...new Set(others.map((o) => o.accountId!).filter((id) => id !== accountId && !blocked.has(id)))];
  if (!ids.length) return [];
  const accounts = await db.account.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return accounts
    .map((a) => ({ id: a.id, name: cleanNames([a.name || others.find((o) => o.accountId === a.id)?.name || ""])[0] ?? "" }))
    .filter((a) => a.name)
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .slice(0, 200);
}

// Are these two in a group together right now, with no block between them?
export async function areCurrentFriends(a: string, b: string): Promise<boolean> {
  if (!a || !b || a === b) return false;
  if (await isBlockedEitherWay(a, b)) return false;
  const row = await db.member.findFirst({
    where: { accountId: b, ...NOW, group: { deletedAt: null, members: { some: { accountId: a, ...NOW } } } },
    select: { id: true },
  });
  return Boolean(row);
}

// ---------- Your own list ----------

export async function loadMyWishes(accountId: string): Promise<string[]> {
  const rows = await db.wishPlace.findMany({ where: { accountId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: WISH_LIMIT + 50, select: { country: true } });
  return rows.map((r) => r.country);
}

// Add places (country codes only). Past WISH_LIMIT it adds what fits and says the list is full. Adding one you already have is fine.
// One at a time: the database has no "skip duplicates" here, so a duplicate (P2002) just means it is already there.
export async function addWishes(accountId: string, raw: unknown[]): Promise<{ added: number; full: boolean }> {
  const wanted = cleanCountries(raw);
  const have = new Set(await loadMyWishes(accountId));
  let count = have.size;
  let added = 0;
  let full = false;
  for (const c of wanted) {
    if (have.has(c)) continue;
    if (count >= WISH_LIMIT) {
      full = true;
      break;
    }
    try {
      await db.wishPlace.create({ data: { accountId, country: c } });
      added++;
      count++;
      have.add(c);
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002") throw e; // already there (another tap, another phone): success
    }
  }
  return { added, full };
}

// Take one place off YOUR list, and stop sharing it. (Never touches anyone else's list.)
export async function removeWish(accountId: string, raw: unknown): Promise<boolean> {
  const country = cleanCountry(raw);
  if (!country) return false;
  await db.wishPlace.deleteMany({ where: { accountId, country } });
  await db.wishShare.deleteMany({ where: { ownerId: accountId, country } });
  return true;
}

// ---------- Sharing ----------

// Show one country (or the whole list, "*") to exactly these friends: ticked friends get a row, unticked ones lose theirs.
// Only current friends can be added (anyone else is skipped: no row at all). A country must be on your list.
export async function setShares(ownerId: string, rawScope: unknown, friendIds: string[]): Promise<{ ok: boolean; shared: number; error?: string }> {
  const scope = cleanScope(rawScope);
  if (!scope) return { ok: false, shared: 0, error: "Pick a country to share." };
  if (scope !== SHARE_ALL && !(await db.wishPlace.findUnique({ where: { accountId_country: { accountId: ownerId, country: scope } }, select: { id: true } })))
    return { ok: false, shared: 0, error: "That place isn’t on your list." };
  const friends = new Set((await currentFriends(ownerId)).map((f) => f.id));
  const want = [...new Set(friendIds.filter((id) => friends.has(id)))];
  await db.wishShare.deleteMany({ where: { ownerId, country: scope, friendId: { notIn: want } } });
  let rows = await db.wishShare.count({ where: { ownerId } });
  let shared = 0;
  for (const friendId of want) {
    if (rows >= SHARE_ROW_LIMIT) return { ok: false, shared, error: "You’re sharing with a lot of people already." };
    try {
      await db.wishShare.create({ data: { ownerId, friendId, country: scope } });
      rows++;
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002") throw e; // already shared with them
    }
    shared++;
  }
  return { ok: true, shared };
}

// What you have shown to whom, for the lock line and the share sheet. `now` = that friend can see it today; false = the
// row is kept but shows nothing until you are in a group together again.
export type MyShare = { friendId: string; name: string; country: string; now: boolean };
export async function mySharing(ownerId: string): Promise<MyShare[]> {
  const rows = await db.wishShare.findMany({ where: { ownerId }, select: { friendId: true, country: true }, take: SHARE_ROW_LIMIT });
  if (!rows.length) return [];
  const friends = new Map((await currentFriends(ownerId)).map((f) => [f.id, f.name]));
  const away = [...new Set(rows.map((r) => r.friendId).filter((id) => !friends.has(id)))];
  const names = away.length ? new Map((await db.account.findMany({ where: { id: { in: away } }, select: { id: true, name: true } })).map((a) => [a.id, cleanNames([a.name])[0] ?? "A friend"])) : new Map<string, string>();
  return rows.map((r) => ({ friendId: r.friendId, name: first(friends.get(r.friendId) ?? names.get(r.friendId) ?? "A friend"), country: r.country, now: friends.has(r.friendId) }));
}

// ---------- What others have shared with you ----------

export type SharedWithMe = { ownerId: string; name: string; countries: string[] };

// Friends' places that were shown to you, grouped by friend. Owners who are not current friends (or are blocked) are left out.
export async function sharedWithMe(viewerId: string): Promise<SharedWithMe[]> {
  const rows = await db.wishShare.findMany({ where: { friendId: viewerId }, select: { ownerId: true, country: true }, take: SHARE_ROW_LIMIT });
  if (!rows.length) return [];
  const friends = new Map((await currentFriends(viewerId)).map((f) => [f.id, f.name]));
  const owners = [...new Set(rows.map((r) => r.ownerId).filter((id) => friends.has(id)))];
  if (!owners.length) return [];
  const lists = await db.wishPlace.findMany({ where: { accountId: { in: owners } }, select: { accountId: true, country: true }, take: owners.length * WISH_LIMIT });
  const out: SharedWithMe[] = [];
  for (const ownerId of owners) {
    const countries = visibleTo(
      lists.filter((l) => l.accountId === ownerId).map((l) => l.country),
      rows.filter((r) => r.ownerId === ownerId).map((r) => r.country),
      true,
    );
    if (countries.length) out.push({ ownerId, name: first(friends.get(ownerId)!), countries });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export type Match = { friendId: string; name: string; countries: string[] };

// "You and Nupur both want to go": countries on both lists that each of you has shown the other.
export async function matches(viewerId: string): Promise<Match[]> {
  const friends = await currentFriends(viewerId);
  if (!friends.length) return [];
  const ids = friends.map((f) => f.id);
  const [mine, outRows, inRows, theirLists] = await Promise.all([
    loadMyWishes(viewerId),
    db.wishShare.findMany({ where: { ownerId: viewerId, friendId: { in: ids } }, select: { friendId: true, country: true }, take: SHARE_ROW_LIMIT }),
    db.wishShare.findMany({ where: { friendId: viewerId, ownerId: { in: ids } }, select: { ownerId: true, country: true }, take: SHARE_ROW_LIMIT }),
    db.wishPlace.findMany({ where: { accountId: { in: ids } }, select: { accountId: true, country: true }, take: ids.length * WISH_LIMIT }),
  ]);
  const out: Match[] = [];
  for (const f of friends) {
    const countries = mutualMatches(
      mine,
      outRows.filter((r) => r.friendId === f.id).map((r) => r.country),
      theirLists.filter((l) => l.accountId === f.id).map((l) => l.country),
      inRows.filter((r) => r.ownerId === f.id).map((r) => r.country),
    );
    if (countries.length) out.push({ friendId: f.id, name: first(f.name), countries });
  }
  return out;
}

// ---------- Plan together ----------

// A trip group for this country that you are in now and your friend is in (or was invited to and has not turned down).
// Until they tap Join an invited friend is only a name in the group, so the invitation counts too.
export async function findSharedTrip(accountId: string, friendId: string, country: string): Promise<{ groupId: string; memberId: string } | null> {
  const friendEmail = (await db.account.findUnique({ where: { id: friendId }, select: { email: true } }))?.email ?? "";
  const g = await db.group.findFirst({
    where: {
      type: "trip",
      tripCountry: country,
      deletedAt: null,
      members: { some: { accountId, ...NOW } },
      AND: [{ OR: [{ members: { some: { accountId: friendId, removedAt: null } } }, { invites: { some: { email: friendEmail, declinedAt: null } } }] }],
    },
    select: { id: true, members: { where: { accountId }, select: { id: true } } },
    orderBy: { createdAt: "desc" },
  });
  return g?.members[0] ? { groupId: g.id, memberId: g.members[0].id } : null;
}

// For the match cards: which matches already have a trip ("Open your Japan trip"). Keys are "friendId|CC".
export async function existingPlans(accountId: string, ms: Match[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const m of ms.slice(0, 20)) for (const c of m.countries.slice(0, 20)) {
    const t = await findSharedTrip(accountId, m.friendId, c);
    if (t) out[`${m.friendId}|${c}`] = t.groupId;
  }
  return out;
}

export type PlanResult = { ok: true; groupId: string; memberId: string; existing: boolean } | { ok: false; error: string };

// "Plan together": a new trip group named after the country, and the friend invited the normal way (Join / Not now).
// Checked again here, whatever the button said: the match, the friendship and the blocks. The same request key twice makes one
// group. If you two already have a trip group for that country, that group is returned instead ("Open your Japan trip").
export async function planTogether(account: { id: string; name: string }, friendId: string, rawCountry: unknown, opts: { key?: string; origin: string; later?: (job: () => Promise<unknown>) => void }): Promise<PlanResult> {
  const country = cleanCountry(rawCountry);
  const refuse = { ok: false as const, error: "You can plan together once you both want to go and have shared it." };
  if (!country || !friendId || friendId === account.id) return refuse;
  if (!(await areCurrentFriends(account.id, friendId))) return refuse;
  if (!(await matches(account.id)).some((m) => m.friendId === friendId && m.countries.includes(country))) return refuse;

  // A trip for this country that you are both in already.
  const there = await findSharedTrip(account.id, friendId, country);
  if (there) return { ok: true, groupId: there.groupId, memberId: there.memberId, existing: true };

  // The same tap twice (or two phones) makes one group.
  const key = opts.key;
  if (key) {
    const prev = await previousResult(key);
    if (prev !== null) {
      if (!prev) return { ok: false, error: "Making your trip… give it a moment." };
      const g = await db.group.findFirst({ where: { id: prev, deletedAt: null }, select: { id: true, members: { where: { accountId: account.id }, select: { id: true } } } });
      return g?.members[0] ? { ok: true, groupId: g.id, memberId: g.members[0].id, existing: true } : refuse;
    }
    const claimed = await db.requestKey.create({ data: { key, result: "" } }).then(() => true, (e) => (isDuplicateKey(e) ? false : Promise.reject(e)));
    if (!claimed) return { ok: false, error: "Making your trip… give it a moment." };
  }
  const { createGroupFor } = await import("./group-setup");
  const { addRegistered, copyPushTo } = await import("./invites");
  const name = cleanNames([account.name])[0];
  if (!name) {
    if (key) await db.requestKey.deleteMany({ where: { key, result: "" } }).catch(() => undefined);
    return { ok: false, error: "Add your name first, so your friend knows who is asking." };
  }
  let group;
  try {
    group = await createGroupFor(account, { type: "trip", name: countryOf(country)!.name, yourName: name, currency: "INR", tripCountry: country, tripPlace: "" });
  } catch (err) {
    if (key) await db.requestKey.deleteMany({ where: { key, result: "" } }).catch(() => undefined);
    throw err;
  }
  if (key) await db.requestKey.update({ where: { key }, data: { result: group.id } }).catch(() => undefined);
  const me = group.members[0];
  await copyPushTo(account.id, me.id);
  // The group is made either way; if the invitation could not go out, you can invite from the group (no half-made state to undo).
  await addRegistered(group.id, me.id, friendId, opts.origin, opts.later ? { later: opts.later } : {});
  return { ok: true, groupId: group.id, memberId: me.id, existing: false };
}
