import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Every payment row is written by createPayment (src/lib/payments.ts), which also closes any waiting
// "I've paid" claim for the same pair in the same transaction. That is what stops one payment counting
// twice. If a new route writes a payment some other way, this test fails and says where.
//
// The only other writer is the Splitwise import (a one-off bulk copy of someone's old history; a brand-new
// group has no claims to cover).

const ALLOWED = new Set(["src/lib/payments.ts", "src/lib/splitwise-import.ts"]);
const WRITE = /\.payment\s*\.\s*(create|createMany|upsert|createManyAndReturn)\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "generated" || name === "node_modules" ? [] : walk(full);
    return /\.(ts|tsx|mjs)$/.test(name) ? [full] : [];
  });
}

describe("one place writes payments", () => {
  it("no code outside src/lib/payments.ts (and the Splitwise import) creates a payment row", () => {
    const root = path.resolve(__dirname, "..");
    const offenders = walk(path.join(root, "src"))
      .map((f) => path.relative(root, f).split(path.sep).join("/"))
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => WRITE.test(readFileSync(path.join(root, f), "utf8")));
    expect(offenders, `Use createPayment(tx, …) from src/lib/payments.ts instead in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the allowed writers still exist (so this test is looking at the right places)", () => {
    const root = path.resolve(__dirname, "..");
    expect(WRITE.test(readFileSync(path.join(root, "src/lib/payments.ts"), "utf8"))).toBe(true);
    expect(WRITE.test(readFileSync(path.join(root, "src/lib/splitwise-import.ts"), "utf8"))).toBe(true);
  });
});
