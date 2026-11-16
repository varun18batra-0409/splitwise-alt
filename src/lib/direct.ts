import { redirect } from "next/navigation";
import { formatMoney } from "./money";
import { moneyLines } from "./payers";

// Expenses with one person, no group ("direct pairs").
//
// A pair is a hidden two-person Group with type "direct", so every money rule (shares, balances, payments, undo, request
// keys) is the ordinary group code, unchanged. This file holds only the pieces that need no database, so pages and forms
// (including client components) can import it. The database side is in direct-db.ts.

export const DIRECT = "direct";
export const isDirect = (g: { type: string } | null | undefined): boolean => g?.type === DIRECT;
// A Prisma "where" piece: ordinary groups only.
export const NOT_DIRECT = { type: { not: DIRECT } } as const;

// Entry points (the + choice, the picker, "Add expense with someone"). Only these are switchable; the exclusions are always on.
export const directEntryOn = (): boolean => process.env.DIRECT_EXPENSES !== "0";

const tidy = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// "acc:<lower id>|acc:<higher id>": the same whoever asks.
export function accountPairKey(a: string, b: string): string {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return `acc:${lo}|acc:${hi}`;
}

// A name only its owner sees: "local:<owner account id>|<name trimmed, spaces collapsed, lower case>".
export function localPairKey(owner: string, name: string): string {
  return `local:${owner}|${tidy(name)}`;
}

// The hidden group's own name, e.g. "Asha & Rohan" (never longer than 60).
export function pairName(myName: string, otherName: string): string {
  return `${myName.trim()} & ${otherName.trim()}`.replace(/\s+/g, " ").slice(0, 60);
}

type PairMember = { id: string; name: string; accountId?: string | null; claimedAt?: Date | null };

// The other person in a pair, seen from my member id.
export function otherMember<M extends { id: string }>(group: { members: M[] }, myId: string): M | undefined {
  return group.members.find((m) => m.id !== myId);
}

// "Rohan": what a pair is called to the person looking at it.
export function pairTitle(group: { members: { id: string; name: string }[] }, myId: string): string {
  return otherMember(group, myId)?.name ?? "Someone";
}

// Is the other person someone with a Loopin account? (False: a name only the owner sees.)
export const isSharedPair = (other: PairMember | undefined): boolean => Boolean(other && (other.accountId || other.claimedAt));

// Group pages a pair must not show go to the person's page instead, keeping the query (tab, did, undone, error...) so messages still arrive.
export function redirectIfDirect(group: { id: string; type: string }, query: Record<string, string | string[] | undefined> = {}): void {
  if (!isDirect(group)) return;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, one);
  const qs = q.toString();
  redirect(`/people/${group.id}${qs ? `?${qs}` : ""}`);
}

type LinesLike = { paidById: string; amount: number; payers?: string | null; kind?: string | null; shares: { memberId: string; amount: number }[] };

// One expense in words, from the viewer's side: "Rohan owes you ₹600 for this expense."
// Worked out from the same moneyLines every balance uses (money back flips it), so it always agrees with the balances.
export function pairLine(e: LinesLike, myId: string, otherId: string, otherName: string, currency: string): string {
  const { credits, debits } = moneyLines(e);
  const sum = (list: { memberId: string; amount: number }[], id: string) => list.filter((x) => x.memberId === id).reduce((s, x) => s + x.amount, 0);
  const mine = sum(credits, myId) - sum(debits, myId);
  const theirs = sum(credits, otherId) - sum(debits, otherId);
  const what = e.kind === "refund" ? "this money back" : "this expense";
  // Only two people are in a pair, so one side's net is the other's, reversed. (Use whichever is larger if a stray id is present.)
  const net = mine !== 0 ? mine : -theirs;
  if (net > 0) return `${otherName} owes you ${formatMoney(net, currency)} for ${what}.`;
  if (net < 0) return `You owe ${otherName} ${formatMoney(-net, currency)} for ${what}.`;
  return `Nobody owes anything for ${what}.`;
}

// The balance line on the person page and Settle cards.
export function balanceLine(net: number, otherName: string, currency: string): string {
  if (net > 0) return `${otherName} owes you ${formatMoney(net, currency)}`;
  if (net < 0) return `You owe ${otherName} ${formatMoney(-net, currency)}`;
  return "All settled";
}
