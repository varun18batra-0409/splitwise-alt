// Reads the three usage figures from Turso's organisation usage answer, from exactly where they are documented:
//   answer.organization.usage.{ rows_read, rows_written, storage_bytes }
// (not "the first number with that name anywhere", which could pick up a single database's figure and quietly show the wrong one).
// Returns { rows_read, rows_written, storage_bytes, missing } where a figure that is not a finite number is null and named in `missing`.
// The same rule is in src/lib/usage.ts (readOrgUsage); tests/usage-check.test.ts checks the two agree.
export const USAGE_KEYS = ["rows_read", "rows_written", "storage_bytes"];

export function readOrgUsage(answer) {
  const usage = answer && typeof answer === "object" ? answer.organization?.usage : undefined;
  const out = {};
  const missing = [];
  for (const k of USAGE_KEYS) {
    const v = usage && typeof usage === "object" ? usage[k] : undefined;
    out[k] = typeof v === "number" && Number.isFinite(v) ? v : null;
    if (out[k] === null) missing.push(k);
  }
  return { ...out, missing };
}
