import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

// OA-2: `restore.mjs --drill` is only allowed into a database that is empty or carries the drill marker table.
// Anything else is refused untouched, so the weekly drill can never wipe the live database.
const MARKER = "_loopin_drill_target";

function backup(dir: string, groupIds: string[]) {
  const tables = {
    Group: { schema: 'CREATE TABLE "Group" ("id" TEXT NOT NULL PRIMARY KEY)', rows: groupIds.map((id) => ({ id })) },
    Member: {
      schema: 'CREATE TABLE "Member" ("id" TEXT NOT NULL PRIMARY KEY, "groupId" TEXT NOT NULL, FOREIGN KEY ("groupId") REFERENCES "Group" ("id"))',
      rows: groupIds.map((id) => ({ id: `m-${id}`, groupId: id })),
    },
  };
  const file = join(dir, `backup-${groupIds.join("")}.json`);
  writeFileSync(file, JSON.stringify({ takenAt: "2026-11-17T00:00:00Z", tables, indexes: [] }));
  return file;
}
const run = (args: string[]) => spawnSync("node", ["scripts/restore.mjs", ...args], { cwd: process.cwd(), encoding: "utf8" });
async function tablesOf(url: string) {
  const c = createClient({ url });
  const t = (await c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")).rows.map((r) => String(r.name));
  c.close();
  return t;
}

describe("restore --drill target rules", () => {
  it("an empty target is restored and gets the marker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-drill-"));
    const url = `file:${join(dir, "drill.db")}`;
    const r = run(["--drill", backup(dir, ["g1"]), url]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(await tablesOf(url)).toEqual(["Group", "Member", MARKER]);
  });

  it("a target with the marker is wiped and restored again (the old data is gone)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-drill-"));
    const url = `file:${join(dir, "drill.db")}`;
    expect(run(["--drill", backup(dir, ["g1", "g2"]), url]).status).toBe(0);
    const r = run(["--drill", backup(dir, ["g9"]), url]);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("drill database wiped (2 old tables dropped)");
    const c = createClient({ url });
    // Hand-counted: the second backup has exactly one group, g9; g1 and g2 must be gone.
    expect((await c.execute('SELECT id FROM "Group"')).rows.map((x) => String(x.id))).toEqual(["g9"]);
    c.close();
    expect(await tablesOf(url)).toContain(MARKER);
  });

  it("a non-empty target without the marker is refused with exit 1 and left untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-drill-"));
    const url = `file:${join(dir, "drill-spare.db")}`;
    const c = createClient({ url });
    await c.execute('CREATE TABLE "Group" ("id" TEXT PRIMARY KEY)');
    await c.execute("INSERT INTO \"Group\" VALUES ('precious')");
    c.close();
    const r = run(["--drill", backup(dir, ["g1"]), url]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Refusing to restore");
    expect(await tablesOf(url)).toEqual(["Group"]);
    const c2 = createClient({ url });
    expect((await c2.execute('SELECT id FROM "Group"')).rows.map((x) => String(x.id))).toEqual(["precious"]);
    c2.close();
  });

  it("without --drill, a target that has the marker is refused like any non-empty one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-drill-"));
    const url = `file:${join(dir, "drill.db")}`;
    expect(run(["--drill", backup(dir, ["g1"]), url]).status).toBe(0);
    const r = run([backup(dir, ["g2"]), url]);
    expect(r.status).toBe(1);
  });

  it("L2: --drill into an address without the word drill is refused before anything is touched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-rec-")); // not "drill" in the path, or the address would pass
    const file = join(dir, "new-live.db");
    const r = run(["--drill", backup(dir, ["g1"]), `file:${file}`]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('must contain the word "drill"');
    expect(existsSync(file)).toBe(false); // nothing was created, so no marker was planted
    // an online address too (refused before any connection is made)
    const o = run(["--drill", backup(dir, ["g1"]), "libsql://loopin-new-recovery.turso.io"]);
    expect(o.status).toBe(1);
    expect(o.stderr).toContain('must contain the word "drill"');
  });

  it("L2: the word drill is matched in any letter case, and a real restore (no --drill) into any name still works", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-drill-"));
    const a = `file:${join(dir, "Loopin-DRILL.db")}`;
    expect(run(["--drill", backup(dir, ["g1"]), a]).status).toBe(0);
    const b = `file:${join(dir, "recovered.db")}`;
    expect(run([backup(dir, ["g1"]), b]).status).toBe(0);
    expect(await tablesOf(b)).toEqual(["Group", "Member"]); // no marker in a real recovery
  });
});
