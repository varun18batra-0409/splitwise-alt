import { smartSettle, type Transfer } from "./settle";
import { allocateByWeights } from "./split";
import { formatMoney } from "./money";

// Game night: the maths, kept apart so it can be checked on its own.
// (Internally still "pot": the kind, the routes and the stored values keep their names.)
//
// Every player puts chips in to play (as often as they like) and takes home
// what they have left at the end. For each player:
//   net = took home − chips in (+ any adjustment the host recorded)
// A plus is "came out ahead", a minus "came out behind". All the nets add up to zero when every
// rupee that went in has come back; if not, the game can't be finished until the
// gap is found or the host records an adjustment. Then Smart Settle turns the
// nets into the fewest payments (those behind pay those ahead).

import { GAME_CHOICES, gameLabel, isGameKind, type GameKind } from "./game-words";

export type PotGameKind = GameKind;
// What a person can pick for a new game (old stored values are still read: see game-words.ts).
export const POT_GAMES = GAME_CHOICES;
export const isPotGame = isGameKind;
export const potGameLabel = gameLabel;

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

// The result as one line in the group's balances: those ahead "paid" (they're
// owed their result), the "shares" are what those behind owe.
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

// The question asked before a game's result goes into the group's balances ("Money owed"). Biggest amounts first (a win before an equal loss);
// players who came out even are left out. Amounts are minor units.
export function potResultLine(results: { name: string; net: number }[], currency: string): string {
  const shown = results.filter((r) => r.net !== 0).sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || b.net - a.net || a.name.localeCompare(b.name));
  const who = shown.length ? shown.map((r) => `${r.name} ${r.net > 0 ? "+" : "−"}${formatMoney(Math.abs(r.net), currency)}`).join(", ") : "Nobody came out ahead or behind";
  return `Put this game into Money owed? ${who}. You can reopen it.`;
}
