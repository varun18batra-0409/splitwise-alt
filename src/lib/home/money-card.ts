// Home's money card: the big net amount and two equal buttons. Which one is bright depends on where you stand:
// you owe -> Settle up is bright; you're owed or it evens out -> Add expense is bright;
// all square -> Add expense is bright and the second button becomes New group (there is nothing to settle).
import type { TripPhase } from "../countdown";
import { personKey } from "../cross-settle";

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

// Several currencies with no saved rate: each currency keeps its own sign ("+₹500 · −€20"). If they don't all point
// the same way there is no single "you owe" or "coming back to you", so the card is neutral. Zero amounts don't count.
export function mixedDirections(netLines: string[]): boolean {
  const signs = new Set(netLines.filter((l) => /[1-9]/.test(l)).map((l) => (l.trim().startsWith("−") || l.trim().startsWith("-") ? "-" : "+")));
  return signs.size > 1;
}

export function moneyLead(mode: MoneyMode, acrossCurrencies = false): string {
  if (acrossCurrencies) return "Across currencies";
  return mode === "owed" ? "Coming back to you" : mode === "owe" ? "You owe" : mode === "even" ? "It all evens out" : "All square";
}

// The label on the slim money card, left of the amount: "Coming back to you", "You owe", "Nobody owes anybody".
// Who it is with is the people line underneath (moneyPeople), so the label no longer counts people.
export function moneyLabel(x: { mode: MoneyMode; acrossCurrencies?: boolean; people?: { name: string; net?: number }[] }): string {
  if (x.acrossCurrencies) return "Across currencies";
  if (x.mode === "square") return "Nobody owes anybody";
  if (x.mode === "owed") return "Coming back to you";
  if (x.mode === "even") return "It all evens out";
  return "You owe";
}

// ---- The people line under the label: initial circles and "Nupur, Ravi and 2 others" ----
// Built from the same transfers Settle up uses (crossSettle), so the order is Settle up's per-person totals.
// People are merged across groups only where Settle up merges them (signed-in account, else phone: personKey).
// Someone added by name alone stays per group. A group with no saved rate keeps its own currency, never added into another.
export type MoneyPerson = { key: string; name: string; groupName: string; solo: boolean; amount: number; currency: string; approx: boolean };
export type PeopleGroup = {
  groupId: string;
  groupName: string;
  currency: string;
  myId: string;
  members: { id: string; name: string; phone: string; accountId?: string | null }[];
  transfers: { from: string; to: string; amount: number }[];
};

// Everyone on the matching side ("owe": people you pay; "owed": people who pay you), largest first.
// Amounts are positive minor units. Together (one currency) they add up to that side's total.
export function moneyPeople(groups: PeopleGroup[], side: "owe" | "owed", common: string, toCommon: (amount: number, currency: string) => number | null): MoneyPerson[] {
  const acc = new Map<string, MoneyPerson & { signed: number }>();
  for (const g of groups) {
    for (const t of g.transfers) {
      if (t.from !== g.myId && t.to !== g.myId) continue;
      const iPay = t.from === g.myId;
      const other = g.members.find((m) => m.id === (iPay ? t.to : t.from));
      if (!other) continue;
      const conv = g.currency === common ? t.amount : toCommon(t.amount, g.currency);
      const currency = conv === null ? g.currency : common;
      const amount = conv === null ? t.amount : conv;
      const key = personKey(other, g.groupId);
      const slot = `${key}|${currency}`;
      const e = acc.get(slot) ?? { key, name: other.name, groupName: g.groupName, solo: key.startsWith("solo:"), amount: 0, currency, approx: false, signed: 0 };
      e.signed += iPay ? -amount : amount;
      e.approx ||= conv !== null && g.currency !== common;
      acc.set(slot, e);
    }
  }
  return [...acc.values()]
    .filter((e) => (side === "owe" ? e.signed < 0 : e.signed > 0))
    .map(({ signed, ...e }) => ({ ...e, amount: Math.abs(signed) }))
    .sort((a, b) => Number(b.currency === common) - Number(a.currency === common) || b.amount - a.amount || a.name.localeCompare(b.name));
}

// `names`: who gets a little initial circle (up to 3, largest first). `text`: the one quiet line beside them.
export type PeopleLine = { names: string[]; text: string };

// "Nupur" / "Nupur and Ravi" / "Nupur, Ravi and Asha" / "Nupur, Ravi and 3 others". No amounts: those live on Settle up.
// Largest first (entries already are). A person is named once, even if part of what they're owed is in another currency.
// Two different name-only people called the same thing get their group's name: "Ravi (Flat 402)".
export function peopleLine(entries: MoneyPerson[]): PeopleLine {
  const seen = new Set<string>();
  const list = entries.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
  const count = new Map<string, number>();
  for (const e of list) count.set(e.name.trim().toLowerCase(), (count.get(e.name.trim().toLowerCase()) ?? 0) + 1);
  const names = list.map((e) => (e.solo && (count.get(e.name.trim().toLowerCase()) ?? 0) > 1 ? `${e.name} (${e.groupName})` : e.name));
  const n = names.length;
  const text = n === 0 ? "" : n === 1 ? names[0] : n === 2 ? `${names[0]} and ${names[1]}` : n === 3 ? `${names[0]}, ${names[1]} and ${names[2]}` : `${names[0]}, ${names[1]} and ${n - 2} others`;
  return { names: names.slice(0, 3), text };
}

// "across 3 groups, from 4 people": groups with something open, and who it is with.
export function moneySub(x: { mode: MoneyMode; groups: number; allGroups: number; people: { name: string; net?: number }[] }): string {
  if (x.mode === "square") return x.allGroups === 1 ? "Nobody owes anybody in your group" : x.allGroups === 0 ? "Nobody owes anybody" : `Nobody owes anybody in your ${x.allGroups} groups`;
  const where = x.groups > 1 ? `across ${x.groups} groups` : "in one group";
  const dir = x.mode === "owed" ? "from" : x.mode === "owe" ? "to" : "with";
  // Only people on the matching side: "to N people" counts those you owe, "from N people" those who owe you.
  const people = x.people.filter((p) => p.net === undefined || (x.mode === "owe" ? p.net < 0 : x.mode === "owed" ? p.net > 0 : true));
  const who = people.length === 0 ? "" : people.length === 1 ? `, ${dir} ${people[0].name}` : `, ${dir} ${people.length} people`;
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
