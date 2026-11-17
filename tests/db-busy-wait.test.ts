import { afterAll, describe, expect, it, vi } from "vitest";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";

// The screenshot runs (and the app they drive) use a local database file through the online-database adapter. That client opens a
// fresh connection after every transaction, and a fresh connection gave up at once when another write was in progress ("busy").
// A write must wait for the other one to finish instead, also after a transaction, and also inside one. Throwaway copy only.

const dir = mkdtempSync(join(tmpdir(), "lp-busy-"));
const file = join(dir, "busy.db");
copyFileSync(resolve("prisma/dev.db"), file);
const url = `file:${file}`;

const before = process.env.TURSO_DATABASE_URL;
process.env.TURSO_DATABASE_URL = url;
delete (globalThis as { prisma?: unknown }).prisma;
vi.resetModules();
const { db } = await import("@/lib/db");
process.env.TURSO_DATABASE_URL = before;

const other = createClient({ url });
await other.execute("PRAGMA journal_mode = WAL");
await other.execute("CREATE TABLE IF NOT EXISTS busy_probe (x INTEGER)");

// Another process (like the app server beside the screenshot script) takes the write lock and lets go after `ms`. It has to be a
// separate process: the local client waits synchronously, so a holder in this process could never let go while we wait.
async function holdLock(ms: number) {
  const code = `const { createClient } = require("@libsql/client");
    const c = createClient({ url: ${JSON.stringify(url)} });
    (async () => {
      const tx = await c.transaction("write");
      await tx.execute("INSERT INTO busy_probe VALUES (0)");
      console.log("locked");
      setTimeout(async () => { await tx.commit(); c.close(); }, ${ms});
    })();`;
  const child = spawn(process.execPath, ["-e", code], { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((ok, fail) => {
    child.stdout.on("data", (d: Buffer) => d.toString().includes("locked") && ok());
    child.on("exit", (n) => fail(new Error(`the lock holder stopped early (${n})`)));
  });
  // Wrapped in an object: returning the bare promise from this async function would make the caller wait for the release too.
  return { released: new Promise<void>((done) => child.on("exit", () => done())) };
}

afterAll(async () => {
  delete (globalThis as { prisma?: unknown }).prisma; // later test files get their usual database again
  await db.$disconnect();
  other.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a local test database waits for another write instead of failing", () => {
  it("a plain write after a transaction waits", async () => {
    await db.$transaction(async (tx) => tx.$queryRawUnsafe("SELECT 1")); // the client now has a fresh connection
    const { released } = await holdLock(1500);
    // Proof the other write really holds the lock, and of the old fault: a fresh connection that isn't told to wait fails at once.
    const bare = createClient({ url });
    await expect(bare.execute("INSERT INTO busy_probe VALUES (9)")).rejects.toThrow(/busy|locked/i);
    bare.close();
    const t = Date.now();
    await db.$executeRawUnsafe("INSERT INTO busy_probe VALUES (1)");
    expect(Date.now() - t).toBeGreaterThanOrEqual(500);
    await released;
  }, 15_000);

  it("a write inside a transaction waits", async () => {
    await db.$transaction(async (tx) => tx.$queryRawUnsafe("SELECT 1"));
    const { released } = await holdLock(1000);
    const t = Date.now();
    await db.$transaction(async (tx) => tx.$executeRawUnsafe("INSERT INTO busy_probe VALUES (2)"), { timeout: 10_000, maxWait: 10_000 });
    expect(Date.now() - t).toBeGreaterThanOrEqual(500);
    await released;
  }, 15_000);

  it("transactions never stall: a list of calls, a nested one, and one after another", async () => {
    const [one] = await db.$transaction([db.$queryRawUnsafe<{ x: number }[]>("SELECT 1 AS x")]);
    expect(Number(one[0].x)).toBe(1);
    const got = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("INSERT INTO busy_probe VALUES (3)");
      return tx.$queryRawUnsafe<{ n: number }[]>("SELECT count(*) AS n FROM busy_probe WHERE x = 3");
    });
    expect(Number(got[0].n)).toBe(1);
    await Promise.all([db.$queryRawUnsafe("SELECT 1"), db.$transaction(async (tx) => tx.$queryRawUnsafe("SELECT 2")), db.$queryRawUnsafe("SELECT 3")]);
  }, 15_000);

  it("every call's connection is set to wait", async () => {
    await db.$transaction(async (tx) => tx.$queryRawUnsafe("SELECT 1"));
    const [row] = await db.$queryRawUnsafe<{ timeout: number | bigint }[]>("PRAGMA busy_timeout");
    expect(Number(row.timeout)).toBe(20000);
    const n = await other.execute("SELECT count(*) AS n FROM busy_probe WHERE x IN (1, 2)");
    expect(Number(n.rows[0].n)).toBe(2);
  }, 15_000);
});
