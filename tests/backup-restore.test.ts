import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

// The daily backup and its restore drill, end to end on small files:
// pictures (bytes) must survive, as well as text and numbers.
describe("backup and restore", () => {
  it("copies text, numbers and a group's photo bytes, and the restore matches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-backup-"));
    const src = `file:${join(dir, "src.db")}`;
    const db = createClient({ url: src });
    await db.execute('CREATE TABLE "GroupPhoto" ("groupId" TEXT PRIMARY KEY, "data" BLOB NOT NULL, "type" TEXT NOT NULL)');
    await db.execute('CREATE TABLE "Group" ("id" TEXT PRIMARY KEY, "name" TEXT, "n" INTEGER)');
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 250, 251, 252]);
    await db.execute({ sql: 'INSERT INTO "GroupPhoto" VALUES (?, ?, ?)', args: ["g1", photo, "image/jpeg"] });
    await db.execute({ sql: 'INSERT INTO "Group" VALUES (?, ?, ?)', args: ["g1", "Goa “trip” ✈️", 42] });
    db.close();

    const file = join(dir, "backup.json");
    execFileSync("node", ["scripts/backup.mjs", file], { env: { ...process.env, TURSO_DATABASE_URL: src, TURSO_AUTH_TOKEN: "" } });
    expect(JSON.parse(readFileSync(file, "utf8")).tables.GroupPhoto.rows[0].data.$b64).toBeTruthy();

    const out = `file:${join(dir, "out.db")}`;
    const log = execFileSync("node", ["scripts/restore.mjs", file, out]).toString();
    expect(log).toContain("Restore complete and verified");
    const back = createClient({ url: out });
    const p = (await back.execute('SELECT data FROM "GroupPhoto"')).rows[0].data as ArrayBuffer;
    expect([...new Uint8Array(p)]).toEqual([...photo]);
    const g = (await back.execute('SELECT name, n FROM "Group"')).rows[0];
    expect([g.name, Number(g.n)]).toEqual(["Goa “trip” ✈️", 42]);
    back.close();
  });
});
