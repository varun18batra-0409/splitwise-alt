// A "come back here afterwards" address from a link or form. Only paths on
// this site are allowed, so a crafted link can't send someone to another
// website after they sign in (e.g. "//evil.com" or "/\\evil.com").
export function safePath(raw: string | null | undefined): string {
  const p = String(raw ?? "");
  if (!p.startsWith("/") || p.startsWith("//") || /[\\\u0000-\u001f]/.test(p)) return "/";
  try {
    const u = new URL(p, "http://loopin.invalid");
    if (u.origin !== "http://loopin.invalid") return "/";
    const out = u.pathname + u.search + u.hash;
    // Check again AFTER tidying (review 23 Nov): "/.//evil.com", "/a/..//evil.com" and "/%2e//evil.com" all tidy into "//evil.com",
    // which a browser reads as another website. The tidied path must still be a plain path on this site.
    if (!out.startsWith("/") || out.startsWith("//") || /[\\\u0000-\u001f]/.test(out)) return "/";
    return out.slice(0, 300); // cutting keeps the checked start, so it stays a plain path on this site
  } catch {
    return "/";
  }
}

// One expense or payment, opened in its group's history (scrolled to and expanded).
export function itemHref(groupId: string, item: { kind: string; id: string }): string {
  if (item.kind !== "expense" && item.kind !== "payment") return `/groups/${groupId}?tab=activity`;
  return `/groups/${groupId}?tab=activity&open=${encodeURIComponent(item.id)}#item-${item.id}`;
}
