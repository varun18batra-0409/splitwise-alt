// Some addresses ARE the secret: /join/CODE (group invite), /c/CODE (a Collect list), /p/TOKEN (an "I've paid" link).
// Anyone holding the code can use it, so it must never reach the speed log, the error log or the public Live-stats output.
// The first segment says what the second one is; the code itself is never kept.
const SECRET_FIRST = new Set(["join", "c", "p"]);

export function hideSecrets(path: string): string {
  const parts = path.split("?")[0].split("#")[0].split("/");
  // parts[0] is "" for a path that starts with "/".
  const at = parts[0] === "" ? 1 : 0;
  if (SECRET_FIRST.has((parts[at] ?? "").toLowerCase()) && parts[at + 1]) parts[at + 1] = ":code";
  return parts.join("/");
}
