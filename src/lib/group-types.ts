
// What a group is for. It only sets defaults (the first screen, suggested
// name, how costs are shared); everything else works the same for all types.
export type GroupType = "trip" | "home" | "couple" | "other";

export const GROUP_TYPES: { id: GroupType; label: string; hint: string; namePlaceholder: string }[] = [
  { id: "trip", label: "Trip", hint: "Travel together, any currency", namePlaceholder: "Goa trip" },
  { id: "home", label: "Home", hint: "Flatmates or family. Rent, bills, groceries", namePlaceholder: "Flat 402" },
  { id: "couple", label: "Couple", hint: "The two of you, your own split", namePlaceholder: "Us" },
  { id: "other", label: "Other", hint: "Dinners, gifts, a party", namePlaceholder: "Friday dinners" },
];

export function isGroupType(x: string): x is GroupType {
  return GROUP_TYPES.some((t) => t.id === x);
}

// "You earn ₹1,10,000, Riya ₹90,000" → 55 / 45. Whole percents, never 0 or 100.
export function ratioFromIncomes(a: number, b: number): [number, number] {
  if (!(a > 0) && !(b > 0)) return [50, 50];
  const first = Math.min(99, Math.max(1, Math.floor((Math.max(0, a) / (Math.max(0, a) + Math.max(0, b))) * 100 + 0.5)));
  return [first, 100 - first];
}

// Weights are hundredths of a share (1.2 shares = 120); a couple's 55 / 45 is 55 and 45.
// "" when everyone is equal (then there's nothing special to show).
export function weightsLabel(weights: number[]): string {
  if (weights.length < 2 || weights.every((w) => w === weights[0])) return "";
  const percentLike = weights.length === 2 && weights[0] + weights[1] === 100;
  return weights.map((w) => (percentLike ? String(w) : String(Number((w / 100).toFixed(2))))).join(" / ");
}

// A typed share ("1.2") → hundredths (120). Up to 20 shares, 2 decimals.
export function parseWeight(text: string): number | null {
  const t = String(text ?? "").trim().replace(",", ".");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const v = Math.round(Number(t) * 100);
  return v > 2000 ? null : v;
}

// What the group's own split is called on the Add expense screen.
export function splitNameFor(type: string): string {
  return type === "couple" ? "Our split" : type === "home" ? "Flat split" : "Group split";
}
