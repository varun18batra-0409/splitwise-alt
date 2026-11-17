// Reads the three usage figures from Turso's organisation usage answer, from exactly where they are documented:
//   answer.organization.usage.{ rows_read, rows_written, storage_bytes }
// A figure that isn't a finite number there is null (never "the first number with that name somewhere else").
// No database import, so it can be tested on its own. The same rule is in scripts/usage-read.mjs.
export type OrgUsage = { rowsRead: number | null; rowsWritten: number | null; storage: number | null };

export function readOrgUsage(answer: unknown): OrgUsage {
  const usage = answer && typeof answer === "object" ? (answer as { organization?: { usage?: unknown } }).organization?.usage : undefined;
  const get = (k: string): number | null => {
    const v = usage && typeof usage === "object" ? (usage as Record<string, unknown>)[k] : undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  return { rowsRead: get("rows_read"), rowsWritten: get("rows_written"), storage: get("storage_bytes") };
}
