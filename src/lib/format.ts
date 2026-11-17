// Small display helpers shared by the server pages and the Add expense screen.

// "1 THB = ₹2.8367" → the "₹2.8367" part.
export function rateText(rate: string, baseCurrency: string): string {
  return baseCurrency === "INR" ? `₹${rate}` : `${baseCurrency} ${rate}`;
}

// "2026-10-14" → "14 Oct 2026"
export function niceDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

// The short name for tight places (chips, one-line rows): the first name, unless another member shares it ("Priya S" and
// "Priya K" stay in full so they can be told apart). Full names stay on detail screens.
export function compactName(name: string, allNames: string[]): string {
  const first = name.trim().split(/\s+/)[0] || name;
  const same = allNames.filter((n) => (n.trim().split(/\s+/)[0] || n).toLowerCase() === first.toLowerCase()).length;
  return same > 1 ? name : first;
}

// For display only: "Bills & Bits" never breaks after the "&" ("Bills &" / "Bits"). The stored name is unchanged.
export const keepAmp = (s: string): string => s.replace(/ & /g, " & ");

// For display only: a " · " separator never ends a line or starts one ("Monthly · 1st ·" / "you pay"): the dot is glued to
// the words on both sides with non-breaking spaces. Lines still wrap at the other spaces.
export const keepDots = (s: string): string => s.replace(/ · /g, " · ");

// An email split where it may break: after the "@" or a "." only (see EmailText).
export const emailParts = (email: string): string[] => email.split(/(?<=[@.])/);
