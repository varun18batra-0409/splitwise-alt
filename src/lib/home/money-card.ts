// Home's money card: the big net amount and two equal buttons. Which one is bright depends on where you stand:
// you owe -> Settle up is bright; you're owed or it evens out -> Add expense is bright;
// all square -> Add expense is bright and the second button becomes New group (there is nothing to settle).
import type { TripPhase } from "../countdown";
import { personKey, phoneKeyResolver, regionForGroup, settleRowId } from "../cross-settle";
import { formatMoney } from "../money";

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
// `parts`: each group's payment between you and them (memberId = their member id there; amount in `currency`, the same
// currency as the total, so parts of one entry are comparable). Used to pick the group to remind them in.
export type MoneyPart = { groupId: string; memberId: string; amount: number; iPay: boolean };
export type MoneyPerson = { key: string; name: string; groupName: string; solo: boolean; amount: number; currency: string; approx: boolean; parts: MoneyPart[] };
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
  const resolve = phoneKeyResolver(
    groups.flatMap((g) =>
      g.transfers
        .filter((t) => t.from === g.myId || t.to === g.myId)
        .map((t) => g.members.find((m) => m.id === (t.from === g.myId ? t.to : t.from)))
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .map((m) => personKey(m, g.groupId, regionForGroup(g))),
    ),
  );
  for (const g of groups) {
    for (const t of g.transfers) {
      if (t.from !== g.myId && t.to !== g.myId) continue;
      const iPay = t.from === g.myId;
      const other = g.members.find((m) => m.id === (iPay ? t.to : t.from));
      if (!other) continue;
      const conv = g.currency === common ? t.amount : toCommon(t.amount, g.currency);
      const currency = conv === null ? g.currency : common;
      const amount = conv === null ? t.amount : conv;
      const key = resolve(personKey(other, g.groupId, regionForGroup(g)));
      const slot = `${key}|${currency}`;
      const e = acc.get(slot) ?? { key, name: other.name, groupName: g.groupName, solo: key.startsWith("solo:"), amount: 0, currency, approx: false, parts: [], signed: 0 };
      e.signed += iPay ? -amount : amount;
      e.parts.push({ groupId: g.groupId, memberId: other.id, amount, iPay });
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

// ---- The who-line under the amount: "Nupur ₹1,800 · Ravi ₹650" (two people), "… · 2 others" (more) ----
// Same entries as the people line (so the same rules about who counts, and the same per-person totals /settle shows).
export type WhoPart = { name: string; amount: string; exact: string };
// `opposite`: when money also goes the other way, the biggest person on that side ("Ravi owes you ₹1,000" on an owe card,
// "you owe Ravi ₹1,000" on an owed card), so the line explains the net amount in the card (₹1,800 owed - ₹1,000 back = ₹800).
export type WhoOpposite = WhoPart & { kind: "owes-you" | "you-owe"; phrase: string };
export type WhoLine = { parts: WhoPart[]; others: number; tail: string; opposite: WhoOpposite | null; text: string; label: string };

// Names are made unique the way peopleLine does it ("Ravi (Flat 402)"); a person is named once (their biggest entry).
function uniquePeople(entries: MoneyPerson[]): { name: string; e: MoneyPerson }[] {
  const seen = new Set<string>();
  const list = entries.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
  const count = new Map<string, number>();
  for (const e of list) count.set(e.name.trim().toLowerCase(), (count.get(e.name.trim().toLowerCase()) ?? 0) + 1);
  return list.map((e) => ({ name: e.solo && (count.get(e.name.trim().toLowerCase()) ?? 0) > 1 ? `${e.name} (${e.groupName})` : e.name, e }));
}

// Amounts are exact (paise included), the same figure the group and Settle up show; the exact amount also rides along for title/aria.
// Never more than 3 names: the top two of the main side, then one from the other side.
export function whoLine(entries: MoneyPerson[], otherSide: MoneyPerson[] = [], side: "owe" | "owed" = "owe"): WhoLine {
  const list = uniquePeople(entries);
  const parts = list.slice(0, 2).map(({ name, e }) => ({
    name,
    amount: `${e.approx ? "≈ " : ""}${formatMoney(e.amount, e.currency)}`,
    exact: `${e.approx ? "≈ " : ""}${formatMoney(e.amount, e.currency)}`,
  }));
  const others = Math.max(0, list.length - 2);
  const tail = others === 0 ? "" : others === 1 ? "1 other" : `${others} others`;
  const mainKeys = new Set(list.map(({ e }) => e.key));
  const rest = uniquePeople(otherSide.filter((e) => !mainKeys.has(e.key)));
  const top = rest[0];
  const kind = side === "owe" ? "owes-you" : "you-owe";
  // Several people the other way, all in one currency: name them as a count with their total, so the line adds up
  // to the card ("Nupur ₹1,800 · 2 people owe you ₹1,300" under ₹500). Mixed currencies: the biggest one, as before.
  const oneCurrency = rest.length > 1 && rest.every(({ e }) => e.currency === top.e.currency);
  const sum = oneCurrency ? rest.reduce((t, { e }) => t + e.amount, 0) : 0;
  const approx = oneCurrency ? rest.some(({ e }) => e.approx) : top?.e.approx;
  const opposite: WhoOpposite | null = top
    ? oneCurrency
      ? {
          name: `${rest.length} people`,
          amount: `${approx ? "≈ " : ""}${formatMoney(sum, top.e.currency)}`,
          exact: `${approx ? "≈ " : ""}${formatMoney(sum, top.e.currency)}`,
          kind,
          phrase: "",
        }
      : {
          name: top.name,
          amount: `${top.e.approx ? "≈ " : ""}${formatMoney(top.e.amount, top.e.currency)}`,
          exact: `${top.e.approx ? "≈ " : ""}${formatMoney(top.e.amount, top.e.currency)}`,
          kind,
          phrase: "",
        }
    : null;
  if (opposite) opposite.phrase = kind === "owes-you" ? `${opposite.name} ${oneCurrency ? "owe" : "owes"} you` : `you owe ${opposite.name}`;
  const text = [...parts.map((p) => `${p.name} ${p.amount}`), ...(tail ? [tail] : []), ...(opposite ? [`${opposite.phrase} ${opposite.amount}`] : [])].join(" · ");
  const label =
    parts.map((p) => `${p.name} ${p.exact}`).join(", ") + (tail ? ` and ${tail}` : "") + (opposite ? `. Also ${opposite.phrase} ${opposite.exact}` : "");
  return { parts, others, tail, opposite, text, label };
}

// ---- The two buttons on a card with someone to pay or remind ----
export type MoneyAction = { key: "pay" | "remind" | "add" | "settle" | "new-group"; label: string; fullLabel: string; href: string; bright: boolean };

export function firstName(name: string): string {
  const f = name.trim().split(/\s+/)[0] || name.trim();
  const chars = [...f];
  return chars.length <= 12 ? f : `${chars.slice(0, 11).join("")}…`;
}

// "Pay Nupur ₹1,800"; with no amount, or when the whole label would be longer than 16 characters (a small phone), just "Pay Nupur".
export function personButtonLabel(verb: "Pay" | "Remind", first: string, amount?: string): string {
  const full = amount ? `${verb} ${first} ${amount}` : "";
  return full && [...full].length <= 16 ? full : `${verb} ${first}`;
}

// Where "Pay" goes: the person's row on the all-groups Settle up (/settle#pay-key, scrolled to). A part with no saved
// exchange rate has no row there, so it goes to that group's own Settle up.
export function payHref(p: MoneyPerson, common: string): string {
  if (p.currency === common) return `/settle#${settleRowId("pay", p.key)}`;
  const part = [...p.parts].filter((x) => x.iPay).sort((a, b) => b.amount - a.amount)[0];
  return part ? `/groups/${part.groupId}/settle` : "/settle#pay";
}

// Where "Remind" goes: the existing remind route, for the group where they owe you most (WhatsApp with the pay link).
export function remindHref(p: MoneyPerson): string | null {
  const part = [...p.parts].filter((x) => !x.iPay).sort((a, b) => b.amount - a.amount || a.groupId.localeCompare(b.groupId))[0];
  return part ? `/groups/${part.groupId}/remind?from=${encodeURIComponent(part.memberId)}` : null;
}

// Owing: "Pay {first name} ₹amount" (the person you owe most) + Add expense. Owed: "Remind {first name}" + Add expense.
// Anything else (square, even, nobody to name): today's two buttons.
export function moneyActions(mode: MoneyMode, people: MoneyPerson[], common: string): [MoneyAction, MoneyAction] {
  const add: MoneyAction = { key: "add", label: "Add expense", fullLabel: "Add expense", href: "/add", bright: false };
  const top = people[0];
  if (mode === "owe" && top) {
    const first = firstName(top.name);
    const label = personButtonLabel("Pay", first, top.approx ? undefined : formatMoney(top.amount, top.currency));
    return [{ key: "pay", label, fullLabel: `Pay ${top.name} ${top.approx ? "≈ " : ""}${formatMoney(top.amount, top.currency)}`, href: payHref(top, common), bright: true }, add];
  }
  const remind = mode === "owed" && top ? remindHref(top) : null;
  if (mode === "owed" && top && remind) {
    const first = firstName(top.name);
    return [{ key: "remind", label: `Remind ${first}`, fullLabel: `Remind ${top.name} on WhatsApp`, href: remind, bright: true }, add];
  }
  const [a, b] = moneyButtons(mode);
  const conv = (x: MoneyButton): MoneyAction => ({ key: x.label === "Add expense" ? "add" : x.label === "Settle up" ? "settle" : "new-group", label: x.label, fullLabel: x.label, href: x.href, bright: x.bright });
  return [conv(a), conv(b)];
}

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

// ---- Home's boarding-pass money card ----
// One ticket: a stub with the group's picture, then the route ("You ┄ ✈ Nupur"), the amount, the group's name and ONE action.
// Money going both ways is two lines on the same ticket, never netted together. Nothing here changes a number: every amount is a
// per-person total from moneyPeople (the same figures Settle up shows), added only within one currency.

export type GroupMark = "plane";

// The mark on the route line is always the plane taking off, whatever the group type (the group's name is the GROUP field instead).
export function groupMark(_type?: string): GroupMark {
  return "plane";
}

// A group the money runs through. `weight`: how much of it is with you, in the common currency (0 when there is no saved rate).
export type InvolvedGroup = { id: string; name: string; type: string; weight: number };

// Most money first; ties by name then id, so the stub never flickers between two groups.
export function rankGroups(groups: InvolvedGroup[]): InvolvedGroup[] {
  return [...groups].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// The grey line under the amount: the group's name, "Thailand Trip and 2 more" when the money spans several groups.
export function ticketContext(ranked: InvolvedGroup[]): string {
  if (ranked.length === 0) return "";
  const rest = ranked.length - 1;
  return rest === 0 ? ranked[0].name : `${ranked[0].name} and ${rest} more`;
}

// "3 flatmates" when everyone is from a flat, else "3 people".
export function crowdWord(types: string[]): "flatmates" | "people" {
  return types.length > 0 && types.every((t) => t === "home") ? "flatmates" : "people";
}

// The two ends of the route line. First names only (the card is narrow); you are always "You".
export function routeEnds(side: "owe" | "owed", firstNames: string[], crowd: "flatmates" | "people"): { from: string; to: string } {
  const them = firstNames.length === 1 ? firstNames[0] : `${firstNames.length} ${side === "owed" ? crowd : "people"}`;
  return side === "owe" ? { from: "You", to: them } : { from: them, to: "You" };
}

// The first name as written, whole ("Bhagyalakshmi"), for button words. A button that is too narrow cuts it with "…" in the
// browser (CSS), so nothing is ever dropped here; firstName above (12 letters at most) is for the narrow route line.
export function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

// The route line's short codes: the first 3 letters in capitals ("KAB", "YOU"), or "3 PPL" for several people. The name itself
// appears only in the button, so it is never shown twice on the card.
export function routeCode(end: string): string {
  if (end === "You") return "YOU";
  const m = /^(\d+) /.exec(end);
  if (m) return `${m[1]} PPL`;
  return [...end.replace(/[^\p{L}\p{N}]/gu, "")].slice(0, 3).join("").toUpperCase() || end.toUpperCase();
}

// A person's code on the boarding pass, never the same as another end of the same pass (`taken`, e.g. "YOU"). First choice is the
// first three letters of the first name ("KAB"). If that is taken ("Youssef" and "YOU"): first letter + the last name's first two
// letters ("YKH" for Youssef Khan), then first two letters + last initial, then first letter + last initial + next letter, and as a
// last resort two letters and a digit ("YO2"). A short name stays short ("AL").
export function personCode(fullName: string, taken: string[] = ["YOU"]): string {
  const letters = (t: string) => [...t.replace(/[^\p{L}\p{N}]/gu, "")].map((c) => c.toUpperCase());
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = letters(parts[0] ?? fullName);
  const last = parts.length > 1 ? letters(parts[parts.length - 1]) : [];
  const pick = (...a: (string | undefined)[]) => a.filter(Boolean).join("");
  const options = [first.slice(0, 3).join(""), ...(last.length > 0 ? [pick(first[0], last[0], last[1]), pick(first[0], first[1], last[0]), pick(first[0], last[0], first[1])] : [])].filter(Boolean);
  for (const c of options) if (!taken.includes(c)) return c;
  const stem = first.slice(0, 2).join("") || "X";
  for (let n = 2; n < 100; n++) if (!taken.includes(`${stem}${n}`)) return `${stem}${n}`;
  return stem;
}

export function initialOf(name: string): string {
  return ([...name.trim()][0] ?? "?").toUpperCase();
}

// The amount for one side: per-person totals added within each currency, a currency never added into another
// ("₹4,200 · $20"). Amounts are exact (formatMoney, never rounded); `exact` is the same amount for the tooltip and screen readers.
export function sideTotal(entries: MoneyPerson[]): { text: string; exact: string } {
  const order: string[] = [];
  const sums = new Map<string, { amount: number; approx: boolean }>();
  for (const e of entries) {
    const s = sums.get(e.currency) ?? { amount: 0, approx: false };
    if (!sums.has(e.currency)) order.push(e.currency);
    s.amount += e.amount;
    s.approx ||= e.approx;
    sums.set(e.currency, s);
  }
  const text = order.map((c) => `${sums.get(c)!.approx ? "≈ " : ""}${formatMoney(sums.get(c)!.amount, c)}`).join(" · ");
  const exact = order.map((c) => `${sums.get(c)!.approx ? "≈ " : ""}${formatMoney(sums.get(c)!.amount, c)}`).join(" · ");
  return { text, exact };
}

// How big the amount can be drawn so it always fits (the amount is never the thing that gets cut).
export function amountTier(text: string): "xl" | "l" | "m" {
  const n = [...text].length;
  return n <= 9 ? "xl" : n <= 12 ? "l" : "m";
}

export type TicketAction = { key: "pay" | "remind" | "settle" | "new-group"; label: string; fullLabel: string; href: string; bright: boolean };
export type TicketLine = {
  side: "owe" | "owed";
  count: number; // people on this side
  phrase: string; // "You owe Nupur", "Kabir owes you", "3 people owe you"
  name: string; // "Nupur" / "3 flatmates"
  amount: string;
  exact: string;
  faces: string[]; // initials, largest first (up to 3), only when there are several people
  peopleHref: string; // Settle up, scrolled to this side
  action: TicketAction;
  fromCode: string; // the boarding pass's route codes: "KAB", "YOU", "3 PPL"
  toCode: string;
  groupIds: string[]; // the groups this side's money runs through (for the GROUP, SINCE and ITEMS fields and the stub's picture)
  groupNames: string[];
  weight: number; // this side's money in the common currency (0 for a part with no saved rate): only used to put the larger pass first
};
export type Ticket =
  | { kind: "square"; label: string; amount: string } // no button: the "+ New group" tile below is the only way to start one
  | { kind: "neutral"; label: string; amount: string; exact?: string; context: string; action: TicketAction }
  | { kind: "one"; line: TicketLine; from: string; to: string; mark: GroupMark; context: string }
  | { kind: "both"; lines: [TicketLine, TicketLine]; mark: GroupMark; context: string };

function distinctPeople(entries: MoneyPerson[]): MoneyPerson[] {
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
}

function ticketLine(side: "owe" | "owed", entries: MoneyPerson[], common: string, groups: InvolvedGroup[], short: boolean): TicketLine {
  const people = distinctPeople(entries);
  const top = people[0];
  const count = people.length;
  const total = sideTotal(entries);
  const types = people.flatMap((p) => p.parts.map((x) => groups.find((g) => g.id === x.groupId)?.type ?? "")).filter(Boolean);
  const crowd = crowdWord(types);
  const name = count === 1 ? firstName(top.name) : `${count} ${side === "owed" ? crowd : "people"}`;
  const peopleHref = side === "owe" ? "/settle#pay" : "/settle#remind";
  const remind = count === 1 ? remindHref(top) : null;
  const action: TicketAction =
    side === "owe"
      ? {
          key: "pay",
          label: short && count > 1 ? "Pay" : `Pay ${firstWord(top.name)}`,
          fullLabel: `Pay ${top.name} ${top.approx ? "≈ " : ""}${formatMoney(top.amount, top.currency)}`,
          // Several people in a both-ways ticket: the list where each has a row; otherwise the biggest person's row.
          href: short && count > 1 ? peopleHref : payHref(top, common),
          bright: true,
        }
      : count === 1
        ? { key: "remind", label: `Remind ${firstWord(top.name)}`, fullLabel: `Remind ${top.name} on WhatsApp`, href: remind ?? peopleHref, bright: !short }
        : { key: "remind", label: short ? "Remind" : `Remind ${count} people`, fullLabel: `See the ${count} people who owe you, to remind them`, href: peopleHref, bright: !short };
  const phrase = side === "owe" ? `You owe ${count === 1 ? top.name : name}` : count === 1 ? `${top.name} owes you` : `${name} owe you`;
  const them = count === 1 ? personCode(top.name, ["YOU"]) : `${count} PPL`;
  const groupIds = [...new Set(people.flatMap((p) => p.parts.map((x) => x.groupId)))];
  const groupNames = groupIds.map((id) => groups.find((g) => g.id === id)?.name).filter((n): n is string => Boolean(n));
  const weight = entries.filter((e) => e.currency === common).reduce((t, e) => t + e.amount, 0);
  return {
    side,
    count,
    phrase,
    name,
    amount: total.text,
    exact: total.exact,
    faces: count > 1 ? people.slice(0, 3).map((p) => initialOf(p.name)) : [],
    peopleHref,
    action,
    fromCode: side === "owe" ? "YOU" : them,
    toCode: side === "owe" ? them : "YOU",
    groupIds,
    groupNames,
    weight,
  };
}

// ---- The ticket at the top of ONE group ----
// Same ticket as Home, for this group only. The numbers are the group's own: `mine` is your balance there (what the page already
// shows) and `transfers` are its Smart Settle payments. Nothing is worked out again here: it only decides which sides to show.
export type GroupSide = { side: "owe" | "owed"; amount: number; names: string[] };

// Who you pay / who pays you, largest payment first. Money both ways is two sides and is never netted; otherwise one side, with
// your own balance as the amount (|mine|), exactly as the page showed it before. Nothing owed: no sides (all square).
export function groupTicketSides(x: { mine: number; myId: string; transfers: { from: string; to: string; amount: number }[]; nameOf: (id: string) => string }): GroupSide[] {
  const toMe = x.transfers.filter((t) => t.to === x.myId && t.amount > 0).sort((a, b) => b.amount - a.amount);
  const fromMe = x.transfers.filter((t) => t.from === x.myId && t.amount > 0).sort((a, b) => b.amount - a.amount);
  const sum = (l: { amount: number }[]) => l.reduce((t, e) => t + e.amount, 0);
  if (toMe.length > 0 && fromMe.length > 0) {
    return [
      { side: "owe", amount: sum(fromMe), names: fromMe.map((t) => x.nameOf(t.to)) },
      { side: "owed", amount: sum(toMe), names: toMe.map((t) => x.nameOf(t.from)) },
    ];
  }
  if (x.mine === 0) return [];
  return x.mine > 0
    ? [{ side: "owed", amount: x.mine, names: toMe.map((t) => x.nameOf(t.from)) }]
    : [{ side: "owe", amount: -x.mine, names: fromMe.map((t) => x.nameOf(t.to)) }];
}

// The one quiet line under the amount: "3 payments clear it", "1 payment clears it". Short so it stays on one line at 320px.
export function clearsLine(payments: number, _groupType?: string): string {
  if (payments <= 0) return "Nobody owes anybody";
  return `${payments === 1 ? "1 payment clears" : `${payments} payments clear`} it`;
}

// Builds the ticket from what Home already knows. `owe` / `owed`: moneyPeople for each side (largest first). `groups`: every group
// with a payment between you and someone. `hero`: the card's existing total, used only when no one can be named.
export function homeTicket(x: {
  mode: MoneyMode;
  acrossCurrencies: boolean;
  owe: MoneyPerson[];
  owed: MoneyPerson[];
  common: string;
  hero: { text: string; exact?: string };
  groups: InvolvedGroup[];
}): Ticket {
  if (x.mode === "square") return { kind: "square", label: "Nobody owes anybody", amount: "All square" };
  const ranked = rankGroups(x.groups);
  const mark = groupMark(ranked[0]?.type ?? "");
  const context = ticketContext(ranked);
  const owe = distinctPeople(x.owe).length > 0;
  const owed = distinctPeople(x.owed).length > 0;
  if (owe && owed) {
    return { kind: "both", mark, context, lines: [ticketLine("owe", x.owe, x.common, x.groups, true), ticketLine("owed", x.owed, x.common, x.groups, true)] };
  }
  if (owe || owed) {
    const side = owe ? "owe" : "owed";
    const line = ticketLine(side, owe ? x.owe : x.owed, x.common, x.groups, false);
    const first = distinctPeople(owe ? x.owe : x.owed).map((p) => firstName(p.name));
    const crowd = line.count > 1 ? crowdWord(distinctPeople(owe ? x.owe : x.owed).flatMap((p) => p.parts.map((q) => x.groups.find((g) => g.id === q.groupId)?.type ?? "")).filter(Boolean)) : "people";
    return { kind: "one", line, mark, context, ...routeEnds(side, first, crowd) };
  }
  // Nobody to name (it evens out, or the people can't be told apart): the card's own total with a way to Settle up.
  return {
    kind: "neutral",
    label: moneyLabel({ mode: x.mode, acrossCurrencies: x.acrossCurrencies }),
    amount: x.hero.text,
    exact: x.hero.exact,
    context,
    action: { key: "settle", label: "Settle up", fullLabel: "Settle up", href: "/settle", bright: true },
  };
}

// ---- The boarding pass's fields and order ----
export type PassField = { key: "group" | "since" | "items" | "payments" | "date" | "in" | "now" | "going"; label: string; value: string };
export type GroupFacts = { since: string | null; items: number }; // since: a day, "2026-11-03"; items: expenses added since the group's last payment

// "3 Nov" (this year) or "3 Nov 2025".
export function shortDay(iso: string, thisYear: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? ""}${m[1] === thisYear ? "" : ` ${m[1]}`}`;
}

// The oldest day and the item count across the groups one pass runs through. A group with no facts is skipped; none known: nulls.
export function sideFacts(ids: string[], facts: Record<string, GroupFacts | undefined>): { since: string | null; items: number | null } {
  const known = ids.map((id) => facts[id]).filter((f): f is GroupFacts => Boolean(f));
  const days = known.map((f) => f.since).filter((d): d is string => Boolean(d)).sort();
  const items = known.reduce((t, f) => t + f.items, 0);
  return { since: days[0] ?? null, items: items > 0 ? items : null };
}

// Up to three labelled fields, only the ones that are known and meaningful (never "0 items").
export function passFields(x: { groupNames: string[]; since?: string | null; items?: number | null; thisYear: string }): PassField[] {
  const out: PassField[] = [];
  if (x.groupNames.length === 1) out.push({ key: "group", label: "Group", value: x.groupNames[0] });
  else if (x.groupNames.length > 1) out.push({ key: "group", label: "Groups", value: `${x.groupNames.length} groups` });
  const day = x.since ? shortDay(x.since, x.thisYear) : "";
  if (day) out.push({ key: "since", label: "Since", value: day });
  if (x.items && x.items > 0) out.push({ key: "items", label: "Items", value: String(x.items) });
  return out;
}

// Money both ways: two passes, the larger one first (in the common currency); equal or unknown: the one you owe first.
export function orderPasses<T extends { side: "owe" | "owed"; weight: number }>(lines: [T, T]): [T, T] {
  const [a, b] = lines;
  return b.weight > a.weight ? [b, a] : a.weight === b.weight && a.side !== "owe" ? [b, a] : [a, b];
}

// The one line under the countdown for the other trips coming up: "Also: Manali in 40 days", "Also: Manali in 40 days, Goa tomorrow and 1 more".
export function alsoLine(trips: { place: string; days: number }[]): string {
  if (trips.length === 0) return "";
  const when = (d: number) => (d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
  const shown = trips.slice(0, 2).map((t) => `${t.place} ${when(t.days)}`);
  const more = trips.length - shown.length;
  return `Also: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

// ---- A group's own boarding pass (the group page and the Settle up cards) ----
// Same pass as Home's, drawn by the same component. These two helpers only decide the words: the codes on the route, and the SINCE and
// ITEMS fields. Neither works out a balance.

// The codes at the two ends of a group's pass. One person: their code ("KAB"). Several: "3 PPL". Nobody to name: "GRP".
// You are always "YOU"; the other end is never the same as yours (personCode steps aside if a name would also be YOU).
export function sideCodes(side: "owe" | "owed", names: string[]): { from: string; to: string } {
  const unique = names.filter((n, i) => names.indexOf(n) === i);
  const them = unique.length === 1 ? personCode(unique[0], ["YOU"]) : unique.length > 1 ? `${unique.length} PPL` : "GRP";
  return side === "owe" ? { from: "YOU", to: them } : { from: them, to: "YOU" };
}

// A code for one end that is just a name as the Settle up screens know it: "You", "3 people" or a person's name.
export function endCode(end: string): string {
  if (end === "You") return "YOU";
  if (/^\d+ /.test(end)) return routeCode(end);
  return personCode(end, ["YOU"]);
}

// What has built up in a group since its last payment: the day of the first expense added after it, and how many there are.
// Deleted rows don't count; with no payment yet, every live expense counts. `dayOf` turns a moment into the viewer's day ("2026-11-03").
export function sinceLastPayment(
  expenses: { createdAt: Date; spentAt?: Date | null; deletedAt?: Date | null }[],
  payments: { createdAt: Date; deletedAt?: Date | null }[],
  dayOf: (d: Date) => string,
): GroupFacts {
  const last = payments.filter((p) => !p.deletedAt).reduce<number>((t, p) => Math.max(t, p.createdAt.getTime()), 0);
  const fresh = expenses.filter((e) => !e.deletedAt && e.createdAt.getTime() > last).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const first = fresh[0];
  return { since: first ? dayOf(first.spentAt ?? first.createdAt) : null, items: fresh.length };
}
