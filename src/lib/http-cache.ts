// Does an If-None-Match header name this tag? (Several tags, "*", and the weak "W/" prefix are all allowed by the web's rules.)
// Used by the photo routes that keep a picture on the phone only as "ask first" (no-cache + ETag): the access check always runs
// first, and only then may "not changed" be said, so someone who lost access stops getting the picture. Pure.
export function tagMatches(header: string | null, tag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => {
    const v = t.trim().replace(/^W\//, "");
    return v === "*" || v === tag;
  });
}
