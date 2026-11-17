// An email address as typed, tidied (or null if it isn't one). Pure, so pages and tests can use it without the database.
export function cleanEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/.test(e) ? e : null;
}

// An address from a link, for showing on a page: only if it is a real-looking email and plain ASCII. Look-alike and blank-looking
// characters (U+2800, U+3164, …) pass the first rule but not the second. "" means: don't show it.
export function shownEmail(raw: unknown): string {
  const c = typeof raw === "string" && raw.length <= 254 ? cleanEmail(raw) : null;
  return c && /^[\x21-\x7e]+$/.test(c) ? c : "";
}
