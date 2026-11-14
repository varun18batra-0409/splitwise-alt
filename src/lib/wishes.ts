import { countryOf } from "./geo";

// "Want to go": a private list of countries. The rules that need no database live here (pure); who may see what is in
// wishes-db.ts, which is the one place that checks access.

export const WISH_LIMIT = 200; // places per person
export const SHARE_ALL = "*"; // a share of the whole list (places added later included)
export const SHARE_ROW_LIMIT = 2000; // share rows per owner

// A country code from the phone (any case), or null. Only real countries from our list: no free text ever gets stored.
export function cleanCountry(raw: unknown): string | null {
  const c = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) && countryOf(c) ? c : null;
}

export function cleanCountries(raw: unknown[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const c = cleanCountry(r);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

// A share scope: a country code or "*".
export function cleanScope(raw: unknown): string | null {
  return String(raw ?? "").trim() === SHARE_ALL ? SHARE_ALL : cleanCountry(raw);
}

const byName = (a: string, b: string) => (countryOf(a)?.name ?? a).localeCompare(countryOf(b)?.name ?? b, "en");

// What a friend may see of an owner's list: the countries covered by the rows the owner shared with this friend ("*" covers the
// whole list, later additions too). Nothing at all unless the two are friends right now (the caller works that out, on every read).
export function visibleTo(wishes: string[], shared: string[], friendNow: boolean): string[] {
  if (!friendNow) return [];
  const all = shared.includes(SHARE_ALL);
  return wishes.filter((c) => all || shared.includes(c)).sort(byName);
}

// Countries both of you want AND have shown each other: "You and Nupur both want to go". One-sided sharing is no match for
// anybody (neither of you would learn what the other has not chosen to show).
export function mutualMatches(mine: string[], mineSharedWithThem: string[], theirs: string[], theirsSharedWithMe: string[]): string[] {
  const a = new Set(visibleTo(mine, mineSharedWithThem, true));
  return visibleTo(theirs, theirsSharedWithMe, true).filter((c) => a.has(c));
}

// "Nupur", "Nupur and Riya", "Nupur, Riya and Dev".
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
