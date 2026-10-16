// The shopping list (pure helpers).

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// The things added most often that aren't on the list right now (a quick "+ Eggs").
export function usualItems(history: string[], current: string[], n = 3): string[] {
  const now = new Set(current.map(norm));
  const counts = new Map<string, { text: string; count: number; first: number }>();
  history.forEach((raw, i) => {
    const k = norm(raw);
    if (!k || now.has(k)) return;
    const c = counts.get(k);
    if (c) c.count++;
    else counts.set(k, { text: raw.trim().replace(/\s+/g, " "), count: 1, first: i });
  });
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.first - b.first)
    .slice(0, n)
    .map((c) => c.text);
}
