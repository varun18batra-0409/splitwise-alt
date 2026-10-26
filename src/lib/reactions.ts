// Reactions on an expense: a quick 😂 or 🔥, one per person (tap again to take it back).
export const REACTIONS = ["😂", "🔥", "😭", "🙄", "😍", "👏"] as const;
export const isReaction = (e: string) => (REACTIONS as readonly string[]).includes(e);

// Counts per emoji in a fixed order, and which one is mine. Pure.
export function reactionSummary(list: { emoji: string; memberId: string }[], myId: string) {
  const counts = REACTIONS.map((e) => ({ emoji: e, count: list.filter((r) => r.emoji === e).length })).filter((x) => x.count > 0);
  return { counts, mine: list.find((r) => r.memberId === myId)?.emoji ?? "" };
}
