// Copies every table of the online database into one JSON file.
// Used by the daily backup on GitHub, which then encrypts the file.
//   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/backup.mjs out.json
// The file is written as it goes, one table and one page of rows at a time (never the whole database in memory), so the
// nightly backup keeps working as the database grows. The layout is unchanged: { takenAt, indexes, tables: { name: { schema, rows } } }.
import { closeSync, openSync, writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";

// Tables the database keeps for itself (Turso's replication and sync bookkeeping): not data, and a fresh Turso database
// refuses to create them, so a restore would stop half-way. Same list as scripts/turso-sync.mjs and scripts/restore.mjs.
export const SKIP_TABLES_SQL = "name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' AND name NOT LIKE '_litestream%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_cf_%'";
export const PAGE_ROWS = 500;

// Numbers as numbers; pictures and other bytes (a group's own photo) as base64 text, which restore.mjs turns back into bytes.
const bytes = (v) => v instanceof ArrayBuffer || ArrayBuffer.isView(v);
export const jsonText = (value) =>
  JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? Number(v) : bytes(v) ? { $b64: Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).toString("base64") } : v));

const quote = (name) => `"${name.replace(/"/g, '""')}"`;

// Reads a table a page at a time by its row number, so no single read is larger than PAGE_ROWS rows.
// (A table without row numbers is read in one go.)
async function* pages(tx, name) {
  let last = -1;
  for (;;) {
    let r;
    try {
      r = await tx.execute({ sql: `SELECT rowid AS "__rowid", * FROM ${quote(name)} WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE_ROWS}`, args: [last] });
    } catch (e) {
      if (last !== -1) throw e;
      const all = await tx.execute(`SELECT * FROM ${quote(name)}`);
      yield all.rows.map((row) => Object.fromEntries(all.columns.map((c, i) => [c, row[i]])));
      return;
    }
    if (r.rows.length === 0) return;
    const cols = r.columns.slice(1);
    yield r.rows.map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i + 1]])));
    last = Number(r.rows[r.rows.length - 1][0]);
    if (r.rows.length < PAGE_ROWS) return;
  }
}

export async function backup(client, file) {
  const fd = openSync(file, "w");
  const put = (s) => writeSync(fd, s);
  try {
    // One read transaction, so every table is copied from the same moment
    // (no expense without its shares because someone saved mid-backup).
    const tx = await client.transaction("read");
    const tables = await tx.execute(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND ${SKIP_TABLES_SQL} ORDER BY name`);
    // Indexes too, so a restored database is as fast as the original.
    const idx = await tx.execute("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND tbl_name NOT LIKE '_prisma%' AND tbl_name NOT LIKE 'libsql_%' AND tbl_name NOT LIKE '_cf_%'");
    put(`{"takenAt":${JSON.stringify(new Date().toISOString())},"indexes":${JSON.stringify(idx.rows.map((r) => String(r.sql)))},"tables":{`);
    let rows = 0;
    let firstTable = true;
    for (const t of tables.rows) {
      const name = String(t.name);
      put(`${firstTable ? "" : ","}${JSON.stringify(name)}:{"schema":${JSON.stringify(String(t.sql))},"rows":[`);
      firstTable = false;
      let first = true;
      for await (const page of pages(tx, name)) {
        for (const row of page) {
          put(`${first ? "" : ","}${jsonText(row)}`);
          first = false;
          rows++;
        }
      }
      put("]}");
    }
    put("}}");
    await tx.commit();
    return { tables: tables.rows.length, rows };
  } finally {
    closeSync(fd);
  }
}

// Run from the command line (not when a test imports the functions above).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.error("TURSO_DATABASE_URL is not set");
    process.exit(1);
  }
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const r = await backup(client, process.argv[2] ?? "backup.json");
  console.log(`Backed up ${r.tables} tables, ${r.rows} rows.`);
}
