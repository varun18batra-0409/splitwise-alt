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

  const sql = execFileSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-url", `file:${snapshot}`, "--to-schema-datamodel", "prisma/schema.prisma", "--script"],
    { encoding: "utf8" },
  ).trim();

  if (!sql || /^-- This is an empty migration\.?$/.test(sql)) {
    console.log("turso-sync: online database already matches the schema.");
  } else {
    console.log("turso-sync: applying\n" + sql);
    await remote.executeMultiple(sql);
    console.log("turso-sync: done.");
  }
} finally {
  remote.close();
  rmSync(dir, { recursive: true, force: true });
}
