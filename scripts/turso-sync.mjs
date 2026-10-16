// Brings the online database (Turso) up to date with prisma/schema.prisma —
// the hosted version of `prisma db push`, which doesn't work with Turso.
// Runs on every deploy. Safe to run any number of times; it only adds or
// adjusts tables and columns and never deletes saved data on its own.
//
// How: copy the online database's table layout (not its data) into a
// temporary local file, ask Prisma for the SQL that turns that layout into
// the schema, then run that SQL online.
import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const remote = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const { rows } = await remote.execute(
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '_cf_%'",
);

const dir = mkdtempSync(join(tmpdir(), "schema-"));
const snapshot = join(dir, "online-layout.db");
try {
  const local = createClient({ url: `file:${snapshot}` });
  for (const kind of ["table", "index", "view", "trigger"]) {
    for (const r of rows.filter((x) => x.type === kind)) await local.execute(String(r.sql));
  }
  local.close();

  const diff = () =>
    execFileSync(
      "npx",
      ["prisma", "migrate", "diff", "--from-url", `file:${snapshot}`, "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
      { encoding: "utf8" },
    ).trim();
  const isEmpty = (x) => !x || /^-- This is an empty migration\.?$/.test(x);
  let sql = diff();

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
        // SQLite can add a column in place if it may be empty or has a default.
        if (/NOT NULL/.test(line) && !/DEFAULT/.test(line)) continue;
        adds.push(`ALTER TABLE "${table}" ADD COLUMN ${line};`);
      }
    }
    if (adds.length) {
      for (const a of adds) await check.execute(a);
      check.close();
      // What's left after the in-place columns (new tables, indexes, other
      // added columns) is used as is — as long as it rebuilds or drops nothing.
      const left = diff();
      if (isEmpty(left)) sql = adds.join("\n");
      else if (!/\bDROP\b|RedefineTables|new_/i.test(left)) sql = [...adds, left].join("\n");
    } else {
      check.close();
    }
  }

  if (process.argv.includes("--plan")) {
    // Just show what would change (used to check a deploy before it runs).
    console.log(sql || "(nothing to change)");
  } else if (isEmpty(sql)) {
    console.log("turso-sync: online database already matches the schema.");
  } else if (/\bDROP\b|RedefineTables|new_/i.test(sql) && process.env.ALLOW_DESTRUCTIVE_MIGRATION !== "1") {
    // Dropping or rebuilding a table can lose saved data. Stop the deploy
    // instead; a person must take a backup and allow it on purpose.
    console.error("turso-sync: REFUSING a change that drops or rebuilds tables:\n" + sql);
    console.error("Take a backup, then set ALLOW_DESTRUCTIVE_MIGRATION=1 for one deploy if this is intended.");
    process.exit(1);
  } else {
    console.log("turso-sync: applying\n" + sql);
    await remote.executeMultiple(sql);
    console.log("turso-sync: done.");
  }
} finally {
  remote.close();
  rmSync(dir, { recursive: true, force: true });
}
