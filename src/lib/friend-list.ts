// Friends' passports: the list can be long, and each row costs a passport load, so the page shows the first
// `limit`. Searching by name looks through EVERYONE, not just those shown.
export function pickFriends<T extends { name: string }>(all: T[], query: string, limit = 80): { shown: T[]; matched: number; total: number } {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const hits = words.length ? all.filter((f) => words.every((w) => f.name.toLowerCase().includes(w))) : all;
  return { shown: hits.slice(0, limit), matched: hits.length, total: all.length };
}
