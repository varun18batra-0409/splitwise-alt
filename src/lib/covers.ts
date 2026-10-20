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
export type CoverChoice = CoverId | "plain";

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
  { id: "photo-beach", label: "Beach" },
  { id: "photo-mountains", label: "Mountains" },
  { id: "photo-road", label: "Road trip" },
  { id: "photo-lake", label: "Lake" },
  { id: "photo-forest", label: "Forest" },
  { id: "photo-snow", label: "Snow" },
  { id: "photo-city", label: "City lights" },
  { id: "photo-paris", label: "Paris" },
  { id: "photo-taj", label: "Taj Mahal" },
  { id: "photo-home", label: "Flat" },
  { id: "photo-food", label: "Food" },
  { id: "photo-cafe", label: "Coffee" },
  { id: "photo-party", label: "Night out" },
  { id: "photo-birthday", label: "Birthday" },
  { id: "photo-wedding", label: "Wedding" },
  { id: "photo-friends", label: "Friends" },
  { id: "beach", label: "Sunset beach, drawn" },
  { id: "mountain", label: "Mountains, drawn" },
  { id: "city", label: "City lights, drawn" },
  { id: "dinner", label: "Dinner table, drawn" },
  { id: "couple", label: "Two circles, drawn" },
  { id: "diwali", label: "Diwali lamp, drawn" },
  { id: "plain", label: "Plain" },
];

export function isPhoto(x: string): x is PhotoId {
  return Object.prototype.hasOwnProperty.call(PHOTO_SLOT, x);
}

// The downloaded file for a photo, or null when it isn't there.
export function photoSrc(id: PhotoId): string | null {
  return (photos as Record<string, { src: string } | undefined>)[PHOTO_SLOT[id]]?.src ?? null;
}

// The pictures to choose from: the photos that were downloaded, and the drawn
// ones (a drawn beach, mountains, city or dinner only when its photo is missing).
const DRAWN_TWIN: Partial<Record<CoverChoice, PhotoId>> = { beach: "photo-beach", mountain: "photo-mountains", city: "photo-city", dinner: "photo-food" };
export const COVERS = ALL.filter((c) => (isPhoto(c.id) ? photoSrc(c.id) : !(DRAWN_TWIN[c.id] && photoSrc(DRAWN_TWIN[c.id]!))));

export function isCoverChoice(x: string): x is CoverChoice {
  return ALL.some((c) => c.id === x);
}

// The picture a group gets when nobody has picked one.
function typeDefault(type: string): CoverChoice {
  const want: Record<string, CoverId> = { trip: "photo-beach", home: "photo-home", couple: "couple", other: "photo-food" };
  return resolve(want[type] ?? "photo-food");
}

function resolve(c: CoverChoice): CoverChoice {
  return isPhoto(c) && !photoSrc(c) ? LOOK_ALIKE[c] : c;
}

// The picture a group shows: its own choice, else one that suits its type.
export function coverOf(group: { cover?: string | null; type?: string | null }): CoverChoice {
  const c = group.cover ?? "";
  if (isCoverChoice(c)) return resolve(c);
  return typeDefault(group.type ?? "");
}

// What a form sent, made safe to store ("" when it matches the type's own picture,
// so changing the type later still changes the picture).
export function cleanCover(input: string, type: string): string {
  const c = String(input ?? "").trim();
  if (!isCoverChoice(c)) return "";
  return c === typeDefault(type) ? "" : c;
}
