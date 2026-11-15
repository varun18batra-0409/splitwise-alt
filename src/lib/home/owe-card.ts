// The words and sizes on Home's money card (the compact "You owe" card from the 15 Nov mockup, no photo). Pure, so tests can check them without drawing anything.
// The amounts themselves come from homeTicket (src/lib/home/money-card.ts); nothing is worked out again here.
import type { TicketLine } from "./money-card";

// The small label above the amount.
export function cardLabel(side: "owe" | "owed"): string {
  return side === "owe" ? "You owe" : "You’re owed";
}

// "To 2 people · Thailand Trip", "To Asha · Thailand trip", "From 3 people · 2 groups". One person is named; several are counted;
// one group is named, several are counted; no group name known: the line just says who.
export function sideLine(line: Pick<TicketLine, "side" | "count" | "name" | "groupNames">): string {
  const who = line.count === 1 ? line.name : `${line.count} people`;
  const n = line.groupNames.length;
  const where = n === 1 ? line.groupNames[0] : n > 1 ? `${n} groups` : "";
  return `${line.side === "owe" ? "To" : "From"} ${who}${where ? ` · ${where}` : ""}`;
}

// The button's words: owing is "Review & settle" (the same address as before); being owed keeps the existing "Remind Kabir" / "Remind 3 people".
export function buttonLabel(line: Pick<TicketLine, "side" | "action">): string {
  return line.side === "owe" ? "Review & settle" : line.action.label;
}

// The amount's size by its length, so a lakh amount is never clipped on the card, even on a 320px phone ("₹6,17,283.94" is 12 characters and is the smallest size).
export function homeAmountTier(text: string): "xl" | "l" | "m" {
  const n = [...text].length;
  return n <= 8 ? "xl" : n <= 10 ? "l" : "m";
}

// The time-of-day greeting under the wordmark, without the name.
export function greetingWord(now: Date, tz: string): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  return `Good ${h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : "evening"}`;
}
