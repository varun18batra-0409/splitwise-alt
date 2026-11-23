// Restores a backup (made by scripts/backup.mjs, decrypted) into a database.
//   node scripts/restore.mjs backup.json file:/tmp/restored.db
//   node scripts/restore.mjs backup.json libsql://new-db.turso.io   (+ TURSO_AUTH_TOKEN)
//   node scripts/restore.mjs --drill backup.json libsql://loopin-restore-drill.turso.io   (+ TURSO_AUTH_TOKEN)
// The target must be EMPTY (a new database): it never overwrites live data.
//
// --drill is for the weekly restore test into a spare database that exists only for that (its address must contain
// "drill", or the run is refused). The target must be
// empty, or must hold the marker table "_loopin_drill_target" (put there by an earlier drill). With the marker
// the old tables are dropped first and then the backup is restored again. A database with tables but no marker
// is refused, exactly as without --drill. The live database never has the marker, and the drill's token can only
// open the drill database: two separate locks.
//
// Tables are loaded parents first (read from each table's foreign keys), so a database that enforces foreign
// keys accepts every row. If one table fails, it says which one and stops: the target is then half-filled.
// Prints a row count per table and checks they match the backup, then checks the restored data is whole:
// database integrity, PRAGMA foreign_key_check, and Loopin's money rules (see scripts/restore-checks.mjs).
// Exits 0 only when everything checks out; 1 if refused; 2 if anything is off or the restore stopped.
// RESTORE_FK_ON=1 (tests only) turns foreign-key enforcement on for the target, the way Turso may behave.
import { readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { checkRestored } from "./restore-checks.mjs";
import { SKIP_TABLES_SQL } from "./backup.mjs";

const DRILL_MARKER = "_loopin_drill_target";
const q = (n) => `"${String(n).replace(/"/g, '""')}"`;

// Parents first. `parents` maps table -> the tables it points to (self-links and tables outside the set are ignored).
// Returns { order } or { cycle } (a list of table names that can't be ordered).
function topoOrder(names, parents) {
  const set = new Set(names);
  const left = new Map(names.map((n) => [n, new Set([...(parents.get(n) ?? [])].filter((p) => p !== n && set.has(p)))]));
  const order = [];
  while (left.size) {
    // Stable: keep the original (alphabetical) order among tables that are ready at the same time.
    const ready = [...left.keys()].find((n) => left.get(n).size === 0);
    if (ready === undefined) return { cycle: [...left.keys()] };
    order.push(ready);
    left.delete(ready);
    for (const s of left.values()) s.delete(ready);
  }
  return { order };
}

async function parentsOf(client, names) {
  const parents = new Map();
  for (const n of names) {
    const fk = await client.execute(`PRAGMA foreign_key_list(${q(n)})`);
    parents.set(n, new Set(fk.rows.map((r) => String(r.table))));
  }
  return parents;
}

const firstLine = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 200);

