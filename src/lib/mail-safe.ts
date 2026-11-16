// A name someone chose (their own, or a group's) goes into an email from Loopin. Links, email addresses and web addresses are
// taken out of it, so an invite email can't carry a scam link or a "pay here" address under Loopin's name.
export function mailSafe(name: string, fallback = "Someone"): string {
  const clean = String(name ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/www\.\S+/gi, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/\b[\w-]+(\.[\w-]+)*\.[a-z]{2,}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || fallback;
}
