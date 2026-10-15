// Restores a backup (made by scripts/backup.mjs, decrypted) into a database.
//   node scripts/restore.mjs backup.json file:/tmp/restored.db
//   node scripts/restore.mjs backup.json libsql://new-db.turso.io   (+ TURSO_AUTH_TOKEN)
// The target must be EMPTY (a new database): it never overwrites live data.
// Prints a row count per table and checks they match the backup.
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const [file, url] = process.argv.slice(2);
if (!file || !url) {
  console.error("Usage: node scripts/restore.mjs <backup.json> <database url>");
  process.exit(1);
}
const backup = JSON.parse(readFileSync(file, "utf8"));
const client = createClient({ url, authToken: url.startsWith("file:") ? undefined : process.env.TURSO_AUTH_TOKEN });

const existing = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
if (existing.rows.length > 0) {
  console.error(`Refusing to restore: the target already has ${existing.rows.length} tables. Use a new, empty database.`);
  process.exit(1);
}

await client.execute("PRAGMA foreign_keys = OFF");
for (const [name, t] of Object.entries(backup.tables)) await client.execute(t.schema);
let ok = true;
for (const [name, t] of Object.entries(backup.tables)) {
  const q = `"${name.replace(/"/g, '""')}"`;
  for (let i = 0; i < t.rows.length; i += 200) {
    const chunk = t.rows.slice(i, i + 200);
    await client.batch(
      chunk.map((row) => {
        const cols = Object.keys(row);
        return { sql: `INSERT INTO ${q} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`, args: cols.map((c) => row[c]) };
      }),
      "write",
    );
  }
  const n = Number((await client.execute(`SELECT COUNT(*) AS n FROM ${q}`)).rows[0].n);
  const match = n === t.rows.length;
  ok &&= match;
  console.log(`${match ? "✓" : "✗"} ${name}: ${n} rows${match ? "" : ` (backup has ${t.rows.length})`}`);
}
console.log(ok ? `Restore complete and verified (backup taken ${backup.takenAt}).` : "Restore finished with differences — check above.");
process.exit(ok ? 0 : 2);
