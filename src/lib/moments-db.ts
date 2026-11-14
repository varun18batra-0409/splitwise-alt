import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { JOINED } from "./membership";
import { blockedEitherWay } from "./blocks";
import { ALL_REACTIONS } from "./reactions";
import { dayLabel, momentAuthor } from "./moments-text";
import { MOMENTS_PER_GROUP, MOMENTS_PER_PERSON_PER_DAY } from "./covers";
import { claimKey, isDuplicateKey } from "./once";
import { canSeeMoment, canOpenMoments, type MomentViewer } from "./moments-access";
import { MEMORY_MAX, pickMemories, type HomeMemory, type MemoryGroup } from "./home/memories";

// Moments in the database. Nothing here decides who may see a moment: callers pass a MomentViewer (loadMomentViewer) and every
// row that is returned has gone through canSeeMoment. The photo bytes are never loaded by these lists (only by the photo route).

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export const momentPhotoSrc = (id: string, size: "t" | "f") => `/api/moment-photo/${id}?s=${size}`;

// Everything about a moment except the photo itself.
export const MOMENT_FIELDS = { id: true, groupId: true, authorId: true, authorAccountId: true, caption: true, takenOn: true, type: true, width: true, height: true, blobKey: true, thumbKey: true, createdAt: true } satisfies Prisma.MomentSelect;
export type MomentRow = Prisma.MomentGetPayload<{ select: typeof MOMENT_FIELDS }>;

export type MomentCard = {
  id: string;
  groupId: string;
  authorId: string;
  authorAccountId: string;
  authorName: string; // "You" for your own
  authorInitial: string;
  authorIsMe: boolean;
  caption: string;
  takenOn: string;
  day: string; // "Day 3" or ""
  width: number;
  height: number;
  createdAt: Date;
  thumb: string;
  full: string;
  reactions: { emoji: string; count: number; mine: boolean }[];
};

// Which rows this person may see, as a database filter (canSeeMoment is still run on every row that comes back).
export function momentsWhere(v: MomentViewer): Prisma.MomentWhereInput {
  const hidden = [...v.blocked].filter((a) => a !== v.accountId);
  return {
    groupId: v.groupId,
    ...(v.leftAt ? { createdAt: { lte: v.leftAt } } : {}),
    ...(hidden.length ? { authorAccountId: { notIn: hidden } } : {}),
  };
}

export async function loadMomentRow(id: string): Promise<MomentRow | null> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return null;
  return db.moment.findUnique({ where: { id }, select: MOMENT_FIELDS });
}

type GroupDays = { tripStart: string; tripEnd: string };

async function cards(v: MomentViewer, rows: MomentRow[], g: GroupDays): Promise<MomentCard[]> {
  const seen = rows.filter((r) => canSeeMoment(v, r));
  if (!seen.length) return [];
  const [members, reacts] = await Promise.all([
    db.member.findMany({ where: { groupId: v.groupId }, select: { id: true, name: true, accountId: true } }),
    db.momentReaction.findMany({ where: { momentId: { in: seen.map((r) => r.id) } }, select: { momentId: true, memberId: true, emoji: true } }),
  ]);
  const byId = new Map(members.map((m) => [m.id, m]));
  // Reactions from people who are blocked either way are left out of the counts.
  const shown = reacts.filter((r) => {
    const acc = byId.get(r.memberId)?.accountId;
    return !(acc && acc !== v.accountId && v.blocked.has(acc));
  });
  return seen.map((r) => {
    const mine = shown.find((x) => x.momentId === r.id && x.memberId === v.memberId)?.emoji;
    const counts = new Map<string, number>();
    for (const x of shown) if (x.momentId === r.id) counts.set(x.emoji, (counts.get(x.emoji) ?? 0) + 1);
    const reactions = [...counts]
      .sort((a, b) => b[1] - a[1] || ALL_REACTIONS.indexOf(a[0]) - ALL_REACTIONS.indexOf(b[0]))
      .map(([emoji, count]) => ({ emoji, count, mine: emoji === mine }));
    const author = byId.get(r.authorId);
    const who = momentAuthor(v, r, author?.name);
    return {
      id: r.id,
      groupId: r.groupId,
      authorId: r.authorId,
      authorAccountId: r.authorAccountId,
      authorName: who.name,
      authorInitial: who.initial,
      authorIsMe: who.isMe,
      caption: r.caption,
      takenOn: r.takenOn,
      day: dayLabel(r.takenOn, g.tripStart, g.tripEnd),
      width: r.width,
      height: r.height,
      createdAt: r.createdAt,
      thumb: momentPhotoSrc(r.id, "t"),
      full: momentPhotoSrc(r.id, "f"),
      reactions,
    };
  });
}

