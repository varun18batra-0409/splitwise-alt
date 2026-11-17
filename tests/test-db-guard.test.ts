import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkTestDb } from "../scripts/test-db-rule";

// OB-10: test and demo scripts must never run against the live database.
const LIVE = "libsql://loopin-live-abc.turso.io";
const STAGING = "libsql://loopin-staging-xyz.turso.io";

describe("test-db-guard rules", () => {
  it("1. no database address (the local file) is fine", () => {
    expect(checkTestDb({}).ok).toBe(true);
    expect(checkTestDb({ TURSO_DATABASE_URL: "" }).ok).toBe(true);
  });
  it("2. a file: database is fine", () => {
    expect(checkTestDb({ TURSO_DATABASE_URL: "file:/tmp/x.db", LIVE_URL: "file:/tmp/x.db" }).ok).toBe(true);
  });
  it("3. an online database without LOOPIN_STAGING_DB=1 is refused", () => {
    expect(checkTestDb({ TURSO_DATABASE_URL: STAGING, LIVE_URL: LIVE }).ok).toBe(false);
    expect(checkTestDb({ TURSO_DATABASE_URL: STAGING, LIVE_URL: LIVE, LOOPIN_STAGING_DB: "0" }).ok).toBe(false);
  });
  it("4. an online database when the live address is not known is refused", () => {
    expect(checkTestDb({ TURSO_DATABASE_URL: STAGING, LOOPIN_STAGING_DB: "1" }).ok).toBe(false);
    expect(checkTestDb({ TURSO_DATABASE_URL: STAGING, LOOPIN_STAGING_DB: "1", LIVE_URL: "  " }).ok).toBe(false);
  });
  it("5. an online database equal to the live one is refused; a different one passes (either name for the live address)", () => {
    expect(checkTestDb({ TURSO_DATABASE_URL: LIVE, LOOPIN_STAGING_DB: "1", LIVE_URL: LIVE }).ok).toBe(false);
    expect(checkTestDb({ TURSO_DATABASE_URL: LIVE, LOOPIN_STAGING_DB: "1", LIVE_TURSO_DATABASE_URL: LIVE }).ok).toBe(false);
    expect(checkTestDb({ TURSO_DATABASE_URL: STAGING, LOOPIN_STAGING_DB: "1", LIVE_URL: LIVE }).ok).toBe(true);
    expect(checkTestDb({ TURSO_DATABASE_URL: STAGING, LOOPIN_STAGING_DB: "1", LIVE_TURSO_DATABASE_URL: LIVE }).ok).toBe(true);
  });
});

describe("test-db-guard as the first import", () => {
  const run = (env: Record<string, string>) => {
    const clean = { ...process.env } as Record<string, string | undefined>;
    for (const k of ["TURSO_DATABASE_URL", "LOOPIN_STAGING_DB", "LIVE_URL", "LIVE_TURSO_DATABASE_URL"]) delete clean[k];
    const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "scripts/test-db-guard.ts"], { cwd: process.cwd(), encoding: "utf8", env: { ...clean, ...env } });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  it("exits 1 on the live address, and the message never contains the address", () => {
    const r = run({ TURSO_DATABASE_URL: LIVE, LOOPIN_STAGING_DB: "1", LIVE_URL: LIVE });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("Refusing");
    expect(r.out).not.toContain("loopin-live-abc");
    expect(r.out).not.toContain("turso.io");
  });
  it("exits 0 quietly on a file: database", () => {
    const r = run({ TURSO_DATABASE_URL: "file:/tmp/x.db" });
    expect(r.code, r.out).toBe(0);
  });
});

describe("every script that uses the database imports the guard first", () => {
  for (const f of ["uat", "seed-demo", "load", "screenshots", "perf-audit", "hosted"]) {
    it(`scripts/${f}.ts`, () => {
      const firstImport = readFileSync(`scripts/${f}.ts`, "utf8").split("\n").find((l) => l.startsWith("import "));
      expect(firstImport).toContain('"./test-db-guard"');
    });
  }
});
