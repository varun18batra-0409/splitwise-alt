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
// One read transaction, so every table is copied from the same moment
// (no expense without its shares because someone saved mid-backup).
const tx = await client.transaction("read");
const tables = await tx.execute(
  "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' AND name NOT LIKE '_litestream%' ORDER BY name",
);
const out = { takenAt: new Date().toISOString(), tables: {} };
let rows = 0;
for (const t of tables.rows) {
  const name = String(t.name);
  const r = await tx.execute(`SELECT * FROM "${name.replace(/"/g, '""')}"`);
  out.tables[name] = { schema: String(t.sql), rows: r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) };
  rows += r.rows.length;
}
// Indexes too, so a restored database is as fast as the original.
const idx = await tx.execute("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND tbl_name NOT LIKE '_prisma%'");
out.indexes = idx.rows.map((r) => String(r.sql));
await tx.commit();
// Numbers as numbers; pictures and other bytes (a group's own photo) as base64 text, which restore.mjs turns back into bytes.
const bytes = (v) => v instanceof ArrayBuffer || ArrayBuffer.isView(v);
writeFileSync(
  process.argv[2] ?? "backup.json",
  JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? Number(v) : bytes(v) ? { $b64: Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).toString("base64") } : v)),
);
console.log(`Backed up ${tables.rows.length} tables, ${rows} rows.`);