// The moments this person can see in the group, newest first.
export async function listMoments(v: MomentViewer | null, take = 100): Promise<MomentCard[]> {
  if (!canOpenMoments(v)) return [];
  const [group, rows] = await Promise.all([
    db.group.findUnique({ where: { id: v.groupId }, select: { tripStart: true, tripEnd: true } }),
    db.moment.findMany({ where: momentsWhere(v), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take, select: MOMENT_FIELDS }),
  ]);
  return cards(v, rows, { tripStart: group?.tripStart ?? "", tripEnd: group?.tripEnd ?? "" });
}

// One moment, only if this person can see it.
export async function loadMomentCard(v: MomentViewer | null, id: string): Promise<MomentCard | null> {
  const row = await loadMomentRow(id);
  if (!row || !canSeeMoment(v, row)) return null;
  const group = await db.group.findUnique({ where: { id: row.groupId }, select: { tripStart: true, tripEnd: true } });
  return (await cards(v!, [row], { tripStart: group?.tripStart ?? "", tripEnd: group?.tripEnd ?? "" }))[0] ?? null;
}

// The strip on the group page: how many, and the newest four (their ids, for the small copies).
export async function momentStrip(v: MomentViewer | null): Promise<{ count: number; latest: string[] }> {
  if (!canOpenMoments(v)) return { count: 0, latest: [] };
  const where = momentsWhere(v);
  const [count, latest] = await Promise.all([db.moment.count({ where }), db.moment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 4, select: { id: true } })]);
  return { count, latest: latest.map((l) => l.id) };
}

// ---------- Adding ----------
export type SaveMomentResult = { ok: true; id: string; duplicate?: boolean } | { ok: false; reason: "gone" | "group-full" | "slow-down" };

