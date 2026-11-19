import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";

// Speed stage 4: the six new indexes. The release must be add-only. On a throwaway file built from the schema as it was BEFORE the
// indexes (this schema with the six lines taken out), scripts/turso-sync.mjs:
//   - --plan exits 0 and lists exactly the six CREATE INDEX lines (no DROP, no "new_" table, no RedefineTables);
//   - applying it leaves the row counts and the money sums of Expense, ExpenseShare and Payment unchanged;
//   - a second run says the database already matches.
// Never a real database.
vi.setConfig({ testTimeout: 120000 });

const SIX = [
  'CREATE INDEX "Expense_groupId_createdAt_idx" ON "Expense"("groupId", "createdAt");',
  'CREATE INDEX "Payment_groupId_createdAt_idx" ON "Payment"("groupId", "createdAt");',
  'CREATE INDEX "Payment_toId_idx" ON "Payment"("toId");',
  'CREATE INDEX "Payment_fromId_idx" ON "Payment"("fromId");',
  'CREATE INDEX "GroupEvent_groupId_kind_idx" ON "GroupEvent"("groupId", "kind");',
  'CREATE INDEX "Invite_email_idx" ON "Invite"("email");',
];

const dir = mkdtempSync(join(tmpdir(), "lp-idx-"));
const current = readFileSync("prisma/schema.prisma", "utf8");
const marked = (l: string) => /^\s*@@index\(/.test(l) && l.includes("(add-only index)");
const before = current.split("\n").filter((l) => !marked(l)).join("\n");
const beforeFile = join(dir, "before.prisma");
writeFileSync(beforeFile, before);
const prisma = (args: string[]) => spawnSync("npx", ["prisma", ...args], { cwd: process.cwd(), encoding: "utf8" });

// Fills in every required column that has no default (the row only has to exist; its money columns are what we check).
async function insert(c: Client, table: string, values: Record<string, unknown>) {
  const cols = (await c.execute(`PRAGMA table_info("${table}")`)).rows;
  const row: Record<string, unknown> = { ...values };
  for (const col of cols) {
    const name = String(col.name);
    if (name in row || !Number(col.notnull) || col.dflt_value !== null) continue;
    row[name] = /INT|REAL|NUMERIC|DATETIME|BOOL/i.test(String(col.type)) ? 0 : "";
  }
  const names = Object.keys(row);
  await c.execute({ sql: `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`, args: names.map((n) => row[n] as never) });
}
async function sums(file: string) {
  const c = createClient({ url: `file:${file}` });
  const one = async (sql: string) => Object.values((await c.execute(sql)).rows[0]).map(Number);
  const out = {
    expense: await one('SELECT COUNT(*), SUM("amount") FROM "Expense"'),
    share: await one('SELECT COUNT(*), SUM("amount") FROM "ExpenseShare"'),
    payment: await one('SELECT COUNT(*), SUM("amount") FROM "Payment"'),
  };
  c.close();
  return out;
}
const sync = (file: string, args: string[] = []) => {
  const clean = { ...process.env } as Record<string, string | undefined>;
  for (const k of ["ALLOW_DESTRUCTIVE_MIGRATION", "LOOPIN_DB_TARGET", "GITHUB_ACTIONS", "GITHUB_REF", "VERCEL", "VERCEL_ENV"]) delete clean[k];
  const r = spawnSync("node", ["scripts/turso-sync.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...clean, TURSO_DATABASE_URL: `file:${file}`, TURSO_AUTH_TOKEN: "", TURSO_SYNC_SCHEMA: "prisma/schema.prisma" },
  });
  return { code: r.status, out: r.stdout + r.stderr };
};

describe("the index release is add-only", () => {
  it("the schema carries exactly six new @@index lines, and the old ones stay", () => {
    expect(current.split("\n").filter(marked)).toHaveLength(6);
    expect(before).toContain("@@index([groupId, createdAt])"); // GroupEvent's old index is still there
    expect(before).toContain("@@index([groupId])");
  });

  it("--plan lists only the six CREATE INDEX lines; applying changes no row or sum; the second run says it already matches", async () => {
    const sql = prisma(["migrate", "diff", "--from-empty", "--to-schema", beforeFile, "--script"]).stdout;
    expect(sql).toContain('CREATE TABLE "Expense"');
    const file = join(dir, "online.db");
    const c = createClient({ url: `file:${file}` });
    await c.executeMultiple(sql);
    await c.execute("PRAGMA foreign_keys = OFF");
    // A little real-looking money: 2 expenses (9000 + 5500) with 3 shares (9000 as 4500 + 4500, 5500), 2 payments (1200 + 800).
    await insert(c, "Group", { id: "g1", name: "T", inviteCode: "c1" });
    await insert(c, "Member", { id: "m1", groupId: "g1", name: "A" });
    await insert(c, "Member", { id: "m2", groupId: "g1", name: "B" });
    await insert(c, "Expense", { id: "e1", groupId: "g1", amount: 9000, paidById: "m1" });
    await insert(c, "Expense", { id: "e2", groupId: "g1", amount: 5500, paidById: "m2" });
    await insert(c, "ExpenseShare", { id: "s1", expenseId: "e1", memberId: "m1", amount: 4500 });
    await insert(c, "ExpenseShare", { id: "s2", expenseId: "e1", memberId: "m2", amount: 4500 });
    await insert(c, "ExpenseShare", { id: "s3", expenseId: "e2", memberId: "m1", amount: 5500 });
    await insert(c, "Payment", { id: "p1", groupId: "g1", fromId: "m2", toId: "m1", amount: 1200 });
    await insert(c, "Payment", { id: "p2", groupId: "g1", fromId: "m1", toId: "m2", amount: 800 });
    c.close();
    const was = await sums(file);
    expect(was).toEqual({ expense: [2, 14500], share: [3, 14500], payment: [2, 2000] });

    const plan = sync(file, ["--plan"]);
    expect(plan.code, plan.out).toBe(0);
    expect(plan.out).not.toMatch(/DROP|new_|RedefineTables|REFUSE/);
    const lines = plan.out.split("\n").map((l) => l.trim()).filter((l) => /^(CREATE|ALTER|DROP|INSERT|DELETE|UPDATE)\b/i.test(l));
    expect(lines.sort()).toEqual([...SIX].sort());
    console.log(`The six indexes the release adds:\n${lines.join("\n")}`);

    const apply = sync(file);
    expect(apply.code, apply.out).toBe(0);
    expect(await sums(file)).toEqual(was);
    const check = createClient({ url: `file:${file}` });
    const names = (await check.execute(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${SIX.map(() => "?").join(",")})`, SIX.map((s) => /"(\w+)"/.exec(s)![1]))).rows.map((r) => String(r.name));
    check.close();
    expect(names.sort()).toEqual(SIX.map((s) => /"(\w+)"/.exec(s)![1]).sort());

    const again = sync(file);
    expect(again.code, again.out).toBe(0);
    expect(again.out).toContain("already matches");
  });
});
