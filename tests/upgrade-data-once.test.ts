import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";

// OA-7: prisma/upgrade-data.mjs remembers which repair steps have nothing left to do and skips them on later deploys.
// Runs on a throwaway `file:` database built from the real schema (needs Prisma's CLI, like the deploy does).
//
// Hand-worked: one old expense, category "drinks", 5000 paise, no conversion details, no creator.
//   first run:  category -> "food", convertedAmount 0 -> 5000, createdById "" -> the payer "m1"; steps 1,2,3,5 are remembered.
//   then a SECOND old expense is added behind its back (the "sentinel"): a skipped run must leave it exactly as it is.
const run = (url: string) => {
  const env = { ...process.env, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "" } as Record<string, string | undefined>;
  delete env.VERCEL;
  delete env.VERCEL_ENV;
  const r = spawnSync("node", ["prisma/upgrade-data.mjs"], { cwd: process.cwd(), encoding: "utf8", env });
  return { code: r.status, out: r.stdout + r.stderr };
};

describe("data upgrade runs each finished step once", () => {
  it("first run repairs the old row and remembers the steps; the second run skips them", async () => {
    const sql = spawnSync("npx", ["prisma", "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/schema.prisma", "--script"], { cwd: process.cwd(), encoding: "utf8" });
    expect(sql.status, sql.stderr).toBe(0);
    const url = `file:${join(mkdtempSync(join(tmpdir(), "lp-upgrade-")), "scratch.db")}`;
    const c = createClient({ url });
    await c.executeMultiple(sql.stdout);
    await c.execute("INSERT INTO \"Group\" (id, name, inviteCode) VALUES ('g1', 'Goa', 'code1')");
    await c.execute("INSERT INTO \"Member\" (id, name, groupId) VALUES ('m1', 'Asha', 'g1')");
    const old = (id: string) =>
      c.execute({ sql: "INSERT INTO \"Expense\" (id, groupId, description, amount, splitType, paidById, category, convertedAmount, createdById) VALUES (?, 'g1', 'Old', 5000, 'equal', 'm1', 'drinks', 0, '')", args: [id] });
    await old("e1");

    const first = run(url);
    expect(first.code, first.out).toBe(0);
    expect(first.out).not.toContain("already done");
    const fixed = (await c.execute("SELECT category, convertedAmount, createdById FROM \"Expense\" WHERE id = 'e1'")).rows[0];
    expect([fixed.category, Number(fixed.convertedAmount), fixed.createdById]).toEqual(["food", 5000, "m1"]);
    const saved = (await c.execute("SELECT value FROM \"AppSetting\" WHERE key = 'data-upgrade:done'")).rows[0];
    expect(JSON.parse(String(saved.value))).toEqual(["1", "2", "3", "5"]);

    await old("sentinel");
    const second = run(url);
    expect(second.code, second.out).toBe(0);
    expect(second.out).toContain("steps 1,2,3,5 already done");
    const left = (await c.execute("SELECT category, convertedAmount, createdById FROM \"Expense\" WHERE id = 'sentinel'")).rows[0];
    expect([left.category, Number(left.convertedAmount), left.createdById]).toEqual(["drinks", 0, ""]);
    c.close();
  }, 90000);
});