// Counts inside the same step that saves: membership is checked again here, since the upload takes a while.
export async function saveMoment(o: {
  groupId: string;
  memberId: string;
  accountId: string;
  caption: string;
  takenOn: string;
  type: string;
  width: number;
  height: number;
  blobKey: string;
  thumbKey: string;
  data: Uint8Array<ArrayBuffer>;
  thumbData: Uint8Array<ArrayBuffer>;
  rid?: string;
  now?: Date;
}): Promise<SaveMomentResult> {
  const now = o.now ?? new Date();
  try {
    return await db.$transaction(async (tx) => {
      const me = await tx.member.findFirst({
        where: { id: o.memberId, groupId: o.groupId, accountId: o.accountId, leftAt: null, removedAt: null, ...JOINED, group: { deletedAt: null, type: "trip" } },
        select: { id: true },
      });
      if (!me) return { ok: false as const, reason: "gone" as const };
      if ((await tx.moment.count({ where: { groupId: o.groupId } })) >= MOMENTS_PER_GROUP) return { ok: false as const, reason: "group-full" as const };
      const recent = await tx.moment.count({ where: { groupId: o.groupId, authorAccountId: o.accountId, createdAt: { gt: new Date(now.getTime() - 86_400_000) } } });
      if (recent >= MOMENTS_PER_PERSON_PER_DAY) return { ok: false as const, reason: "slow-down" as const };
      const row = await tx.moment.create({
        data: {
          groupId: o.groupId, authorId: o.memberId, authorAccountId: o.accountId, caption: o.caption, takenOn: o.takenOn, type: o.type, width: o.width, height: o.height,
          blobKey: o.blobKey, thumbKey: o.thumbKey, data: o.data, thumbData: o.thumbData, createdAt: now,
        },
        select: { id: true },
      });
      await claimKey(tx, o.rid, row.id); // the same form sent twice makes one moment
      return { ok: true as const, id: row.id };
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      const prev = o.rid ? await db.requestKey.findUnique({ where: { key: o.rid } }) : null;
      return { ok: true, id: prev?.result ?? "", duplicate: true };
    }
    throw err;
  }
}

// ---------- Removing ----------
// Author delete, admin remove and operator remove all end here: the files go on the to-delete list in the same step as the row.
// Nothing is logged in the group's history (that stays money only). Returns false when it was already gone.
// `resolveReports` is for the operator's remove (and nothing else): the moment's open reports are closed in the same step, even when
// the moment is already gone. When the author deletes their own, the reports stay open so the operator still sees them.
export async function removeMoment(id: string, opts: { resolveReports?: boolean } = {}): Promise<boolean> {
  const { queuePhotoDeletes, flushPhotoDeletes } = await import("./photo-store");
  const gone = await db.$transaction(async (tx) => {
    const m = await tx.moment.findUnique({ where: { id }, select: { blobKey: true, thumbKey: true } });
    if (opts.resolveReports) await tx.report.updateMany({ where: { kind: "moment", targetId: id, status: "open" }, data: { status: "resolved", resolvedAt: new Date() } });
    if (!m) return false;
    await queuePhotoDeletes(tx, [m.blobKey, m.thumbKey]);
    await tx.momentReaction.deleteMany({ where: { momentId: id } });
    await tx.moment.deleteMany({ where: { id } });
    return true;
  });
  await flushPhotoDeletes();
  return gone;
}

// ---------- Home's story circles ----------
export type MomentStoryGroup = {
  groupId: string;
  groupName: string;
  newestId: string;
  at: Date;
  // newest first, at most 6
  frames: { id: string; thumb: string; full: string; kicker: string; head: string; line: string }[];
};

// For people who are in the group right now (not someone who left), moments from the last 3 days they can see.
// `memberships` is { groupId: memberId } for this phone (guests included: a guest name sees them, an account follows its groups).
export async function loadMomentStoryGroups(memberships: Record<string, string>, now = new Date()): Promise<MomentStoryGroup[]> {
  const ids = Object.values(memberships);
  if (!ids.length) return [];
  const mine = await db.member.findMany({
    where: { id: { in: ids }, leftAt: null, removedAt: null, ...JOINED, group: { deletedAt: null, type: "trip" } },
    select: { id: true, groupId: true, accountId: true, group: { select: { name: true, tripStart: true, tripEnd: true } } },
    take: 200,
  });
  if (!mine.length) return [];
  const accounts = [...new Set(mine.map((m) => m.accountId).filter((a): a is string => Boolean(a)))];
  const blockedBy = new Map<string, Set<string>>();
  for (const a of accounts) blockedBy.set(a, await blockedEitherWay(a));
  const since = new Date(now.getTime() - 3 * 86_400_000);
  const rows = await db.moment.findMany({
    where: { groupId: { in: mine.map((m) => m.groupId) }, createdAt: { gte: since } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 300,
    select: MOMENT_FIELDS,
  });
  if (!rows.length) return [];
  const authors = await db.member.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(authors.map((a) => [a.id, first(a.name)]));
  const out: MomentStoryGroup[] = [];
  for (const m of mine) {
    const blocked = (m.accountId && blockedBy.get(m.accountId)) || new Set<string>();
    const viewer: MomentViewer = { groupId: m.groupId, groupType: "trip", groupDeleted: false, memberId: m.id, accountId: m.accountId, leftAt: null, removedAt: null, pending: false, isAdmin: false, blocked };
    const list = rows.filter((r) => r.groupId === m.groupId && canSeeMoment(viewer, r)).slice(0, 6);
    if (!list.length) continue;
    out.push({
      groupId: m.groupId,
      groupName: m.group.name,
      newestId: list[0].id,
      at: list[0].createdAt,
      frames: list.map((r) => ({
        id: r.id,
        thumb: momentPhotoSrc(r.id, "t"),
        full: momentPhotoSrc(r.id, "f"),
        kicker: (m.accountId ? r.authorAccountId === m.accountId : r.authorId === m.id) ? "You added a moment" : `${nameOf.get(r.authorId) ?? "Someone"} added a moment`,
        head: r.caption,
        line: dayLabel(r.takenOn, m.group.tripStart, m.group.tripEnd),
      })),
    });
  }
  return out;
}

// ---------- Home's "Memories" row ----------
// The newest moments (at most MEMORY_MAX) you may see across your groups, as square polaroids under the story circles.
// Same people as the story circles (in the group right now). Each group's rows are read with momentsWhere (blocks, and nothing after
// you left), then pickMemories runs canSeeMoment on every one again. Photo bytes are never read here, only their addresses.
export async function loadHomeMemories(memberships: Record<string, string>): Promise<HomeMemory[]> {
  const ids = Object.values(memberships);
  if (!ids.length) return [];
  const mine = await db.member.findMany({
    where: { id: { in: ids }, leftAt: null, removedAt: null, ...JOINED, group: { deletedAt: null, type: "trip" } },
    select: { id: true, groupId: true, accountId: true, group: { select: { name: true } } },
    take: 200,
  });
  if (!mine.length) return [];
  // Someone in many trips: look at the 12 groups with the newest moments, so the row never misses the latest ones.
  const latest = await db.moment.groupBy({ by: ["groupId"], where: { groupId: { in: mine.map((m) => m.groupId) } }, _max: { createdAt: true } });
  const newest = new Map(latest.map((r) => [r.groupId, r._max.createdAt?.getTime() ?? 0]));
  mine.sort((a, b) => (newest.get(b.groupId) ?? 0) - (newest.get(a.groupId) ?? 0));
  const blockedBy = new Map<string, ReadonlySet<string>>();
  for (const a of new Set(mine.map((m) => m.accountId).filter((x): x is string => Boolean(x)))) blockedBy.set(a, await blockedEitherWay(a));
  const groups: MemoryGroup[] = await Promise.all(
    mine.slice(0, 12).map(async (m) => {
      const viewer: MomentViewer = { groupId: m.groupId, groupType: "trip", groupDeleted: false, memberId: m.id, accountId: m.accountId, leftAt: null, removedAt: null, pending: false, isAdmin: false, blocked: (m.accountId && blockedBy.get(m.accountId)) || new Set<string>() };
      const moments = await db.moment.findMany({ where: momentsWhere(viewer), orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: MEMORY_MAX, select: { id: true, groupId: true, authorId: true, authorAccountId: true, caption: true, createdAt: true } });
      return { groupId: m.groupId, name: m.group.name.replace(/\s+trip$/i, "").trim() || m.group.name, viewer, moments };
    }),
  );
  return pickMemories(groups, (id) => momentPhotoSrc(id, "t"));
}

// ---------- Download my data ----------
// Moments you added (text only, no photos). Nothing written by other people.
export async function loadMyMoments(accountId: string): Promise<{ createdAt: Date; group: string; caption: string; day: string; groupId: string; id: string }[]> {
  const rows = await db.moment.findMany({ where: { authorAccountId: accountId }, orderBy: { createdAt: "asc" }, take: 1000, select: { id: true, groupId: true, caption: true, takenOn: true, createdAt: true } });
  if (!rows.length) return [];
  const groups = await db.group.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.groupId))] } }, select: { id: true, name: true, tripStart: true, tripEnd: true } });
  const g = new Map(groups.map((x) => [x.id, x]));
  return rows.map((r) => ({ id: r.id, groupId: r.groupId, createdAt: r.createdAt, group: g.get(r.groupId)?.name ?? "A group", caption: r.caption, day: dayLabel(r.takenOn, g.get(r.groupId)?.tripStart ?? "", g.get(r.groupId)?.tripEnd ?? "") || r.takenOn }));
}
