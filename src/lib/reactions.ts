// Reactions on an expense: a quick 😂 or 🔥, one per person (tap again to take it back).
// Six quick ones, and more behind "+". The ones your group uses most come first.
export const REACTIONS = ["😂", "🔥", "😭", "🙄", "😍", "👏"] as const;
export const MORE_REACTIONS = ["🎉", "🥳", "😱", "🤯", "🙌", "💸", "🤑", "😅", "🤝", "❤️", "👀", "🍻", "🍕", "✈️", "🏖️", "🤦", "😴", "🙏", "💯", "🫶", "😬", "🤌", "🥲", "👑"] as const;
export const ALL_REACTIONS: readonly string[] = [...REACTIONS, ...MORE_REACTIONS];
export const isReaction = (e: string) => ALL_REACTIONS.includes(e);

// The quick row for a group: the most used first, topped up with the usual six. Pure.
export function quickReactions(list: { emoji: string }[], n = 6): string[] {
  const used = new Map<string, number>();
  for (const r of list) if (isReaction(r.emoji)) used.set(r.emoji, (used.get(r.emoji) ?? 0) + 1);
  const top = [...used].sort((a, b) => b[1] - a[1] || ALL_REACTIONS.indexOf(a[0]) - ALL_REACTIONS.indexOf(b[0])).map(([e]) => e);
  return [...new Set([...top, ...REACTIONS])].slice(0, n);
}

// Counts per emoji (most first), and which one is mine. Pure.
export function reactionSummary(list: { emoji: string; memberId: string }[], myId: string) {
  const counts = ALL_REACTIONS.map((e) => ({ emoji: e, count: list.filter((r) => r.emoji === e).length }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || ALL_REACTIONS.indexOf(a.emoji) - ALL_REACTIONS.indexOf(b.emoji));
  return { counts, mine: list.find((r) => r.memberId === myId)?.emoji ?? "" };
}
