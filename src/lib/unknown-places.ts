import { createHmac } from "node:crypto";
import { placeSlot } from "./places";
import { countryOf } from "./geo";

// Which places do people go to that Loopin has no photo for? So new place photos can be added.
//
// PRIVACY comes first. Only the place name is ever kept, from the trip's "Where to?" field and its country, NEVER from the
// group's name (that can be personal: "Rohan's bachelor party"). No group id, person, account or other text is stored.
// To count DIFFERENT PEOPLE (accounts) without keeping any account id, each (account, place) is stored as a keyed one-way
// hash; the same account saving the same place again is already counted. A member with no account, or no secret: nothing
// is recorded. Names are only ever reported when 3 or more different accounts named them, and only to a private place.

const MAX_PARTS = 3;
// Words that mean the text is about the group or a person's own things, not a place.
const NOT_A_PLACE = /\b(trip|party|bachelor|bachelorette|birthday|wedding|reunion|family|friends|boys|girls|gang|squad|my|our|home|house|flat|office|team)\b/;

// One piece of "Where to?" → the place as it would be kept, or null (skipped).
// Accepted: lowercase letters (any alphabet), single spaces, hyphens, apostrophes; 2-40 characters; at most 4 words.
// Skipped: digits or other symbols (emails, phones, links), possessives ("rohan's ..."), group-like words, one very short word.
export function normalisePlace(raw: string): string | null {
  const t = (raw ?? "").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  if (t.length < 2 || t.length > 40) return null;
  if (!/^[\p{L}][\p{L} '-]*$/u.test(t) || !/[\p{L}]$/u.test(t)) return null;
  const words = t.split(/[ -]+/).filter(Boolean);
  if (words.length > 4) return null;
  if (/'s\b/.test(t)) return null; // looks like a person's ("rohan's farmhouse")
  if (NOT_A_PLACE.test(t)) return null;
  if (words.length === 1 && t.replace(/[^\p{L}]/gu, "").length < 3) return null;
  return t;
}

// The places worth keeping for a trip: none when Loopin already has a photo for it ("Goa", "Bangkok, Phuket"), otherwise the
// typed place (each of "Lisbon, Porto"; up to 3) and the country's name. Pure.
export function placesToRecord(tripPlace: string | null | undefined, tripCountry: string | null | undefined): string[] {
  const typed = (tripPlace ?? "").trim();
  const country = tripCountry ? countryOf(tripCountry.toUpperCase())?.name ?? "" : "";
  if (placeSlot(`${typed} ${country}`)) return []; // has a place photo already
  const out: string[] = [];
  for (const piece of [...typed.split(/[,;&/+\n]+|\band\b/i).slice(0, MAX_PARTS), country]) {
    const p = normalisePlace(piece);
    if (p && !placeSlot(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

// The key that makes the tags: derived from AUTH_SECRET but separate from everything else that uses it (domain-separated),
// so a tag can't be matched against any other hash. Changing AUTH_SECRET changes the key: old tags no longer match, so the
// counts start again from zero (a person is counted again the next time they save; nothing breaks).
export function placeKey(secret: string): string {
  return createHmac("sha256", secret).update("loopin-unknown-places-v1").digest("hex");
}

// The one-way tag for "this account named this place". Same account + place + secret → same tag; the account id can't be read back.
export function placeTag(secret: string, accountId: string, place: string): string {
  return createHmac("sha256", placeKey(secret)).update(`${accountId}:${place}`).digest("hex").slice(0, 32);
}

// Where counts are kept (the database; tests hand in their own).
export type PlaceStore = { note(place: string, tag: string, now: Date): Promise<void> };

export const dbStore: PlaceStore = {
  async note(place, tag, now) {
    const { db } = await import("./db"); // loaded only when really recording
    // 1. INSERT OR IGNORE: 1 row = a new account for this place, 0 = this account was already counted. No lock is held between steps.
    const added = await db.$executeRaw`INSERT OR IGNORE INTO "UnknownPlaceSeen" ("place", "tag") VALUES (${place}, ${tag})`;
    if (added > 0) {
      // 2. Only a new account raises the count.
      await db.unknownPlace.upsert({
        where: { place },
        create: { place, groups: 1, firstSeen: now, lastSeen: now },
        update: { groups: { increment: 1 }, lastSeen: now },
      });
    } else {
      await db.unknownPlace.updateMany({ where: { place }, data: { lastSeen: now } });
    }
  },
};

// Best effort: never throws, so it can never fail or change a save. Call it AFTER the save (see noteTripPlaceLater).
// `accountId` is the account of the member who created or saved the place (none = nothing recorded).
// `tripPlace` / `tripCountry` must be the value that was SAVED (cleaned the same way the save cleans it), not what was typed.
export async function noteTripPlace(accountId: string | null | undefined, tripPlace: string | null | undefined, tripCountry: string | null | undefined, opts: { store?: PlaceStore; secret?: string; now?: Date } = {}): Promise<void> {
  try {
    const secret = opts.secret ?? process.env.AUTH_SECRET;
    if (!secret || !accountId) return;
    const places = placesToRecord(tripPlace, tripCountry);
    const store = opts.store ?? dbStore;
    for (const place of places) await store.note(place, placeTag(secret, accountId, place), opts.now ?? new Date());
  } catch {
    // Photo ideas are nice to have: a failure here is never shown and never stops the save.
  }
}

// Runs noteTripPlace after the response is sent (`later` is Next's `after`). Never throws, even if `later` does.
export function noteTripPlaceLater(later: (job: () => Promise<void>) => void, accountId: string | null | undefined, tripPlace: string | null | undefined, tripCountry: string | null | undefined, opts?: Parameters<typeof noteTripPlace>[3]): void {
  try {
    later(() => noteTripPlace(accountId, tripPlace, tripCountry, opts));
  } catch {
    // not in a request, or scheduling failed: skip
  }
}

// After a settings Save: reads the place AS SAVED (already trimmed and capped by the save) and notes it. Never throws.
export function noteSavedTripPlaceLater(later: (job: () => Promise<void>) => void, groupId: string, accountId: string | null | undefined, opts?: Parameters<typeof noteTripPlace>[3]): void {
  try {
    if (!accountId) return;
    later(async () => {
      try {
        const { db } = await import("./db");
        const g = await db.group.findUnique({ where: { id: groupId }, select: { type: true, deletedAt: true, tripPlace: true, tripCountry: true } });
        if (g && g.type === "trip" && !g.deletedAt) await noteTripPlace(accountId, g.tripPlace, g.tripCountry, opts);
      } catch {
        // skip
      }
    });
  } catch {
    // skip
  }
}

export const PLACE_KEEP_DAYS = 365;

// Daily clean-up (the daily job): places not seen for a year, and places that now have a photo, are removed with their tags.
// Returns how many places were removed.
export async function pruneUnknownPlaces(now = new Date()): Promise<number> {
  const { db } = await import("./db");
  const old = await db.unknownPlace.deleteMany({ where: { lastSeen: { lt: new Date(now.getTime() - PLACE_KEEP_DAYS * 86_400_000) } } });
  const photographed = (await db.unknownPlace.findMany({ select: { place: true } })).map((r) => r.place).filter((p) => placeSlot(p));
  let gone = 0;
  for (let i = 0; i < photographed.length; i += 200) gone += (await db.unknownPlace.deleteMany({ where: { place: { in: photographed.slice(i, i + 200) } } })).count;
  // Tags whose place is no longer listed.
  await db.$executeRaw`DELETE FROM "UnknownPlaceSeen" WHERE "place" NOT IN (SELECT "place" FROM "UnknownPlace")`;
  return old.count + gone;
}
