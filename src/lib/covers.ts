import photos from "../generated/photos.json"; // relative, so the test tools can load it too

// A group's picture ("cover"): a real photo (free Unsplash photos, downloaded
// when the app is built, see scripts/fetch-photos.mjs) or drawn artwork
// (components/GroupCover.tsx). Drawn ones cost nothing and always work; a photo
// that couldn't be downloaded quietly shows its drawn look-alike instead.
// Stored on the group as "" (pick one from the group's type), a cover id, or
// "plain" (no picture: the first letter of the name instead).

export type DrawnId = "beach" | "mountain" | "city" | "couple" | "dinner" | "diwali";
export type PhotoId =
  | "photo-beach" | "photo-mountains" | "photo-road" | "photo-lake" | "photo-forest" | "photo-snow" | "photo-city" | "photo-paris" | "photo-taj"
  | "photo-home" | "photo-food" | "photo-cafe" | "photo-party" | "photo-birthday" | "photo-wedding" | "photo-friends";
export type CoverId = DrawnId | PhotoId;
export type CoverChoice = CoverId | "plain" | "own";

const PHOTO_SLOT: Record<PhotoId, string> = {
  "photo-beach": "cover-beach",
  "photo-mountains": "cover-mountains",
  "photo-city": "cover-city",
  "photo-food": "cover-food",
  "photo-friends": "cover-friends",
  "photo-home": "cover-home",
  "photo-road": "cover-road",
  "photo-lake": "cover-lake",
  "photo-forest": "cover-forest",
  "photo-snow": "cover-snow",
  "photo-paris": "cover-paris",
  "photo-taj": "cover-taj",
  "photo-cafe": "cover-cafe",
  "photo-party": "cover-party",
  "photo-birthday": "cover-birthday",
  "photo-wedding": "cover-wedding",
};
// What a photo falls back to when it isn't there.
const LOOK_ALIKE: Record<PhotoId, DrawnId> = {
  "photo-beach": "beach",
  "photo-mountains": "mountain",
  "photo-city": "city",
  "photo-food": "dinner",
  "photo-friends": "couple",
  "photo-home": "city",
  "photo-road": "mountain",
  "photo-lake": "mountain",
  "photo-forest": "mountain",
  "photo-snow": "mountain",
  "photo-paris": "city",
  "photo-taj": "city",
  "photo-cafe": "dinner",
  "photo-party": "dinner",
  "photo-birthday": "dinner",
  "photo-wedding": "couple",
};

const ALL: { id: CoverChoice; label: string }[] = [
  { id: "photo-beach", label: "Beach, photo" },
  { id: "photo-mountains", label: "Mountains, photo" },
  { id: "photo-road", label: "Road trip" },
  { id: "photo-lake", label: "Lake" },
  { id: "photo-forest", label: "Forest" },
  { id: "photo-snow", label: "Snow" },
  { id: "photo-city", label: "City lights, photo" },
  { id: "photo-paris", label: "Paris" },
  { id: "photo-taj", label: "Taj Mahal" },
  { id: "photo-home", label: "Flat" },
  { id: "photo-food", label: "Food" },
  { id: "photo-cafe", label: "Coffee" },
  { id: "photo-party", label: "Night out" },
  { id: "photo-birthday", label: "Birthday" },
  { id: "photo-wedding", label: "Wedding" },
  { id: "photo-friends", label: "Friends" },
  { id: "beach", label: "Sunset beach" },
  { id: "mountain", label: "Mountains at dawn" },
  { id: "city", label: "City at night" },
  { id: "dinner", label: "Dinner table" },
  { id: "couple", label: "Two circles" },
  { id: "diwali", label: "Diwali lamp" },
  { id: "plain", label: "Plain" },
  { id: "own", label: "Your own photo" },
];

export function isPhoto(x: string): x is PhotoId {
  return Object.prototype.hasOwnProperty.call(PHOTO_SLOT, x);
}

// The downloaded file for a photo, or null when it isn't there.
export function photoSrc(id: PhotoId): string | null {
  return (photos as Record<string, { src: string } | undefined>)[PHOTO_SLOT[id]]?.src ?? null;
}

// The pictures to choose from: all the drawn ones, and the photos that were downloaded.
export const COVERS = ALL.filter((c) => c.id !== "own" && (!isPhoto(c.id) || photoSrc(c.id)));

export function isCoverChoice(x: string): x is CoverChoice {
  return ALL.some((c) => c.id === x);
}

// The picture a group gets when nobody has picked one: drawn, so Home looks of a
// piece (real photos are there to pick).
function typeDefault(type: string): CoverChoice {
  const want: Record<string, CoverId> = { trip: "beach", home: "city", couple: "couple", other: "dinner" };
  return resolve(want[type] ?? "photo-food");
}

function resolve(c: CoverChoice): CoverChoice {
  return isPhoto(c) && !photoSrc(c) ? LOOK_ALIKE[c] : c;
}

type CoverGroup = { id?: string; cover?: string | null; type?: string | null; coverAt?: Date | null };

// The picture a group shows: its own choice, else one that suits its type.
// ("own" only when the group really has its own photo.)
export function coverOf(group: CoverGroup): CoverChoice {
  const c = group.cover ?? "";
  if (c === "own") return group.coverAt && group.id ? "own" : typeDefault(group.type ?? "");
  if (isCoverChoice(c)) return resolve(c);
  return typeDefault(group.type ?? "");
}

// Everything <GroupCover> needs: which picture, and the address of the group's
// own photo. `outside`: for someone not in the group yet (the invite page),
// who never sees the group's own photo.
export function coverFor(group: CoverGroup, outside = false): { kind: CoverChoice; src?: string } {
  const kind = coverOf(group);
  if (kind !== "own") return { kind };
  if (outside) return { kind: typeDefault(group.type ?? "") };
  return { kind, src: `/api/group-photo/${group.id}?v=${group.coverAt!.getTime()}` };
}

// Which kind of picture these bytes are (by their first bytes, never by what
// the phone claims), or null if it isn't a JPEG, PNG or WebP.
export function photoType(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
export const MAX_PHOTO_BYTES = 700_000; // the most the server takes
// What the phone aims for before uploading: small enough to load fast and take
// little room, still sharp on a phone screen (a cover is at most ~1080 px wide there).
export const TARGET_PHOTO_BYTES = 150_000;
export const PHOTO_STEPS: readonly (readonly [maxSide: number, quality: number])[] = [
  [1080, 0.72],
  [960, 0.66],
  [840, 0.6],
  [720, 0.55],
];

// What a form sent, made safe to store ("" when it matches the type's own picture,
// so changing the type later still changes the picture).
export function cleanCover(input: string, type: string, hasOwnPhoto = false): string {
  const c = String(input ?? "").trim();
  if (c === "own") return hasOwnPhoto ? "own" : "";
  if (!isCoverChoice(c)) return "";
  return c === typeDefault(type) ? "" : c;
}
