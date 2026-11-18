// Brings the online database (Turso) up to date with prisma/schema.prisma —
// the hosted version of `prisma db push`, which doesn't work with Turso.
// Runs on every deploy. Safe to run any number of times; it only ADDS tables,
// columns and indexes, all in one transaction (all or nothing), and never
// drops or rebuilds anything: a change that would is refused, with no override.
//
// How: copy the online database's table layout (not its data) into a
// temporary local file, ask Prisma for the SQL that turns that layout into
// the schema, then run that SQL online.
//
//   node scripts/turso-sync.mjs          apply (exit 1 if refused or failed)
//   node scripts/turso-sync.mjs --plan   show the SQL; exit 3 (with a line starting "REFUSE") if apply would refuse
//
// Environment: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN; LOOPIN_DB_TARGET=live marks the real live database
// (the apply workflow sets it); TURSO_SYNC_SCHEMA overrides the schema file (tests only).
import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitStatements, findForbiddenStatement, droppedUniqueIndexes } from "./sync-rules.mjs";

// Rule 1 (OB-4): the old "allow a destructive change" switch is gone. If it is still set anywhere, say so loudly.
if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== undefined) {
  console.error("turso-sync: ALLOW_DESTRUCTIVE_MIGRATION is no longer used (changes that drop or rebuild tables are always refused). Remove it from Vercel.");
  process.exit(1);
}
// Rule 2 (OB-12): the live database may only be changed by a GitHub run on main.
if (process.env.LOOPIN_DB_TARGET === "live" && process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REF !== "refs/heads/main") {
  console.error("turso-sync: the live database may only be changed from the main branch. Nothing was touched.");
  process.exit(1);
}

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.log("turso-sync: no TURSO_DATABASE_URL set, nothing to do.");
  process.exit(0);
}
// Only the live (production) deployment may change the live database.
// Preview builds of unfinished branches must never touch it.
if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
  console.log(`turso-sync: ${process.env.VERCEL_ENV} build, leaving the database alone.`);
  process.exit(0);
}

