import { randomBytes } from "node:crypto";
import { hasLeft, LEFT_ERROR } from "./active";
import { db } from "./db";
import { isSupportedCurrency } from "./money";
import { logEvent, type Db } from "./events";
import { MAX_PHOTO_BYTES, cleanCover, photoType } from "./covers";
import { cleanPhoto } from "./strip-meta";
import { cleanTripDates, tripRange } from "./countdown";
import { dayKey, DEFAULT_TIME_ZONE } from "./dates";
import { countryOf } from "./geo";
import { isGroupType, parseWeight, sharingInputs, weightsLabel, type GroupType } from "./group-types";

// Creating groups and changing how a group shares costs (database side).

export type NewGroupInput = { type: string; name: string; yourName: string; currency: string; ratio?: number; cover?: string; tripStart?: string; tripEnd?: string; tripPlace?: string; tripCountry?: string; photo?: Uint8Array<ArrayBuffer> };

// Makes a group with its creator as the first member.
export async function createGroupFor(account: { id: string }, input: NewGroupInput) {
  const type: GroupType = isGroupType(input.type) ? input.type : "other";
  const ratio = type === "couple" && Number.isInteger(input.ratio) && input.ratio! >= 1 && input.ratio! <= 99 ? input.ratio! : 50;
  const couple = type === "couple" && ratio !== 50;
  // Your own photo, picked while making it: kept only if it's really a small photo and chosen as the picture.
  const photo = input.cover === "own" && input.photo && input.photo.length <= MAX_PHOTO_BYTES ? input.photo : undefined;
  const photoKind = photo ? photoType(photo) : null;
  // A photo that can't be checked for hidden details is left out (the group gets its usual cover; a photo can be added later).
  // The file is stored FIRST, then the group and its photo are made in ONE create: the group never exists without the photo it
  // was made with, and a failed attempt leaves no group behind (so trying again makes one group, not two). If the create fails,
  // the stored file goes on the to-delete list.
  const clean = photo && photoKind ? cleanPhoto(photo) : null;
  const now = new Date();
  const memberId = `c${randomBytes(12).toString("hex")}`; // chosen now so the photo can name its creator in the same create
  const stored = clean && photoKind ? await (await import("./photo-store")).storePhoto("group", clean, photoKind) : null;
  try {
    return await db.group.create({
      data: {
        name: input.name.trim().replace(/\s+/g, " ").slice(0, 60),
        type,
        currency: isSupportedCurrency(input.currency) ? input.currency : "INR",
        inviteCode: newInviteCode(),
        joinWeight: couple ? 100 - ratio : 100,
        cover: stored ? "own" : cleanCover(input.cover ?? "", type),
        ...(stored ? { coverAt: now, photo: { create: { data: stored.data, blobKey: stored.blobKey, type: photoKind!, createdById: memberId, updatedAt: now } } } : {}),
        ...(type === "trip" ? tripDatesOrNone(input.tripStart, input.tripEnd) : {}),
        ...(type === "trip" ? wherePlace(input.tripPlace, input.tripCountry) : {}),
        members: { create: [{ id: memberId, name: input.yourName, claimedAt: new Date(), accountId: account.id, splitWeight: couple ? ratio : 100 }] },
      },
      include: { members: true },
    });
  } catch (err) {
    if (stored?.blobKey) {
      const { removePhotos } = await import("./photo-store");
      await removePhotos([stored.blobKey]).catch(() => undefined);
    }
    throw err;
  }
}

// Dates typed when making a trip: kept only if they make sense (otherwise left for settings).
function tripDatesOrNone(start = "", end = "") {
  const r = cleanTripDates(start, end, dayKey(new Date(), DEFAULT_TIME_ZONE));
  return r.ok ? { tripStart: r.start, tripEnd: r.end } : {};
}

// Settings → trip dates. Logged in the group's history (so everyone sees the new dates).
export async function setTripDates(groupId: string, actorId: string, start: string, end: string, today: string, opts?: { dryRun?: boolean; tx?: Db }): Promise<Result> {
  const c = opts?.tx ?? db;
  const g = await c.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!g || g.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!g.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change it." };
  if (await hasLeft(groupId, actorId, c)) return { ok: false, error: LEFT_ERROR };
  const r = cleanTripDates(start, end, today);
  if (!r.ok) return r;
  if (opts?.dryRun) return { ok: true };
  if (r.start === g.tripStart && r.end === g.tripEnd) return { ok: true };
  const label = (s: string, e: string) => (!s ? "not set" : tripRange(s, e));
  let eventId: string | undefined;
  const write = async (tx: Db) => {
    await tx.group.update({ where: { id: g.id }, data: { tripStart: r.start, tripEnd: r.end } });
    eventId = await logEvent(tx, {
      groupId,
      actorId,
      kind: "trip_dates_set",
      text: r.start ? `set the trip dates: ${label(r.start, r.end)}` : "cleared the trip dates",
      details: [`Trip dates: ${label(g.tripStart, g.tripEnd)} → ${label(r.start, r.end)}`],
    });
  };
  if (opts?.tx) await write(opts.tx);
  else await db.$transaction(write);
  return { ok: true, eventId };
}


