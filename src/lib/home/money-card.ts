// Home's money card: the big net amount and two equal buttons. Which one is bright depends on where you stand:
// you owe -> Settle up is bright; you're owed or it evens out -> Add expense is bright;
// all square -> Add expense is bright and the second button becomes New group (there is nothing to settle).
import type { TripPhase } from "../countdown";

export type MoneyMode = "owe" | "owed" | "even" | "square";
export type MoneyButton = { label: "Add expense" | "Settle up" | "New group"; href: string; bright: boolean };

export function moneyMode(x: { owedLines: number; oweLines: number; netValue: number }): MoneyMode {
  if (x.owedLines === 0 && x.oweLines === 0) return "square";
  return x.netValue < 0 ? "owe" : x.netValue > 0 ? "owed" : "even";
}

// "Add expense" goes to /add: the group picker, or straight into the only group (the same address the bottom bar's + uses).
export function moneyButtons(mode: MoneyMode): [MoneyButton, MoneyButton] {
  const add = (bright: boolean): MoneyButton => ({ label: "Add expense", href: "/add", bright });
  if (mode === "square") return [add(true), { label: "New group", href: "/groups/new", bright: false }];
  if (mode === "owe") return [add(false), { label: "Settle up", href: "/settle", bright: true }];
  return [add(true), { label: "Settle up", href: "/settle", bright: false }];
}

export function moneyLead(mode: MoneyMode): string {
  return mode === "owed" ? "Coming back to you" : mode === "owe" ? "You owe" : mode === "even" ? "It all evens out" : "All square";
}

// "across 3 groups, from 4 people": groups with something open, and who it is with.
export function moneySub(x: { mode: MoneyMode; groups: number; allGroups: number; people: { name: string }[] }): string {
  if (x.mode === "square") return x.allGroups === 1 ? "Nobody owes anybody in your group" : `Nobody owes anybody in your ${x.allGroups} groups`;
  const where = x.groups > 1 ? `across ${x.groups} groups` : "in one group";
  const dir = x.mode === "owed" ? "from" : x.mode === "owe" ? "to" : "with";
  const who = x.people.length === 0 ? "" : x.people.length === 1 ? `, ${dir} ${x.people[0].name}` : `, ${dir} ${x.people.length} people`;
  return `${where}${who}`;
}

// The countdown strip's words: "Goa in 6 days", "Goa tomorrow", "It's Goa day", "Goa, day 3 of 6".
// The number (when there is one) is separate so it can be marked for tests and screen readers.
export function stripWords(place: string, p: TripPhase): { pre: string; num?: string; post: string } | null {
  if (p.kind === "before") {
    if (p.days === 1) return { pre: `${place} `, post: "tomorrow" };
    const [num, unit] = p.days <= 7 ? [p.days, "sleeps"] : p.days >= 60 && p.days % 7 === 0 ? [p.days / 7, "weeks"] : [p.days, "days"];
    return { pre: `${place} in `, num: String(num), post: ` ${unit}` };
  }
  if (p.kind === "today") return { pre: `It’s ${place} day`, post: "" };
  if (p.kind === "during") return { pre: `${place}, day ${p.day} of ${p.of}`, post: "" };
  return null;
}
