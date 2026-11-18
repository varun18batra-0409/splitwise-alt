// One-off for the ops-staging-reset branch: empties the PRACTICE database. Prints counts only, never names.
// Refuses unless TURSO_DATABASE_URL (practice) and LIVE_URL (live) are both set and are different databases.
import { createClient } from "@libsql/client";
import { normaliseDbAddress, sameDb } from "./db-address.mjs";

const url = process.env.TURSO_DATABASE_URL;
const live = process.env.LIVE_URL;
if (!normaliseDbAddress(url) || !normaliseDbAddress(live) || sameDb(url, live)) {
  console.error("staging-reset: the practice and live addresses must both be set and differ. Nothing was touched.");
  process.exit(1);
}
const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const list = `SELECT type, name FROM sqlite_master
  WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '_cf_%'`;
const all = (await db.execute(list)).rows;
const tables = all.filter((r) => r.type === "table").map((r) => String(r.name));
let rows = 0;
for (const t of tables) rows += Number((await db.execute(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n);
console.log(`::notice title=Before::${tables.length} tables, ${rows} rows in total`);

await db.execute("PRAGMA foreign_keys=OFF");
for (const r of all.filter((x) => x.type === "view")) await db.execute(`DROP VIEW IF EXISTS "${r.name}"`);
for (const r of all.filter((x) => x.type === "trigger")) await db.execute(`DROP TRIGGER IF EXISTS "${r.name}"`);
for (const t of tables) await db.execute(`DROP TABLE IF EXISTS "${t}"`);
const left = (await db.execute(list)).rows.length;
console.log(`::notice title=Emptied::${left} objects left`);
process.exit(left ? 1 : 0);
