// Tidies a list of typed names: trims spaces, drops blanks, removes
// duplicates (ignoring capital letters), and keeps the first spelling.
export function cleanNames(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const name = r.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
