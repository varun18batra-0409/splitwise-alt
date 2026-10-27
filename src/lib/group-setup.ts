import { randomBytes } from "node:crypto";
import { db } from "./db";
import { isSupportedCurrency } from "./money";
import { logEvent } from "./events";
import { MAX_PHOTO_BYTES, cleanCover, photoType } from "./covers";
import { cleanTripDates } from "./countdown";
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
  const group = await db.group.create({
    data: {
      name: input.name.trim().replace(/\s+/g, " ").slice(0, 60),
      type,
      currency: isSupportedCurrency(input.currency) ? input.currency : "INR",
      inviteCode: newInviteCode(),
      joinWeight: couple ? 100 - ratio : 100,
      cover: cleanCover(input.cover ?? "", type),
      ...(type === "trip" ? tripDatesOrNone(input.tripStart, input.tripEnd) : {}),
      ...(type === "trip" ? wherePlace(input.tripPlace, input.tripCountry) : {}),
      members: { create: [{ name: input.yourName, claimedAt: new Date(), accountId: account.id, splitWeight: couple ? ratio : 100 }] },
    },
    include: { members: true },
  });
  if (photo && photoKind) {
    const now = new Date();
    await db.$transaction([
      db.groupPhoto.create({ data: { groupId: group.id, data: photo, type: photoKind, createdById: group.members[0].id, updatedAt: now } }),
      db.group.update({ where: { id: group.id }, data: { cover: "own", coverAt: now } }),
    ]);
  }
  return group;
}

// Dates typed when making a trip: kept only if they make sense (otherwise left for settings).
function tripDatesOrNone(start = "", end = "") {
  const r = cleanTripDates(start, end, dayKey(new Date(), DEFAULT_TIME_ZONE));
  return r.ok ? { tripStart: r.start, tripEnd: r.end } : {};
}

// Settings → trip dates. Logged in the group's history (so everyone sees the new dates).
export async function setTripDates(groupId: string, actorId: string, start: string, end: string, today: string): Promise<Result> {
  const g = await db.group.findUnique({ where: { id: groupId }, include: { members: { select: { id: true } } } });
  if (!g || g.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!g.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change it." };
  const r = cleanTripDates(start, end, today);
  if (!r.ok) return r;
  if (r.start === g.tripStart && r.end === g.tripEnd) return { ok: true };
  const label = (s: string, e: string) => (!s ? "not set" : e && e !== s ? `${niceDay(s)} – ${niceDay(e)}` : niceDay(s));
  let eventId: string | undefined;
  await db.$transaction(async (tx) => {
    await tx.group.update({ where: { id: g.id }, data: { tripStart: r.start, tripEnd: r.end } });
    eventId = await logEvent(tx, {
      groupId,
      actorId,
      kind: "trip_dates_set",
      text: r.start ? `set the trip dates: ${label(r.start, r.end)}` : "cleared the trip dates",
      details: [`Trip dates: ${label(g.tripStart, g.tripEnd)} → ${label(r.start, r.end)}`],
    });
  });
  return { ok: true, eventId };
}

const niceDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

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
): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (!group.members.some((m) => m.id === actorId)) return { ok: false, error: "Only people in this group can change this." };
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

  const label = weightsLabel(active.map((m) => next[m.id])) || "equally";
  const eventId = await db.$transaction(async (tx) => {
    if (type !== group.type) await tx.group.update({ where: { id: group.id }, data: { type } });
    for (const m of changed) await tx.member.update({ where: { id: m.id }, data: { splitWeight: next[m.id] } });
    return logEvent(tx, {
      groupId: group.id,
      actorId,
      kind: "split_changed",
      text: `changed how costs are shared (${label})`,
      details: active.map((m) => `${m.name}: ${type === "couple" ? `${next[m.id]}%` : `${Number((next[m.id] / 100).toFixed(2))} share${next[m.id] === 100 ? "" : "s"}`}`),
    });
  });
  return { ok: true, eventId };
}

// Where a new trip goes (optional): as typed, and a country from the list.
function wherePlace(place = "", country = "") {
  const tripPlace = place.replace(/\s+/g, " ").trim().slice(0, 80);
  const tc = country.toUpperCase();
  return { tripPlace, tripCountry: countryOf(tc) ? tc : "" };
}
