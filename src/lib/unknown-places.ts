import { createHmac } from "node:crypto";
import { placeSlot } from "./places";
import { countryOf } from "./geo";

// Which places do people go to that Loopin has no photo for? So new place photos can be added.
//
// PRIVACY comes first. Only the place name is ever kept, from the trip's "Where to?" field and its country, NEVER from the
// group's name (that can be personal: "Rohan's bachelor party"). No group id, person, account or other text is stored.
// To count DIFFERENT trips without keeping any trip id, each (trip, place) is stored as a keyed one-way hash (HMAC with
// AUTH_SECRET); the same trip saving the same place again is seen as already counted. Without the secret nothing is recorded.

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

// The one-way tag for "this trip named this place". Same trip + place + secret → same tag; the trip id can't be read back.
export function placeTag(secret: string, groupId: string, place: string): string {
  return createHmac("sha256", secret).update(`unknown-place:${groupId}:${place}`).digest("hex").slice(0, 32);
}

// Where counts are kept (the database; tests hand in their own).
export type PlaceStore = { note(place: string, tag: string, now: Date): Promise<void> };

const dbStore: PlaceStore = {
  async note(place, tag, now) {
    const { db } = await import("./db"); // loaded only when really recording
    await db.$transaction(async (tx) => {
      if (await tx.unknownPlaceSeen.findUnique({ where: { place_tag: { place, tag } }, select: { tag: true } })) {
        await tx.unknownPlace.updateMany({ where: { place }, data: { lastSeen: now } });
        return;
      }
      await tx.unknownPlaceSeen.create({ data: { place, tag } });
      await tx.unknownPlace.upsert({
        where: { place },
        create: { place, groups: 1, firstSeen: now, lastSeen: now },
        update: { groups: { increment: 1 }, lastSeen: now },
      });
    });
  },
};

// Best effort: never throws, so it can never fail or change a save. Call it AFTER the save (see noteTripPlaceLater).
export async function noteTripPlace(groupId: string, tripPlace: string | null | undefined, tripCountry: string | null | undefined, opts: { store?: PlaceStore; secret?: string; now?: Date } = {}): Promise<void> {
  try {
    const secret = opts.secret ?? process.env.AUTH_SECRET;
    if (!secret || !groupId) return;
    const places = placesToRecord(tripPlace, tripCountry);
    const store = opts.store ?? dbStore;
    for (const place of places) await store.note(place, placeTag(secret, groupId, place), opts.now ?? new Date());
  } catch {
    // Photo ideas are nice to have: a failure here is never shown and never stops the save.
  }
}

// Runs noteTripPlace after the response is sent (`later` is Next's `after`). Never throws, even if `later` does.
export function noteTripPlaceLater(later: (job: () => Promise<void>) => void, groupId: string, tripPlace: string | null | undefined, tripCountry: string | null | undefined, opts?: Parameters<typeof noteTripPlace>[3]): void {
  try {
    later(() => noteTripPlace(groupId, tripPlace, tripCountry, opts));
  } catch {
    // not in a request, or scheduling failed: skip
  }
}
