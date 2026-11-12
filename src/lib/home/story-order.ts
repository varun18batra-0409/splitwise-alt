// The stories row: ones you haven't seen come first, then the seen ones; inside each, the most recent first.
export function orderStories<T extends { id: string; at: number }>(stories: T[], seen: ReadonlySet<string>): T[] {
  const byRecent = (a: T, b: T) => b.at - a.at;
  return [...stories.filter((s) => !seen.has(s.id)).sort(byRecent), ...stories.filter((s) => seen.has(s.id)).sort(byRecent)];
}
