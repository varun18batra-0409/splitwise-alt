// One-off upgrade (DEF-010): adds database links ("foreign keys") to the eight
// tables that nothing else points to, so the database itself refuses a row
// whose group, person, expense or account doesn't exist, and removes it when
// that thing is erased.
//
//   node scripts/db-links.mjs --plan    shows what would change; changes nothing
//   node scripts/db-links.mjs --apply   makes the change, in one transaction
//
// Uses TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (a file: URL for a rehearsal copy).
// The SQL is the one Prisma itself generates for prisma/schema.prisma, so the
// deploy's own schema sync finds nothing left to do afterwards.
//
// Safety:
// - Only the eight tables below may be rebuilt. Anything else in Prisma's SQL
//   (another table, a DROP of a parent) stops the run before any change.
// - Everything happens inside one write transaction. Before committing it
//   checks that every table has exactly the rows it had at the start and that
//   no link points nowhere; otherwise it rolls back and nothing changes.
// - Prints counts only, never any row's contents.
import { createClient } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LINKS = [
  ["Passkey", "accountId", "Account"],
  ["AccountNote", "accountId", "Account"],
  ["Postcard", "fromId", "Account"],
  ["Postcard", "toId", "Account"],
  ["Reaction", "expenseId", "Expense"],
  ["Reaction", "memberId", "Member"],
  ["Invite", "groupId", "Group"],
  ["PayLink", "groupId", "Group"],
  ["PayLink", "fromId", "Member"],
  ["PayLink", "toId", "Member"],
  ["GroupPhoto", "groupId", "Group"],
  ["Receipt", "groupId", "Group"],
];
const REBUILT = new Set(LINKS.map(([t]) => t));

const mode = process.argv[2];
if (mode !== "--plan" && mode !== "--apply") {
  console.error("Usage: node scripts/db-links.mjs --plan | --apply");
  process.exit(1);
}
const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("db-links: TURSO_DATABASE_URL is not set.");
  process.exit(1);
}
const where = url.startsWith("file:") ? "rehearsal copy" : "online database";
const db = createClient({ url, authToken: url.startsWith("file:") ? undefined : process.env.TURSO_AUTH_TOKEN });
const q = (n) => `"${n.replace(/"/g, '""')}"`;

const LAYOUT_SQL =
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '_cf_%'";

