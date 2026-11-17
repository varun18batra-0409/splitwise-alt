// A name someone chose (their own, or a group's) goes into an email from Loopin, and into messages shown to other people.
// Links, payment handles (UPI), email addresses and web addresses are taken out of it, so it can't carry a scam link or a "pay
// here" address under Loopin's name. Ordinary names that merely contain a dot ("K.Srinivas", "Dr.Rao", "Mary.Ann") stay as they are.
// Anything with an @ joined to text on both sides is removed, so "Bills@Home" goes too; "Bills @ Home" (with spaces) stays.

// After a dot, these count as the end of a web address ("pay.com", "pay-loopin.ru"); "Dr.Rao" or "Mary.Ann" are names.
export const COMMON_TLDS = [
  "com", "in", "net", "org", "io", "co", "app", "xyz", "me", "info", "biz", "ly", "gg", "link", "site", "online", "shop", "store",
  "uk", "dev", "ai", "to", "cc", "top", "ru", "cn", "de", "fr", "us", "ca", "au", "tk", "ml", "ga", "cf", "gq", "pw", "live",
];

// A dot written in another way: "[.]", "(.)", " dot ", the ideographic full stop 。 and the full-width one ．
const DOT = String.raw`(?:\[\.\]|\(\.\)|\.|\s+dot\s+|。|．)`;
// Letters in any script (so "платёж.ru" and "支付.com" count as web addresses), digits, "_" and "-".
const WORD = String.raw`[\p{L}\p{N}_-]+`;
const EDGE = String.raw`[\p{L}\p{N}_-]`;
const ADDRESS = new RegExp(`(?<!${EDGE})${WORD}(?:${DOT}${WORD})*?${DOT}(?:${COMMON_TLDS.join("|")})(?!${EDGE})`, "giu");
const AT_HANDLE = /[^\s@]+@[^\s@]+/g; // rohan@okaxis (UPI), asha@example.com
const WWW = /(?<!\S)www(?:\.|\[\.\]|\(\.\)|。|．)\S*/gi;
const SCHEME = /\S*:\/\/\S*/g;

export function mailSafe(name: string, fallback = "Someone"): string {
  const clean = String(name ?? "")
    .replace(SCHEME, " ")
    .replace(WWW, " ")
    .replace(AT_HANDLE, " ")
    .replace(ADDRESS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || fallback;
}
