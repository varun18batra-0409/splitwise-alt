// Copies every table of the online database into one JSON file.
// Used by the daily backup on GitHub, which then encrypts the file.
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/backup.mjs out.json
import { writeFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("TURSO_DATABASE_URL is not set");
  process.exit(1);
}
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const tables = await client.execute(
  "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' AND name NOT LIKE '_litestream%' ORDER BY name",
);
const out = { takenAt: new Date().toISOString(), tables: {} };
let rows = 0;
for (const t of tables.rows) {
  const name = String(t.name);
  const r = await client.execute(`SELECT * FROM "${name.replace(/"/g, '""')}"`);
  out.tables[name] = { schema: String(t.sql), rows: r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) };
  rows += r.rows.length;
}
writeFileSync(process.argv[2] ?? "backup.json", JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
console.log(`Backed up ${tables.rows.length} tables, ${rows} rows.`);
