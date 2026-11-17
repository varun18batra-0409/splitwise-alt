// The statement checks behind scripts/turso-sync.mjs, kept apart so tests can call them directly.

// Rule 7: split Prisma's SQL into statements: comment lines dropped, a statement ends at a ";" at the end of a line.
export function splitStatements(sql) {
  const out = [];
  let cur = [];
  for (const line of sql.split("\n")) {
    if (/^\s*--/.test(line)) continue;
    if (!line.trim() && !cur.length) continue;
    cur.push(line);
    if (/;\s*$/.test(line)) {
      out.push(cur.join("\n").trim().replace(/;$/, ""));
      cur = [];
    }
  }
  const rest = cur.join("\n").trim();
  if (rest) out.push(rest.replace(/;$/, ""));
  return out.filter(Boolean);
}

// Words that would break "one transaction" or reach outside this database, ignoring anything inside quotes
// (a column called "commit" is fine).
export const TRANSACTION_WORDS = /\b(PRAGMA|BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|ATTACH|DETACH)\b/i;
export const outsideQuotes = (s) => s.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g, "");

// The first statement that may not run inside the all-or-nothing batch, or undefined.
export const findForbiddenStatement = (stmts) => stmts.find((s) => TRANSACTION_WORDS.test(outsideQuotes(s)));

const squash = (s) => String(s).replace(/\s+/g, " ").trim().replace(/;$/, "");

// Names of UNIQUE indexes that the plan drops and does not put back identically in the same plan.
// `existing` is the target's sqlite_master rows: [{ type, name, sql }] (read-only).
export function droppedUniqueIndexes(stmts, existing) {
  const out = [];
  for (const s of stmts) {
    const m = /^\s*DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?"?([\w.]+)"?\s*$/i.exec(s);
    if (!m) continue;
    const name = m[1];
    const old = existing.find((r) => r.type === "index" && r.name === name);
    if (!old || !old.sql || !/^\s*CREATE\s+UNIQUE\b/i.test(String(old.sql))) continue;
    const same = stmts.some((x) => /^\s*CREATE\s+UNIQUE\b/i.test(x) && squash(x) === squash(old.sql));
    if (!same) out.push(name);
  }
  return out;
}