export function newInviteCode() {
  return randomBytes(6).toString("base64url"); // 8 characters, hard to guess
}

type Result = { ok: true; eventId?: string } | { ok: false; error: string };

// Settings → "How you share costs": the group type, plus each person's weight
// (shares like "1.2", or a couple's percent like "55").
export async function updateSharing(
  groupId: string,
  actorId: string,
  input: { type: string; weights: Record<string, string> },
  opts?: { dryRun?: boolean; tx?: Db },
): Promise<Result> {
  const c = opts?.tx ?? db;
  const group = await c.group.findUnique({ where: { id: groupId }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change this." };
  if (await hasLeft(groupId, actorId, c)) return { ok: false, error: LEFT_ERROR };
  const type: GroupType = isGroupType(input.type) ? input.type : (group.type as GroupType);
  const active = group.members.filter((m) => !m.leftAt);
  const shownAsPercent = group.type === "couple";
  const next: Record<string, number> = {};
  for (const m of active) {
    const raw = input.weights[m.id];
    if (raw === undefined || raw === "") {
      // Not sent: keep it (as a percent of the couple's total when shown as percents).
      next[m.id] = shownAsPercent ? Number(sharingInputs("couple", active.map((x) => x.splitWeight))[active.indexOf(m)]) : m.splitWeight;
      continue;
    }
    // The boxes were shown in the group's CURRENT format: a couple's percents
    // (55 / 45), everyone else's shares (1.2). Weights are relative, so either
    // format stays right after the type changes.
    const w = shownAsPercent ? (/^\d{1,3}$/.test(raw.trim()) && Number(raw.trim()) <= 100 ? Number(raw.trim()) : null) : parseWeight(raw);
    if (w === null) return { ok: false, error: shownAsPercent ? "Enter a percent between 0 and 100." : "Enter shares like 1 or 1.5 (up to 20)." };
    next[m.id] = w;
  }
  if (active.length && active.every((m) => next[m.id] === 0)) return { ok: false, error: "Someone has to pay a share." };
  if (shownAsPercent && active.length === 2 && active.reduce((s, m) => s + next[m.id], 0) !== 100) {
    return { ok: false, error: "The two parts need to add up to 100%." };
  }
  // Same proportions (e.g. 100 / 100 saved as 50 / 50) count as no change.
  const oldW = active.map((m) => m.splitWeight);
  const newW = active.map((m) => next[m.id]);
  const sumOld = oldW.reduce((s, w) => s + w, 0);
  const sumNew = newW.reduce((s, w) => s + w, 0);
  const sameRatio = oldW.every((w, i) => w * sumNew === newW[i] * sumOld);
  const changed = sameRatio ? [] : active.filter((m) => next[m.id] !== m.splitWeight);
  if (!changed.length && type === group.type) return { ok: true };
  if (opts?.dryRun) return { ok: true };

  const label = weightsLabel(active.map((m) => next[m.id])) || "equally";
  const write = async (tx: Db) => {
    if (type !== group.type) await tx.group.update({ where: { id: group.id }, data: { type } });
    for (const m of changed) await tx.member.update({ where: { id: m.id }, data: { splitWeight: next[m.id] } });
    return logEvent(tx, {
      groupId: group.id,
      actorId,
      kind: "split_changed",
      text: `changed how costs are shared (${label})`,
      details: active.map((m) => `${m.name}: ${type === "couple" ? `${next[m.id]}%` : `${Number((next[m.id] / 100).toFixed(2))} share${next[m.id] === 100 ? "" : "s"}`}`),
    });
  };
  const eventId = opts?.tx ? await write(opts.tx) : await db.$transaction(write);
  return { ok: true, eventId };
}

// Where a new trip goes (optional): as typed, and a country from the list.
function wherePlace(place = "", country = "") {
  const tripPlace = place.replace(/\s+/g, " ").trim().slice(0, 80);
  const tc = country.toUpperCase();
  return { tripPlace, tripCountry: countryOf(tc) ? tc : "" };
}
