import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

// scripts/turso-sync.mjs against throwaway `file:` databases (never a real one). Needs Prisma's CLI, as the script does:
// the "online" database is built from a small fixture schema, then synced to a changed fixture schema.
// OB-4, OB-5, OB-11, OB-12, OB-13, OA-10.

const HEAD = 'datasource db {\n  provider = "sqlite"\n  url      = "file:./unused.db"\n}\n';
const THING = (extra = "", attrs = "") => `${HEAD}model Thing {\n  id   String @id\n  name String\n${extra}${attrs}}\n`;
const dir = mkdtempSync(join(tmpdir(), "lp-sync-"));
let n = 0;
const schemaFile = (text: string) => {
  const f = join(dir, `schema-${n++}.prisma`);
  writeFileSync(f, text);
  return f;
};
const prisma = (args: string[]) => spawnSync("npx", ["prisma", ...args], { cwd: process.cwd(), encoding: "utf8" });

// An "online" database as `from` describes it, with two rows (a, b).
async function online(from: string) {
  const sql = prisma(["migrate", "diff", "--from-empty", "--to-schema-datamodel", schemaFile(from), "--script"]).stdout;
  const file = join(dir, `online-${n++}.db`);
  const c = createClient({ url: `file:${file}` });
  await c.executeMultiple(sql);
  await c.execute("INSERT INTO \"Thing\" (id, name) VALUES ('1', 'a')");
  await c.execute("INSERT INTO \"Thing\" (id, name) VALUES ('2', 'b')");
  c.close();
  return file;
}
const sync = (file: string, to: string, args: string[] = [], env: Record<string, string> = {}) => {
  const clean = { ...process.env } as Record<string, string | undefined>;
  for (const k of ["ALLOW_DESTRUCTIVE_MIGRATION", "LOOPIN_DB_TARGET", "GITHUB_ACTIONS", "GITHUB_REF", "VERCEL", "VERCEL_ENV"]) delete clean[k];
  const r = spawnSync("node", ["scripts/turso-sync.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...clean, TURSO_DATABASE_URL: `file:${file}`, TURSO_AUTH_TOKEN: "", TURSO_SYNC_SCHEMA: to, ...env },
  });
  return { code: r.status, out: r.stdout + r.stderr };
};
async function columns(file: string) {
  const c = createClient({ url: `file:${file}` });
  const r = (await c.execute('PRAGMA table_info("Thing")')).rows.map((x) => String(x.name));
  c.close();
  return r;
}

// Each case runs Prisma's CLI a few times, which can take several seconds.
vi.setConfig({ testTimeout: 90000 });

describe("turso-sync guards", () => {
  it("a required column with no default means a rebuild: --plan exits 3 with REFUSE, apply exits 1, nothing changes", async () => {
    const file = await online(THING());
    const to = schemaFile(THING("  extra String\n"));
    const plan = sync(file, to, ["--plan"]);
    expect(plan.code, plan.out).toBe(3);
    expect(plan.out).toContain("REFUSE");
    const apply = sync(file, to);
    expect(apply.code, apply.out).toBe(1);
    expect(apply.out).toContain("REFUSING");
    expect(await columns(file)).toEqual(["id", "name"]);
  });

  it("ALLOW_DESTRUCTIVE_MIGRATION set to anything is refused, even with nothing to change", async () => {
    const file = await online(THING());
    const to = schemaFile(THING());
    const r = sync(file, to, [], { ALLOW_DESTRUCTIVE_MIGRATION: "1" });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("no longer used");
    expect(r.out).toContain("Remove it from Vercel");
  });

  it("the live target from a branch other than main is refused before connecting (the file is byte-for-byte unchanged)", async () => {
    const file = await online(THING());
    const to = schemaFile(THING("  extra String @default(\"\")\n"));
    const before = readFileSync(file);
    const r = sync(file, to, [], { LOOPIN_DB_TARGET: "live", GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/x" });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("only be changed from the main branch");
    expect(Buffer.compare(before, readFileSync(file))).toBe(0);
    // ...and from main it goes ahead.
    const ok = sync(file, to, [], { LOOPIN_DB_TARGET: "live", GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main" });
    expect(ok.code, ok.out).toBe(0);
    expect(await columns(file)).toEqual(["id", "name", "extra"]);
  });

  it("a column defaulting to now() is refused with a plain message naming the column, not a stack trace", async () => {
    const file = await online(THING());
    const to = schemaFile(THING("  at DateTime @default(now())\n"));
    const r = sync(file, to);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("Thing.at");
    expect(r.out).toContain("make it optional");
    expect(r.out).not.toMatch(/\n\s+at .*\.(m?js|ts):\d+/);
    expect(await columns(file)).toEqual(["id", "name"]);
  });

  it("a new column plus a unique index over duplicate rows fails as a whole: the column is NOT added", async () => {
    const file = await online(THING());
    // Both existing rows get the default "x", so the unique index cannot be built.
    const to = schemaFile(THING('  code String @default("x") @unique\n'));
    const plan = sync(file, to, ["--plan"]);
    expect(plan.code, plan.out).toBe(0);
    const r = sync(file, to);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("rolled back");
    expect(await columns(file)).toEqual(["id", "name"]);
  });

  it("an added column with a constant default is applied in place, and a second run has nothing to do", async () => {
    const file = await online(THING());
    const to = schemaFile(THING('  note String @default("")\n'));
    expect(sync(file, to).code).toBe(0);
    expect(await columns(file)).toEqual(["id", "name", "note"]);
    const again = sync(file, to);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain("already matches");
  });

  it("DROP INDEX on its own is applied, not refused", async () => {
    const file = await online(THING("", "  @@index([name])\n"));
    const to = schemaFile(THING());
    const plan = sync(file, to, ["--plan"]);
    expect(plan.code, plan.out).toBe(0);
    expect(plan.out).toContain("DROP INDEX");
    const r = sync(file, to);
    expect(r.code, r.out).toBe(0);
    const c = createClient({ url: `file:${file}` });
    const idx = (await c.execute("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")).rows;
    c.close();
    expect(idx.length).toBe(0);
  });

  it("L3: dropping a UNIQUE index is refused (plan exits 3 with REFUSE, apply exits 1, the index is still there)", async () => {
    const file = await online(THING("", "  @@unique([name])\n"));
    const to = schemaFile(THING());
    const plan = sync(file, to, ["--plan"]);
    expect(plan.code, plan.out).toBe(3);
    expect(plan.out).toContain("REFUSE: unique index Thing_name_key");
    const r = sync(file, to);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("UNIQUE index Thing_name_key");
    const c = createClient({ url: `file:${file}` });
    const idx = (await c.execute("SELECT name FROM sqlite_master WHERE type='index' AND name = 'Thing_name_key'")).rows;
    c.close();
    expect(idx.length).toBe(1);
  });

  it("L2: a restore-drill copy (it has the _loopin_drill_target table) is never deployed to, plan or apply", async () => {
    const file = await online(THING());
    const c = createClient({ url: `file:${file}` });
    await c.execute('CREATE TABLE "_loopin_drill_target" ("note" TEXT)');
    c.close();
    const to = schemaFile(THING("  extra String @default(\"x\")\n"));
    for (const args of [[], ["--plan"]]) {
      const r = sync(file, to, args);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain("restore-drill copy");
    }
    expect(await columns(file)).toEqual(["id", "name"]);
  });
});
