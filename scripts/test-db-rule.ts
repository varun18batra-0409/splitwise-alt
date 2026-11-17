// The rule behind scripts/test-db-guard.ts, kept apart so tests can call it without the guard's exit.
// Allowed: no TURSO_DATABASE_URL, a file: URL, or an online database only when LOOPIN_STAGING_DB=1, the live address is known
// (LIVE_URL or LIVE_TURSO_DATABASE_URL) and it differs. The reason never contains an address.
type Env = Record<string, string | undefined>;

export function checkTestDb(env: Env): { ok: true } | { ok: false; reason: string } {
  const url = (env.TURSO_DATABASE_URL ?? "").trim();
  if (!url || url.startsWith("file:")) return { ok: true };
  if (env.LOOPIN_STAGING_DB !== "1") return { ok: false, reason: "this is an online database and LOOPIN_STAGING_DB=1 is not set" };
  const live = [env.LIVE_URL, env.LIVE_TURSO_DATABASE_URL].map((v) => (v ?? "").trim()).filter(Boolean);
  if (live.length === 0) return { ok: false, reason: "the live database address (LIVE_URL) is not known, so 'not the live database' cannot be checked" };
  if (live.includes(url)) return { ok: false, reason: "the database is the LIVE database" };
  return { ok: true };
}
