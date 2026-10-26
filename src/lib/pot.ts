import { smartSettle, type Transfer } from "./settle";
import { allocateByWeights } from "./split";

// "The Pot": the maths, kept apart so it can be checked on its own.
//
// Everyone takes money from a shared pot to play (as often as they like) and
// puts back what they have left at the end. For each player:
//   net = returned − taken (+ any adjustment the host recorded)
// A plus is a win, a minus a loss. All the nets add up to zero when every
// rupee taken has come back; if not, the game can't be finished until the
// gap is found or the host records an adjustment. Then Smart Settle turns the
// nets into the fewest payments (losers pay winners).

export type PotGameKind = "poker" | "teenpatti";
export const POT_GAMES: { id: PotGameKind; label: string; emoji: string }[] = [
  { id: "teenpatti", label: "Teen Patti", emoji: "🃏" },
  { id: "poker", label: "Poker", emoji: "♠️" },
];
export const isPotGame = (x: string): x is PotGameKind => POT_GAMES.some((g) => g.id === x);
export const potGameLabel = (x: string) => POT_GAMES.find((g) => g.id === x)?.label ?? "Cards";

export type PotMoveLike = { memberId: string; kind: string; amount: number; deletedAt?: Date | null };
export type PotLine = { memberId: string; taken: number; takes: number; returned: number; returnedYet: boolean; adjust: number; net: number };
export type PotTotals = { taken: number; returned: number; adjust: number; out: number; gap: number; balanced: boolean };

// Per player and in total. `players` keeps the order (and shows people who haven't taken anything yet).
export function potSummary(players: string[], moves: PotMoveLike[]): { lines: PotLine[]; totals: PotTotals } {
  const by = new Map<string, PotLine>(players.map((id) => [id, { memberId: id, taken: 0, takes: 0, returned: 0, returnedYet: false, adjust: 0, net: 0 }]));
  for (const m of moves) {
    if (m.deletedAt) continue;
    let l = by.get(m.memberId);
    if (!l) {
      l = { memberId: m.memberId, taken: 0, takes: 0, returned: 0, returnedYet: false, adjust: 0, net: 0 };
      by.set(m.memberId, l);
    }
    if (m.kind === "take") {
      l.taken += m.amount;
      l.takes++;
    } else if (m.kind === "return") {
      l.returned += m.amount;
      l.returnedYet = true;
    } else if (m.kind === "adjust") l.adjust += m.amount;
  }
  const lines = [...by.values()].map((l) => ({ ...l, net: l.returned + l.adjust - l.taken }));
  const taken = lines.reduce((s, l) => s + l.taken, 0);
  const returned = lines.reduce((s, l) => s + l.returned, 0);
  const adjust = lines.reduce((s, l) => s + l.adjust, 0);
  // gap > 0: more came back than was taken; gap < 0: some money is missing.
  const gap = returned + adjust - taken;
  return { lines, totals: { taken, returned, adjust, out: Math.max(0, taken - returned), gap, balanced: gap === 0 } };
}

// Who pays whom at the end (the fewest payments). Only for a balanced game.
export function potTransfers(lines: PotLine[]): Transfer[] {
  const net = Object.fromEntries(lines.filter((l) => l.net !== 0).map((l) => [l.memberId, l.net]));
  return smartSettle(net);
}

// Closing a gap: the host can spread it over everyone who played (equal parts,
// the odd paisa to the first players), or put it all on one player.
export function spreadGap(gap: number, players: string[]): { memberId: string; amount: number }[] {
  if (!gap || !players.length) return [];
  const parts = allocateByWeights(Math.abs(gap), players.map((memberId) => ({ memberId, weight: 1 })));
  return parts.filter((p) => p.amount > 0).map((p) => ({ memberId: p.memberId, amount: gap > 0 ? -p.amount : p.amount }));
}

// The result as one line in the group's balances: the winners "paid" (they're
// owed their winnings), the losers' "shares" are their losses.
export function potResult(lines: PotLine[]): { winners: { memberId: string; amount: number }[]; losers: { memberId: string; amount: number }[]; total: number } {
  const winners = lines.filter((l) => l.net > 0).map((l) => ({ memberId: l.memberId, amount: l.net })).sort((a, b) => b.amount - a.amount);
  const losers = lines.filter((l) => l.net < 0).map((l) => ({ memberId: l.memberId, amount: -l.net }));
  return { winners, losers, total: winners.reduce((s, w) => s + w.amount, 0) };
}

export function parsePlayers(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
