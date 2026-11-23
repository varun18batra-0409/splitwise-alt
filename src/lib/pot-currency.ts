// Changing the group's currency converts every card-game line on its own, so a finished game's lines can come out a cent off the
// converted result (which is converted as one expense). These lines nudge a player's own take/return lines by whole minor units until
// each player's net is exactly what the converted result says, and the game's gap is 0. "Adjust" lines are never touched.
//
// Hand-worked (rupees to dollars at 0.012): A takes 150 + 150 + 150 paise, B takes 300, C returns 750. Plain conversion: A's takes
// 2 + 2 + 2 = 6, B 4, C 9. The result (750 paise = 9 cents) is shared A 5, B 4. So A must go from -6 to -5: A has no return, so one take
// that is bigger than the gap of 1 becomes 1. Nets: A -5, B -4, C +9, gap 0.

export type GameMove = { id: string; memberId: string; kind: string; amount: number; live: boolean };

const netOf = (moves: GameMove[], amount: Record<string, number>, memberId: string) =>
  moves.filter((m) => m.live && m.memberId === memberId).reduce((n, m) => n + (m.kind === "return" || m.kind === "adjust" ? amount[m.id] : m.kind === "take" ? -amount[m.id] : 0), 0);

// `targets`: each player's net after conversion (the converted result's payer part minus share). Returns only the lines that change
// (id -> new amount), or null if a line can't carry the nudge.
export function squareGameMoves(moves: GameMove[], targets: Record<string, number>): Record<string, number> | null {
  const amount: Record<string, number> = Object.fromEntries(moves.map((m) => [m.id, m.amount]));
  const players = [...new Set([...Object.keys(targets), ...moves.map((m) => m.memberId)])];
  // The largest line of a kind that is at least `min` (ties: the first id), so the same game always comes out the same way.
  const pick = (memberId: string, kind: string, min: number) =>
    moves
      .filter((m) => m.live && m.memberId === memberId && m.kind === kind && amount[m.id] >= min)
      .sort((a, b) => amount[b.id] - amount[a.id] || a.id.localeCompare(b.id))[0];
  for (const p of players) {
    const delta = (targets[p] ?? 0) - netOf(moves, amount, p);
    if (delta === 0) continue;
    if (delta > 0) {
      // Raise their net: more on a return, else a take that stays above 0 gets smaller.
      const r = pick(p, "return", 1);
      if (r) amount[r.id] += delta;
      else {
        const t = pick(p, "take", delta + 1);
        if (!t) return null;
        amount[t.id] -= delta;
      }
    } else {
      const d = -delta;
      const t = pick(p, "take", 1);
      if (t) amount[t.id] += d;
      else {
        const r = pick(p, "return", d + 1);
        if (!r) return null;
        amount[r.id] -= d;
      }
    }
  }
  // The proof: every player is on their target and the game's gap is 0.
  let gap = 0;
  for (const p of players) {
    const n = netOf(moves, amount, p);
    if (n !== (targets[p] ?? 0)) return null;
    gap += n;
  }
  if (gap !== 0) return null;
  return Object.fromEntries(moves.filter((m) => amount[m.id] !== m.amount).map((m) => [m.id, amount[m.id]]));
}
