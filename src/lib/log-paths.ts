// Some addresses ARE the secret: /join/CODE (group invite), /c/CODE (a Collect list), /p/TOKEN (an "I've paid" link).
// Anyone holding the code can use it, so it must never reach the speed log, the error log or the public Live-stats output.
// The first segment says what the second one is; the code itself is never kept.
const SECRET_FIRST = new Set(["join", "c", "p"]);

export function hideSecrets(path: string): string {
  // "//join/CODE" and "/join//CODE" are the same page to the server: look at the pieces, not the slashes.
  const parts = path.split("?")[0].split("#")[0].replace(/^\/{2,}/, "/").replace(/\/{2,}/g, "/").split("/");
  // parts[0] is "" for a path that starts with "/".
  const at = parts[0] === "" ? 1 : 0;
  if (SECRET_FIRST.has((parts[at] ?? "").toLowerCase()) && parts[at + 1]) parts[at + 1] = ":code";
  return parts.join("/");
}

// The same for free text (an error message can repeat the address it came from): any /join/, /c/ or /p/ code anywhere in it.
export function hideSecretsIn(text: string): string {
  return String(text)
    .replace(/\/+(join|c|p)\/+[^\s/?#"'<>)]+/gi, "/$1/:code")
    // A database or library error can print the row it was about: { inviteCode: "abc" }, token: 'abc', code=abc.
    .replace(/\b(inviteCode|invite_code|token|code)(["']?\s*[:=]\s*)(["'`])([^"'`]*)\3/gi, (all, k, sep, q, v) => (keepCode(k, v) ? all : `${k}${sep}${q}:code${q}`))
    .replace(/\b(inviteCode|invite_code|token|code)(\s*=\s*)([^\s,;&)"'`]+)/gi, (all, k, sep, v) => (keepCode(k, v) ? all : `${k}${sep}:code`));
}

// Plain error codes (Prisma P2002, Node ECONNRESET, SQLITE_BUSY) are not secrets and help when reading the error log.
function keepCode(key: string, value: string): boolean {
  return key.toLowerCase() === "code" && /^(P\d{4}|E[A-Z]{3,}|SQLITE_[A-Z_]+|ERR_[A-Z_]+)$/.test(value);
}
