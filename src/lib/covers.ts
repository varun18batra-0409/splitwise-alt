// A group's picture ("cover"): drawn artwork, not photos, so it costs no
// storage, loads instantly and looks the same on every phone. The art itself
// is in components/GroupCover.tsx.
// Stored on the group as "" (pick one from the group's type), a cover id, or
// "plain" (no picture: the first letter of the name instead).

export type CoverId = "beach" | "mountain" | "city" | "couple" | "dinner" | "diwali";
export type CoverChoice = CoverId | "plain";

export const COVERS: { id: CoverChoice; label: string }[] = [
  { id: "beach", label: "Sunset beach" },
  { id: "mountain", label: "Mountains" },
  { id: "city", label: "City lights" },
  { id: "couple", label: "Two circles" },
  { id: "dinner", label: "Dinner table" },
  { id: "diwali", label: "Diwali lamp" },
  { id: "plain", label: "Plain" },
];

const BY_TYPE: Record<string, CoverId> = { trip: "beach", home: "city", couple: "couple", other: "dinner" };

export function isCoverChoice(x: string): x is CoverChoice {
  return COVERS.some((c) => c.id === x);
}

// The picture a group shows: its own choice, else one that suits its type.
export function coverOf(group: { cover?: string | null; type?: string | null }): CoverChoice {
  const c = group.cover ?? "";
  if (isCoverChoice(c)) return c;
  return BY_TYPE[group.type ?? ""] ?? "dinner";
}

// What a form sent, made safe to store ("" when it matches the type's own picture,
// so changing the type later still changes the picture).
export function cleanCover(input: string, type: string): string {
  const c = String(input ?? "").trim();
  if (!isCoverChoice(c)) return "";
  return c === (BY_TYPE[type] ?? "dinner") ? "" : c;
}
