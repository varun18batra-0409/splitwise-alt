import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  // OA-2: the backup lists tables A to Z, so Expense comes before the Group and Member it points to.
  // A database that enforces foreign keys (RESTORE_FK_ON=1 stands in for Turso) must still accept the restore.
  const alpha = () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-order-"));
    const tables = {
      Expense: { schema: 'CREATE TABLE "Expense" ("id" TEXT NOT NULL PRIMARY KEY, "groupId" TEXT NOT NULL, "paidById" TEXT NOT NULL, FOREIGN KEY ("groupId") REFERENCES "Group" ("id"), FOREIGN KEY ("paidById") REFERENCES "Member" ("id"))', rows: [{ id: "e1", groupId: "g1", paidById: "m1" }, { id: "e2", groupId: "g1", paidById: "m2" }] },
      ExpenseShare: { schema: 'CREATE TABLE "ExpenseShare" ("id" TEXT NOT NULL PRIMARY KEY, "expenseId" TEXT NOT NULL, "memberId" TEXT NOT NULL, FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id"), FOREIGN KEY ("memberId") REFERENCES "Member" ("id"))', rows: [{ id: "s1", expenseId: "e1", memberId: "m1" }] },
      Group: { schema: 'CREATE TABLE "Group" ("id" TEXT NOT NULL PRIMARY KEY)', rows: [{ id: "g1" }] },
      Member: { schema: 'CREATE TABLE "Member" ("id" TEXT NOT NULL PRIMARY KEY, "groupId" TEXT NOT NULL, FOREIGN KEY ("groupId") REFERENCES "Group" ("id"))', rows: [{ id: "m1", groupId: "g1" }, { id: "m2", groupId: "g1" }] },
    };
    const file = join(dir, "backup.json");
    writeFileSync(file, JSON.stringify({ takenAt: "2026-11-17T00:00:00Z", tables, indexes: [] }));
    return { dir, file };
  };
  const restore = (file: string, out: string, env: Record<string, string> = {}) =>
    spawnSync("node", ["scripts/restore.mjs", file, out], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, ...env } });

  it("loads parents before children, so a database that enforces foreign keys accepts it", () => {
    const { dir, file } = alpha();
    const r = restore(file, `file:${join(dir, "out.db")}`, { RESTORE_FK_ON: "1" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    // Hand-counted: 1 group, 2 members, 2 expenses, 1 share.
    for (const line of ["✓ Group: 1 rows", "✓ Member: 2 rows", "✓ Expense: 2 rows", "✓ ExpenseShare: 1 rows"]) expect(r.stdout).toContain(line);
    // Group before Member before Expense before ExpenseShare.
    const at = (t: string) => r.stdout.indexOf(`✓ ${t}:`);
    expect(at("Group")).toBeLessThan(at("Member"));
    expect(at("Member")).toBeLessThan(at("Expense"));
    expect(at("Expense")).toBeLessThan(at("ExpenseShare"));
  });

  it("names the table it stopped at, says the target is half-filled, and exits 2", () => {
    const { dir, file } = alpha();
    const b = JSON.parse(readFileSync(file, "utf8"));
    b.tables.Member.rows.push({ id: "m1", groupId: "g1" }); // a duplicate key: Member cannot be filled
    writeFileSync(file, JSON.stringify(b));
    const r = restore(file, `file:${join(dir, "out.db")}`);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("✗ restore stopped at Member:");
    expect(r.stdout).toContain("half-filled");
    expect(r.stdout).not.toContain("Restore complete");
  });

  it("stops with a clear message when tables point at each other in a loop", () => {
    const dir = mkdtempSync(join(tmpdir(), "lp-cycle-"));
    const tables = {
      A: { schema: 'CREATE TABLE "A" ("id" TEXT PRIMARY KEY, "b" TEXT REFERENCES "B" ("id"))', rows: [] },
      B: { schema: 'CREATE TABLE "B" ("id" TEXT PRIMARY KEY, "a" TEXT REFERENCES "A" ("id"))', rows: [] },
    };
    const file = join(dir, "backup.json");
    writeFileSync(file, JSON.stringify({ takenAt: "x", tables, indexes: [] }));
    const r = restore(file, `file:${join(dir, "out.db")}`);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("point at each other in a loop");
    expect(r.stdout).toContain("A, B");
  });
});
