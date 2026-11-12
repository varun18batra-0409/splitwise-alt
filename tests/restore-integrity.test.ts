import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// OPS-01: the restore drill must check the data is whole, not only that row counts match.
// Each case builds a tiny backup file, restores it into a throwaway file with scripts/restore.mjs,
// and checks the exit code (0 = verified, 2 = something is off) and the message.

const T = {
  Group: 'CREATE TABLE "Group" ("id" TEXT NOT NULL PRIMARY KEY)',
  Member: 'CREATE TABLE "Member" ("id" TEXT NOT NULL PRIMARY KEY, "groupId" TEXT NOT NULL, FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE)',
  Expense:
    'CREATE TABLE "Expense" ("id" TEXT NOT NULL PRIMARY KEY, "groupId" TEXT NOT NULL, "amount" INTEGER NOT NULL, "paidById" TEXT NOT NULL, "payers" TEXT NOT NULL DEFAULT \'\', "deletedAt" DATETIME, FOREIGN KEY ("groupId") REFERENCES "Group" ("id"), FOREIGN KEY ("paidById") REFERENCES "Member" ("id"))',
  ExpenseShare:
    'CREATE TABLE "ExpenseShare" ("id" TEXT NOT NULL PRIMARY KEY, "expenseId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "amount" INTEGER NOT NULL, FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id") ON DELETE CASCADE, FOREIGN KEY ("memberId") REFERENCES "Member" ("id"))',
  Payment:
    'CREATE TABLE "Payment" ("id" TEXT NOT NULL PRIMARY KEY, "groupId" TEXT NOT NULL, "fromId" TEXT NOT NULL, "toId" TEXT NOT NULL, "amount" INTEGER NOT NULL, "deletedAt" DATETIME, FOREIGN KEY ("groupId") REFERENCES "Group" ("id"), FOREIGN KEY ("fromId") REFERENCES "Member" ("id"), FOREIGN KEY ("toId") REFERENCES "Member" ("id"))',
};
// The same tables with no foreign keys declared, so only Loopin's own rules can catch a broken reference.
const NO_FK = {
  ...T,
  Member: 'CREATE TABLE "Member" ("id" TEXT NOT NULL PRIMARY KEY, "groupId" TEXT NOT NULL)',
  Expense: 'CREATE TABLE "Expense" ("id" TEXT NOT NULL PRIMARY KEY, "groupId" TEXT NOT NULL, "amount" INTEGER NOT NULL, "paidById" TEXT NOT NULL, "payers" TEXT NOT NULL DEFAULT \'\', "deletedAt" DATETIME)',
  ExpenseShare: 'CREATE TABLE "ExpenseShare" ("id" TEXT NOT NULL PRIMARY KEY, "expenseId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "amount" INTEGER NOT NULL)',
  Payment: 'CREATE TABLE "Payment" ("id" TEXT NOT NULL PRIMARY KEY, "groupId" TEXT NOT NULL, "fromId" TEXT NOT NULL, "toId" TEXT NOT NULL, "amount" INTEGER NOT NULL, "deletedAt" DATETIME)',
};

type Rows = Record<string, Record<string, unknown>[]>;

// Hand-worked good data (paise): a Goa trip with three people.
//   Dinner 10000 paid by Asha, shares 3334 + 3333 + 3333 = 10000.
//   Taxi 9000 paid by Ravi, shares 3000 each.
//   Snacks 10000 paid 6000 by Zoe and 4000 by Ravi, shares 5000 for Asha and 5000 for Zoe.
//   One deleted expense (500) that stays in history and is left out of balances.
//   Ravi paid Asha 1000 back.
const good = (): Rows => ({
  Group: [{ id: "g1" }],
  Member: [
    { id: "asha", groupId: "g1" },
    { id: "ravi", groupId: "g1" },
    { id: "zoe", groupId: "g1" },
  ],
  Expense: [
    { id: "dinner", groupId: "g1", amount: 10000, paidById: "asha", payers: "", deletedAt: null },
    { id: "taxi", groupId: "g1", amount: 9000, paidById: "ravi", payers: "", deletedAt: null },
    // two payers, 6000 + 4000 = 10000; shares 5000 + 5000
    { id: "snacks", groupId: "g1", amount: 10000, paidById: "zoe", payers: JSON.stringify([{ m: "zoe", a: 6000 }, { m: "ravi", a: 4000 }]), deletedAt: null },
    // deleted: stays in history, but must still add up
    { id: "oops", groupId: "g1", amount: 500, paidById: "asha", payers: "", deletedAt: "2026-11-01T00:00:00Z" },
  ],
  ExpenseShare: [
    { id: "s1", expenseId: "dinner", memberId: "asha", amount: 3334 },
    { id: "s2", expenseId: "dinner", memberId: "ravi", amount: 3333 },
    { id: "s3", expenseId: "dinner", memberId: "zoe", amount: 3333 },
    { id: "s4", expenseId: "taxi", memberId: "asha", amount: 3000 },
    { id: "s5", expenseId: "taxi", memberId: "ravi", amount: 3000 },
    { id: "s6", expenseId: "taxi", memberId: "zoe", amount: 3000 },
    { id: "s7", expenseId: "snacks", memberId: "asha", amount: 5000 },
    { id: "s8", expenseId: "snacks", memberId: "zoe", amount: 5000 },
    { id: "s9", expenseId: "oops", memberId: "ravi", amount: 500 },
  ],
  Payment: [{ id: "p1", groupId: "g1", fromId: "ravi", toId: "asha", amount: 1000, deletedAt: null }],
});

