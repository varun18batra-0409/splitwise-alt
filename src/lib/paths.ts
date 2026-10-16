// A "come back here afterwards" address from a link or form. Only paths on
// this site are allowed, so a crafted link can't send someone to another
// website after they sign in (e.g. "//evil.com" or "/\\evil.com").
export function safePath(raw: string | null | undefined): string {
  const p = String(raw ?? "");
  if (!p.startsWith("/") || p.startsWith("//") || /[\\\u0000-\u001f]/.test(p)) return "/";
  try {
    const u = new URL(p, "http://loopin.invalid");
    if (u.origin !== "http://loopin.invalid") return "/";
    return (u.pathname + u.search + u.hash).slice(0, 300);
  } catch {
    return "/";
  }
}
