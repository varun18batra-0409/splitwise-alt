// A name someone chose (their own, or a group's) goes into an email from Loopin, and into messages shown to other people.
// Links, email addresses and web addresses are taken out of it, so it can't carry a scam link or a "pay here" address under
// Loopin's name. Ordinary names that merely contain a dot or an @ ("K.Srinivas", "Dr.Rao", "Mary.Ann", "Bills@Home") stay as they are.

// Only these count as the end of a web address when found after a dot ("pay.com"); "Dr.Rao" or "Mary.Ann" are names.
export const COMMON_TLDS = ["com", "in", "net", "org", "io", "co", "app", "xyz", "me", "info", "biz", "ly", "gg", "link", "site", "online", "shop", "store"];

// A dot written in another way: "[.]", "(.)", " dot ", the ideographic full stop 。 and the full-width one ．
const DOT = String.raw`(?:\[\.\]|\(\.\)|\.|\s+dot\s+|。|．)`;
const WORD = String.raw`[\w-]+`;
const ADDRESS = new RegExp(`(?<![\\w-])${WORD}(?:${DOT}${WORD})*?${DOT}(?:${COMMON_TLDS.join("|")})(?![\\w-])`, "gi");
const EMAIL = /(?<!\S)[^\s@]+@[^\s@]+\.[a-z]{2,}[.,;:!?)]*(?!\S)/gi;
const WWW = /(?<!\S)www(?:\.|\[\.\]|\(\.\)|。|．)\S*/gi;
const SCHEME = /\S*:\/\/\S*/g;

export function mailSafe(name: string, fallback = "Someone"): string {
  const clean = String(name ?? "")
    .replace(SCHEME, " ")
    .replace(WWW, " ")
    .replace(EMAIL, " ")
    .replace(ADDRESS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || fallback;
}
