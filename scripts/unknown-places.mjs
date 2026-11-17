// Lists the places people named that Loopin has no photo for, so new place photos can be added.
// READ-ONLY (one SELECT). Run by the "Unknown places" workflow (needs TURSO_DATABASE_URL / TURSO_AUTH_TOKEN).
// THIS REPOSITORY IS PUBLIC, so place names are NEVER written to the job summary or to anything in this repository.
// The names go only to a separate PRIVATE repository (REPORTS_REPO + REPORTS_TOKEN). Without both, only a count is written.
// Even there, only places named by 3 or more different accounts are listed (most-named first, at most 200).
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MIN_ACCOUNTS = 3;
export const MAX_PLACES = 200;

// Pure: rows from the database (place, groups = number of different accounts) and the settings → what to write.
// `json` is null (no file at all) unless the private repository is set up; `summary` never contains a place name.
export function buildReport(rows, env, today = new Date().toISOString().slice(0, 10)) {
  // Re-check each name: letters, spaces, hyphens, apostrophes only.
  const places = rows
    .map((r) => ({ place: String(r.place), accounts: Number(r.groups) }))
    .filter((p) => p.accounts >= MIN_ACCOUNTS && /^[\p{L}][\p{L} '-]{1,39}$/u.test(p.place))
    .sort((a, b) => b.accounts - a.accounts || a.place.localeCompare(b.place))
    .slice(0, MAX_PLACES);
  const ready = Boolean(env.REPORTS_REPO && env.REPORTS_TOKEN);
  return {
    count: places.length,
    json: ready ? JSON.stringify({ updated: today, places }, null, 1) + "\n" : null,
    summary: ready
      ? `## Places without a photo\n\n${places.length} places waiting. The list was saved to the private reports repository.\n`
      : `## Places without a photo\n\n${places.length} places waiting, report repo not set up.\n`,
  };
}

async function main() {
  const { createClient } = await import("@libsql/client"); // only when really run (the tests use buildReport alone)
  const url = process.env.TURSO_DATABASE_URL;
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const exists = (await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='UnknownPlace'")).rows.length > 0;
  const rows = exists ? (await db.execute({ sql: "SELECT place, groups FROM UnknownPlace WHERE groups >= ? ORDER BY groups DESC, place ASC LIMIT 200", args: [MIN_ACCOUNTS] })).rows : [];
  db.close();
  const r = buildReport(rows, process.env);
  if (r.json) writeFileSync("unknown-places.json", r.json);
  writeFileSync("unknown-places.md", r.summary);
  console.log(`${r.count} places waiting`); // a count only
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
