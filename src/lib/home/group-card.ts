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

// What Home's polaroids print under the handwritten name: "You owe ₹54,122" (orange), "Owed ₹3,450" (green), "✓ You’re square" (green: you, not necessarily everyone in the group).
// Same balance as cardBalance, only the words differ. `tone` stays "square" when even, so tests and colours can tell it apart.
export function cardStatus(balance: number, format: (minor: number) => string): { text: string; tone: CardTone } {
  if (balance > 0) return { text: `Owed ${format(balance)}`, tone: "owed" };
  if (balance < 0) return { text: `You owe ${format(-balance)}`, tone: "owe" };
  return { text: "✓ You’re square", tone: "square" };
}

// What Home's polaroids print under the handwritten name: ONLY a short status word, no amount (the money pass above is the one place
// the amount is on Home). "You owe" (orange ink), "Owed to you" (green ink), "Square" (neutral: green is only for money owed to you).
export function cardWord(balance: number): { text: "You owe" | "Owed to you" | "Square"; tone: CardTone } {
  if (balance > 0) return { text: "Owed to you", tone: "owed" };
  if (balance < 0) return { text: "You owe", tone: "owe" };
  return { text: "Square", tone: "square" };
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