// Prisma's SQL to turn this database's layout into the schema (layout only, no data).
async function prismaSql() {
  const { rows } = await db.execute(LAYOUT_SQL);
  const dir = mkdtempSync(join(tmpdir(), "links-"));
  const snap = join(dir, "layout.db");
  try {
    const local = createClient({ url: `file:${snap}` });
    for (const kind of ["table", "index", "view", "trigger"]) for (const r of rows.filter((x) => x.type === kind)) await local.execute(String(r.sql));
    local.close();
    const out = execFileSync("npx", ["prisma", "migrate", "diff", "--from-url", `file:${snap}`, "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { encoding: "utf8" }).trim();
    return /^-- This is an empty migration\.?$/.test(out) || !out ? "" : out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Prisma's script → single statements, without its comments and PRAGMA lines
// (pragmas can't change inside a transaction; the checks below do their job).
function statements(sql) {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter((s) => s && !/^PRAGMA\b/i.test(s));
}

function checkScope(stmts) {
  const bad = [];
  for (const s of stmts) {
    const t =
      /^CREATE TABLE "new_(\w+)"/.exec(s)?.[1] ??
      /^INSERT INTO "new_(\w+)"/.exec(s)?.[1] ??
      /^DROP TABLE "(\w+)"/.exec(s)?.[1] ??
      /^ALTER TABLE "new_(\w+)" RENAME TO "(\w+)"/.exec(s)?.[1] ??
      /^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "(\w+)"/.exec(s)?.[1];
    if (!t || !REBUILT.has(t)) bad.push(s.split("\n")[0].slice(0, 120));
  }
  return bad;
}

const tablesOf = async (c) =>
  (await c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '_cf_%' ORDER BY name")).rows.map((r) => String(r.name));
async function counts(c) {
  const out = {};
  for (const t of await tablesOf(c)) out[t] = Number((await c.execute(`SELECT COUNT(*) AS n FROM ${q(t)}`)).rows[0].n);
  return out;
}
async function orphans(c) {
  const out = {};
  for (const [t, col, parent] of LINKS) {
    const n = Number((await c.execute(`SELECT COUNT(*) AS n FROM ${q(t)} WHERE ${q(col)} NOT IN (SELECT "id" FROM ${q(parent)})`)).rows[0].n);
    out[`${t}.${col}`] = n;
  }
  return out;
}
const linkCount = async (c) =>
  Number((await c.execute("SELECT COUNT(*) AS n FROM sqlite_master m, pragma_foreign_key_list(m.name) f WHERE m.type='table'")).rows[0].n);

console.log(`db-links: ${mode.slice(2)} on the ${where}.`);
console.log(`Link enforcement on this connection (PRAGMA foreign_keys): ${(await db.execute("PRAGMA foreign_keys")).rows[0][0]}`);
console.log(`Links in the database now: ${await linkCount(db)}`);

const sql = await prismaSql();
const stmts = statements(sql);
if (!stmts.length) {
  console.log("Nothing to change: the database already has these links.");
  db.close();
  process.exit(0);
}
const bad = checkScope(stmts);
const rebuilt = [...new Set(stmts.map((s) => /^CREATE TABLE "new_(\w+)"/.exec(s)?.[1]).filter(Boolean))];
console.log(`Prisma's change: ${stmts.length} statements, rebuilding ${rebuilt.length} tables: ${rebuilt.join(", ")}`);
const before0 = await counts(db);
const orph0 = await orphans(db);
console.log(`Rows now: ${Object.entries(before0).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`Rows that point nowhere (must be 0): ${Object.entries(orph0).map(([k, v]) => `${k} ${v}`).join(", ")}`);
if (bad.length) {
  console.error(`STOP: Prisma's SQL touches something outside the eight tables:\n${bad.join("\n")}`);
  process.exit(2);
}
if (mode === "--plan") {
  console.log("Plan only: nothing changed.\n--- SQL ---\n" + stmts.join(";\n") + ";");
  db.close();
  process.exit(0);
}

// --apply
const tx = await db.transaction("write");
let ok = false;
try {
  const before = await counts(tx);
  const orph = await orphans(tx);
  const lost = Object.entries(orph).filter(([, n]) => n > 0);
  if (lost.length) throw new Error(`rows that point nowhere: ${lost.map(([k, n]) => `${k} ${n}`).join(", ")}`);
  for (const s of stmts) await tx.execute(s);
  const after = await counts(tx);
  const diff = Object.keys({ ...before, ...after }).filter((t) => before[t] !== after[t]);
  if (diff.length) throw new Error(`row counts changed: ${diff.map((t) => `${t} ${before[t]}→${after[t]}`).join(", ")}`);
  const fk = (await tx.execute("PRAGMA foreign_key_check")).rows.length;
  if (fk) throw new Error(`${fk} rows fail the link check`);
  await tx.commit();
  ok = true;
  console.log(`Committed. Every table has the same rows as before (${Object.values(after).reduce((a, b) => a + b, 0)} rows in ${Object.keys(after).length} tables); link check: 0 problems.`);
} catch (err) {
  await tx.rollback().catch(() => undefined);
  console.error(`ROLLED BACK, nothing changed: ${String(err.message ?? err).slice(0, 400)}`);
} finally {
  tx.close();
}
if (!ok) process.exit(3);

// Afterwards: the deploy's schema sync must find nothing to do, and the links must be there.
const left = statements(await prismaSql());
console.log(`Links in the database now: ${await linkCount(db)}`);
console.log(left.length ? `WARNING: Prisma still sees ${left.length} changes: ${left.map((s) => s.split("\n")[0]).join(" | ").slice(0, 600)}` : "Schema check: the database now matches the schema exactly (the deploy will find nothing to change).");
const finalCounts = await counts(db);
console.log(`Rows after: ${Object.entries(finalCounts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
db.close();
process.exit(left.length ? 4 : 0);