// Rule 3 (OA-10): what counts as destructive. A DROP INDEX on its own is not (it loses no data), unless the index is UNIQUE (rule 10).
const DESTRUCTIVE = /\bDROP\s+(TABLE|VIEW|TRIGGER|COLUMN)\b|RedefineTables|"new_\w+"/i;
// Rule 4 (OB-13): a default SQLite can't add in place (it must be a constant).
const NON_CONSTANT_DEFAULT = /DEFAULT\s+(CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|\()/i;
const SCHEMA = process.env.TURSO_SYNC_SCHEMA || "prisma/schema.prisma";
const plan = process.argv.includes("--plan");
const firstLine = (e) => String(e?.message ?? e).split("\n")[0].slice(0, 200);

const remote = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const dir = mkdtempSync(join(tmpdir(), "schema-"));
const snapshot = join(dir, "online-layout.db");
let code = 0;
try {
  const { rows } = await remote.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '_cf_%'",
  );
  // Rule 9 (L2): a restore-drill copy (it carries the drill marker table) is never a place to deploy to: if a real
  // recovery were pointed at one by mistake, the marker would let the next drill wipe what had become live.
  if (rows.some((r) => r.type === "table" && String(r.name) === "_loopin_drill_target")) {
    console.error("turso-sync: REFUSING: this database is a restore-drill copy (it has the _loopin_drill_target table). A drill copy can never be deployed to. Nothing was touched.");
    process.exit(1);
  }
  const local = createClient({ url: `file:${snapshot}` });
  for (const kind of ["table", "index", "view", "trigger"]) {
    for (const r of rows.filter((x) => x.type === kind)) await local.execute(String(r.sql));
  }
  local.close();

  const diff = () =>
    execFileSync(
      "npx",
      ["prisma", "migrate", "diff", "--from-config-datasource", "--to-schema", SCHEMA, "--script"],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: `file:${snapshot}` } }, // prisma.config.ts reads the address from DATABASE_URL
    ).trim();
  const isEmpty = (x) => !x || /^-- This is an empty migration\.?$/.test(x);
  let sql = diff();
  const blocked = []; // columns that can't be added in place, named so the refusal says what to change

  // Prisma rebuilds a SQLite table even when the only change is new columns.
  // When that's all it is, add the columns in place instead (no copy, no drop)
  // — and prove it by applying them to the local copy and checking that
  // nothing is left to change.
  if (/RedefineTables/.test(sql)) {
    const adds = [];
    const check = createClient({ url: `file:${snapshot}` });
    for (const m of sql.matchAll(/CREATE TABLE "new_(\w+)" \(\n([\s\S]*?)\n\);/g)) {
      const [, table, body] = m;
      const old = new Set((await check.execute(`PRAGMA table_info("${table}")`)).rows.map((r) => String(r.name)));
      for (const raw of body.split("\n")) {
        const line = raw.trim().replace(/,$/, "");
        const col = /^"(\w+)"\s/.exec(line)?.[1];
        if (!col || old.has(col)) continue;
        // SQLite can add a column in place if it may be empty or has a constant default.
        if (/NOT NULL/.test(line) && !/DEFAULT/.test(line)) {
          blocked.push(`${table}.${col}: it is required but has no default. Give it a constant default, or make it optional (e.g. \`DateTime?\`) first.`);
          continue;
        }
        if (NON_CONSTANT_DEFAULT.test(line)) {
          blocked.push(`${table}.${col}: its default (such as now()) can't be added to a table that already has rows. Make it optional (\`DateTime?\`) first, fill it in later.`);
          continue;
        }
        const add = `ALTER TABLE "${table}" ADD COLUMN ${line};`;
        try {
          await check.execute(add); // prove it on the local copy first
          adds.push(add);
        } catch (e) {
          blocked.push(`${table}.${col}: SQLite will not add it in place (${firstLine(e)}). Make it optional first.`);
        }
      }
    }
    check.close();
    if (adds.length) {
      // What's left after the in-place columns (new tables, indexes, other
      // added columns) is used as is — as long as it rebuilds or drops nothing.
      const left = diff();
      // `diff()` reads the snapshot file, which now has the added columns.
      if (isEmpty(left)) sql = adds.join("\n");
      else if (!DESTRUCTIVE.test(left)) sql = [...adds, left].join("\n");
    }
  }

  // Rule 10 (L3): dropping a UNIQUE index silently removes a double-save guarantee, unless the same plan puts back an identical one.
  const lostUnique = isEmpty(sql) ? [] : droppedUniqueIndexes(splitStatements(sql), rows.map((r) => ({ type: String(r.type), name: String(r.name), sql: String(r.sql) })));
  const destructive = !isEmpty(sql) && (DESTRUCTIVE.test(sql) || lostUnique.length > 0);
  const explain = () => {
    for (const b of blocked) console.error(`turso-sync: cannot add column ${b}`);
    for (const u of lostUnique) console.error(`turso-sync: the plan drops the UNIQUE index ${u} (a double-save guarantee) without putting an identical one back`);
  };

  if (plan) {
    // Rule 5: just show what would change; say REFUSE (exit 3) when applying it would be refused.
    console.log(isEmpty(sql) ? "(nothing to change)" : sql);
    if (destructive) {
      console.log("REFUSE: this change would drop or rebuild a table, so a deploy would stop. Nothing was changed.");
      for (const b of blocked) console.log(`REFUSE: column ${b}`);
      for (const u of lostUnique) console.log(`REFUSE: unique index ${u} would be dropped without an identical one put back`);
      code = 3;
    } else if (!isEmpty(sql)) {
      // Rule 8: for each new unique index, how many rows already clash (counts only, read-only).
      for (const m of sql.matchAll(/CREATE UNIQUE INDEX "(\w+)" ON "(\w+)"\(([^)]*)\)/g)) {
        const [, name, table, colList] = m;
        const cols = colList.split(",").map((c) => c.trim());
        try {
          const where = cols.map((c) => `${c} IS NOT NULL`).join(" AND ");
          const r = await remote.execute(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM "${table}" WHERE ${where} GROUP BY ${cols.join(",")} HAVING COUNT(*) > 1)`);
          console.log(`turso-sync: unique index ${name}: ${Number(r.rows[0].n)} group(s) of rows already clash${Number(r.rows[0].n) ? " (the apply would fail)" : ""}`);
        } catch {
          console.log(`turso-sync: unique index ${name}: clashes can't be counted yet (its column is not there yet)`);
        }
      }
    }
  } else if (isEmpty(sql)) {
    console.log("turso-sync: online database already matches the schema.");
  } else if (destructive) {
    // Rule 6: dropping or rebuilding a table can lose saved data. There is no override: a rebuild is a separate,
    // rehearsed, founder-approved procedure, built only when one is needed.
    console.error("turso-sync: REFUSING a change that drops or rebuilds tables:\n" + sql);
    explain();
    console.error("This is never done by a deploy. It needs a separate, rehearsed procedure that the owner approves.");
    code = 1;
  } else {
    const stmts = splitStatements(sql);
    const bad = findForbiddenStatement(stmts);
    if (bad) {
      console.error(`turso-sync: REFUSING: a statement uses PRAGMA/BEGIN/COMMIT/END/ROLLBACK/SAVEPOINT/RELEASE/ATTACH/DETACH, which can't run inside the all-or-nothing batch:\n${bad.split("\n")[0]}`);
      code = 1;
    } else {
      console.log("turso-sync: applying\n" + sql);
      try {
        // One transaction: if any statement fails (for example a new unique index over duplicate rows), none is kept.
        await remote.batch(stmts, "write");
        console.log("turso-sync: done.");
      } catch (e) {
        console.error(`turso-sync: the change FAILED and was rolled back (nothing was kept): ${firstLine(e)}`);
        code = 1;
      }
    }
  }
} catch (e) {
  console.error(`turso-sync: stopped: ${firstLine(e)}`);
  code = 1;
} finally {
  remote.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
