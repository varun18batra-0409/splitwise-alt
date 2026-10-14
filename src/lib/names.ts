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

export type Person = { name: string; phone: string };

// Keeps only digits and a leading +, e.g. "+91 98765-43210" → "+919876543210".
export function cleanPhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  return (trimmed.startsWith("+") ? "+" : "") + digits.slice(0, 15);
}

// Pairs typed/picked names with their phone numbers (same order), then tidies them:
// blank names are dropped, duplicate names (ignoring case) keep the first, and
// anyone in `existing` (already in the group) is skipped.
export function cleanPeople(
  names: string[],
  phones: string[],
  existing: string[] = [],
): { people: Person[]; skipped: string[] } {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  const people: Person[] = [];
  const skipped: string[] = [];
  names.forEach((raw, i) => {
    const name = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name) return;
    const key = name.toLowerCase();
    if (taken.has(key)) {
      skipped.push(name);
      return;
    }
    taken.add(key);
    people.push({ name, phone: cleanPhone(phones[i] ?? "") });
  });
  return { people, skipped };
}