async function main() {
  const args = process.argv.slice(2);
  const drill = args.includes("--drill");
  const [file, url] = args.filter((a) => a !== "--drill");
  if (!file || !url) {
    console.error("Usage: node scripts/restore.mjs [--drill] <backup.json> <database url>");
    process.exit(1);
  }
  // L2: a drill must only ever target a database that is named as a drill one. Otherwise a real recovery into a new
  // empty database, run with --drill by mistake, would plant the drill marker in what is about to become live.
  if (drill && !/drill/i.test(url)) {
    console.error('Refusing --drill: the target address must contain the word "drill" (the spare drill database). For a real recovery, run without --drill. Nothing was touched.');
    process.exit(1);
  }
  const backup = JSON.parse(readFileSync(file, "utf8"));
  const client = createClient({ url, authToken: url.startsWith("file:") ? undefined : process.env.TURSO_AUTH_TOKEN });

  const listTables = async () =>
    // The same skip list the backup uses (backup.mjs), so "an empty target" and "what was backed up" can never disagree.
    (await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND ${SKIP_TABLES_SQL}`)).rows.map((r) => String(r.name));

  const existing = await listTables();
  const hasMarker = existing.includes(DRILL_MARKER);
  if (backup.tables?.[DRILL_MARKER]) {
    console.error(`Refusing to restore: the backup itself has a table called ${DRILL_MARKER}.`);
    process.exit(1);
  }
  if (existing.length > 0 && !(drill && hasMarker)) {
    console.error(`Refusing to restore: the target already has ${existing.length} tables. Use a new, empty database.`);
    process.exit(1);
  }

  // Foreign keys are best left off while loading; the load order below does not depend on it.
  try {
    await client.execute(`PRAGMA foreign_keys = ${process.env.RESTORE_FK_ON === "1" ? "ON" : "OFF"}`);
  } catch {
    // some servers don't take the setting; the order is what makes the restore safe
  }

  let current = "(setup)";
  const stop = (what, e) => {
    console.log(`✗ restore stopped at ${what}: ${firstLine(e)}`);
    console.log(
      drill
        ? "this target is now half-filled. The drill marker is still there, so the next drill will wipe it and start again."
        : "this target is now half-filled: use a new empty database.",
    );
    process.exit(2);
  };

  try {
    if (drill) {
      // Wipe the previous drill, children first. The marker stays so a failed drill can be wiped next time.
      const old = existing.filter((n) => n !== DRILL_MARKER);
      const t = topoOrder(old, await parentsOf(client, old));
      if (t.cycle) {
        console.log(`✗ cannot wipe the drill database: its tables point at each other in a loop (${t.cycle.slice(0, 6).join(", ")})`);
        process.exit(2);
      }
      for (const n of [...t.order].reverse()) await client.execute(`DROP TABLE ${q(n)}`);
      if (!hasMarker) await client.execute(`CREATE TABLE ${q(DRILL_MARKER)} ("note" TEXT)`);
      if (old.length) console.log(`✓ drill database wiped (${old.length} old tables dropped)`);
    }

    current = "(creating tables)";
    const names = Object.keys(backup.tables);
    for (const name of names) {
      current = name;
      await client.execute(backup.tables[name].schema);
    }
    const parents = await parentsOf(client, names);
    const t = topoOrder(names, parents);
    if (t.cycle) {
      console.log(`✗ tables point at each other in a loop, so no safe load order exists: ${t.cycle.join(", ")}`);
      console.log("this target now has empty tables only: use a new empty database.");
      process.exit(2);
    }

    let ok = true;
    for (const name of t.order) {
      current = name;
      const tb = backup.tables[name];
      const qn = q(name);
      for (let i = 0; i < tb.rows.length; i += 200) {
        const chunk = tb.rows.slice(i, i + 200);
        await client.batch(
          chunk.map((row) => {
            const cols = Object.keys(row);
            // Bytes (a group's own photo) were saved as base64 text.
            const val = (v) => (v && typeof v === "object" && typeof v.$b64 === "string" ? new Uint8Array(Buffer.from(v.$b64, "base64")) : v);
            return { sql: `INSERT INTO ${qn} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`, args: cols.map((c) => val(row[c])) };
          }),
          "write",
        );
      }
      const n = Number((await client.execute(`SELECT COUNT(*) AS n FROM ${qn}`)).rows[0].n);
      const match = n === tb.rows.length;
      ok &&= match;
      console.log(`${match ? "✓" : "✗"} ${name}: ${n} rows${match ? "" : ` (backup has ${tb.rows.length})`}`);
    }
    current = "(indexes)";
    for (const sql of backup.indexes ?? []) await client.execute(sql);
    if (backup.indexes?.length) console.log(`✓ ${backup.indexes.length} indexes`);
    // Row counts alone can hide broken references, so check the data itself too.
    current = "(checks)";
    const checks = await checkRestored(client);
    for (const n of checks.notes) console.log(`✓ ${n}`);
    for (const p of checks.problems) console.log(`✗ ${p}`);
    ok &&= checks.problems.length === 0;
    console.log(ok ? `Restore complete and verified (backup taken ${backup.takenAt}).` : "Restore finished with differences — check above.");
    process.exit(ok ? 0 : 2);
  } catch (e) {
    stop(current, e);
  }
}

await main();