function drill(rows: Rows, schemas: Record<string, string> = T) {
  const dir = mkdtempSync(join(tmpdir(), "lp-restore-"));
  const tables = Object.fromEntries(Object.keys(schemas).map((n) => [n, { schema: schemas[n], rows: rows[n] ?? [] }]));
  const file = join(dir, "backup.json");
  writeFileSync(file, JSON.stringify({ takenAt: "2026-11-12T00:00:00Z", tables, indexes: [] }));
  const r = spawnSync("node", ["scripts/restore.mjs", file, `file:${join(dir, "out.db")}`], { cwd: process.cwd(), encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe("restore drill checks the data, not only the row counts", () => {
  it("accepts a good backup: foreign keys fine, shares add up, every group balances to 0", () => {
    // Hand-worked balances (paid - shares + payments), in paise:
    //   Asha  = 10000 - (3334 + 3000 + 5000) + 1000 received... Ravi paid Asha: Ravi +1000, Asha -1000
    //   Asha  = 10000 - 11334 - 1000 = -2334
    //   Ravi  = 9000 + 4000 - (3333 + 3000) + 1000 = +7667
    //   Zoe   = 6000 - (3333 + 3000 + 5000) = -5333
    //   -2334 + 7667 - 5333 = 0 (the deleted 500 expense is left out)
    const r = drill(good());
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("Restore complete and verified");
    expect(r.out).toContain("no orphaned rows");
    expect(r.out).toContain("4 expenses, 1 payments and 1 group balance sheets add up exactly");
  });

  it("rejects a child row whose parent is missing (foreign_key_check)", () => {
    const rows = good();
    rows.ExpenseShare.push({ id: "bad", expenseId: "ghost-expense", memberId: "asha", amount: 1 });
    const r = drill(rows);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toMatch(/✗ Foreign keys: 1 row\(s\) point to something that is missing \(ExpenseShare: 1\)/);
    expect(r.out).not.toContain("Restore complete and verified");
  });

  it("rejects shares that do not add up to the amount", () => {
    const rows = good();
    rows.ExpenseShare[1].amount = 3332; // dinner shares now 9999 against 10000
    const r = drill(rows);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("✗ Expenses: 1 expense(s) whose shares do not add up to the amount, e.g. dinner (amount 10000, shares 9999)");
  });

  it("rejects an expense with no shares at all", () => {
    const rows = good();
    rows.Expense.push({ id: "lonely", groupId: "g1", amount: 700, paidById: "asha", payers: "", deletedAt: null });
    const r = drill(rows);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("lonely (amount 700, shares 0)");
  });

  it("rejects payers that do not add up, and a group whose balances no longer net to 0", () => {
    const rows = good();
    rows.Expense[2].payers = JSON.stringify([{ m: "zoe", a: 6000 }, { m: "ravi", a: 3000 }]); // 9000 against 10000
    const r = drill(rows);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("✗ Expenses: 1 expense(s) whose payers do not add up to the amount");
    expect(r.out).toContain("✗ Balances: 1 group(s) whose balances do not add up to 0, e.g. g1 (off by -1000)");
  });

  it("rejects shares, payments and payers that point to missing members even with no foreign keys declared", () => {
    const rows = good();
    rows.ExpenseShare.push({ id: "x", expenseId: "taxi", memberId: "nobody", amount: 0 });
    rows.Payment.push({ id: "p2", groupId: "g1", fromId: "nobody", toId: "asha", amount: 0, deletedAt: null });
    rows.Expense[2].payers = JSON.stringify([{ m: "zoe", a: 6000 }, { m: "ghost", a: 4000 }]);
    const r = drill(rows, NO_FK);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("✗ Shares: 1 share(s) point to a member that is not there");
    expect(r.out).toContain("✗ Payments: 1 payment(s) point to a member that is not there");
    expect(r.out).toContain("✗ Expenses: 1 payer(s) point to a member that is not there");
  });

  it("rejects shares of an expense that is not there, and a payment in a group that is not there", () => {
    const rows = good();
    rows.ExpenseShare.push({ id: "orphan", expenseId: "ghost", memberId: "asha", amount: 5 });
    rows.Payment.push({ id: "p3", groupId: "ghost-group", fromId: "ravi", toId: "asha", amount: 5, deletedAt: null });
    const r = drill(rows, NO_FK);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toContain("✗ Shares: 1 share(s) belong to an expense that is not there");
    expect(r.out).toContain("✗ Payments: 1 payment(s) belong to a group that is not there");
  });

  it("still accepts a backup that has none of the Loopin tables (the row counts and integrity still apply)", () => {
    const r = drill({ Group: [{ id: "g1" }] }, { Group: T.Group });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("Loopin rules not checked");
  });
});
