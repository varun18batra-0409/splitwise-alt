// Home's group cards: the words and colour under each polaroid, and the small tag on a trip that is on.
import type { TripPhase } from "../countdown";

export type CardTone = "owed" | "owe" | "square";

// "+₹17,618" in green when you're owed, "−₹500" in orange when you owe, "square" when it's even.
// `spoken` is the same thing in words, for screen readers (a bare "+" or "−" reads badly).
export function cardBalance(balance: number, format: (minor: number) => string): { text: string; tone: CardTone; spoken: string } {
  if (balance > 0) return { text: `+${format(balance)}`, tone: "owed", spoken: `you’re owed ${format(balance)}` };
  if (balance < 0) return { text: `−${format(-balance)}`, tone: "owe", spoken: `you owe ${format(-balance)}` };
  return { text: "square", tone: "square", spoken: "all square" };
}

// The little tag on a trip's photo while the trip is on: "Day 2 of 5". Not shown before or after the trip.
export function tripTag(phase: TripPhase | null | undefined): string | null {
  if (!phase) return null;
  if (phase.kind === "during") return `Day ${phase.day} of ${phase.of}`;
  if (phase.kind === "today") return "Starts today";
  return null;
}

// "+ New group" is always the first card of the row (see HomeGroups), however many groups there are.
// The row ends with "See all N" only when it would get long.
export const CARD_ROW_MAX = 10;
export function rowEnd(groups: number): "all" | null {
  return groups > CARD_ROW_MAX ? "all" : null;
}
