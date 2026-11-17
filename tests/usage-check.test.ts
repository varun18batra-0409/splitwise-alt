import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOrgUsage } from "../src/lib/usage-read";
import { readOrgUsage as readOrgUsageScript } from "../scripts/usage-read.mjs";

// OB-14: usage is read from organization.usage.* only, and a figure that can't be found fails the check (never a quiet pass).
const GOOD = { organization: { usage: { rows_read: 250_000_000, rows_written: 1_000_000, storage_bytes: 1024 ** 3 } } };

function check(answer: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "lp-usage-"));
  const file = join(dir, "usage.json");
  writeFileSync(file, JSON.stringify(answer));
  const env = { ...process.env, USAGE_CHECK_FIXTURE: file, TURSO_PLATFORM_TOKEN: "x", TURSO_ORG: "x" };
  const r = spawnSync("node", ["scripts/usage-check.mjs"], { cwd: process.cwd(), encoding: "utf8", env });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe("usage check", () => {
  it("reads the organization figures: 250,000,000 of 500,000,000 reads is 50%", () => {
    // Hand-worked: reads 250M/500M = 50%; writes 1M/10M = 10%; storage 1 GiB / 5 GiB = 20%. Worst 50% is under 70%: pass.
    const r = check(GOOD);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("rows read: 50%");
    expect(r.out).toContain("rows written: 10%");
    expect(r.out).toContain("storage bytes: 20%");
  });

  it("only a single database's rows_read (not under organization.usage) is not enough: exit 1", () => {
    const r = check({ databases: [{ name: "x", usage: { rows_read: 5 } }], rows_read: 7 });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("rows_read, rows_written, storage_bytes");
  });

  it("an empty answer fails: exit 1", () => {
    expect(check({}).code).toBe(1);
  });

  it("one missing figure fails and names it", () => {
    const r = check({ organization: { usage: { rows_read: 1, rows_written: 1 } } });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("storage_bytes");
  });

  it("70% or more fails as before (storage 4 GiB of 5 GiB = 80%)", () => {
    const r = check({ organization: { usage: { rows_read: 1, rows_written: 1, storage_bytes: 4 * 1024 ** 3 } } });
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("80%");
  });
});

describe("the reader, in the script and in the app, agree", () => {
  const cases: unknown[] = [GOOD, {}, null, "text", { organization: {} }, { organization: { usage: { rows_read: "5", rows_written: NaN, storage_bytes: 9 } } }, { rows_read: 3, organization: { usage: { rows_read: 4 } } }];
  it("gives the same figures for the same answer", () => {
    for (const c of cases) {
      const a = readOrgUsage(c);
      const b = readOrgUsageScript(c);
      expect([a.rowsRead, a.rowsWritten, a.storage]).toEqual([b.rows_read, b.rows_written, b.storage_bytes]);
    }
  });
  it("never takes a number from anywhere but organization.usage", () => {
    expect(readOrgUsage({ rows_read: 3, organization: { usage: { rows_read: 4 } } })).toEqual({ rowsRead: 4, rowsWritten: null, storage: null });
    expect(readOrgUsage({ databases: [{ usage: { rows_read: 9 } }] })).toEqual({ rowsRead: null, rowsWritten: null, storage: null });
  });
});
