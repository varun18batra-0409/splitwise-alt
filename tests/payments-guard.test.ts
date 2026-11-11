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

// A payment that is brought back (deletedAt set to null) must go through restorePayments, which also closes a
// waiting "I've paid" for the same pair. Looks at every payment.update / updateMany call and its `data:` part.
const UNDELETE_ALLOWED = new Set(["src/lib/payments.ts"]);
function unDeletes(text: string): number {
  let n = 0;
  const call = /\.payment\s*\.\s*(update|updateMany)\s*\(/g;
  for (let m = call.exec(text); m; m = call.exec(text)) {
    // The text inside this call's brackets only.
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i++) depth += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
    const inside = text.slice(start, i);
    const at = inside.indexOf("data:");
    if (at >= 0 && /deletedAt\s*:\s*null/.test(inside.slice(at))) n++;
  }
  return n;
}

describe("one place brings payments back", () => {
  it("no code outside src/lib/payments.ts sets a payment's deletedAt back to null", () => {
    const root = path.resolve(__dirname, "..");
    const offenders = walk(path.join(root, "src"))
      .map((f) => path.relative(root, f).split(path.sep).join("/"))
      .filter((f) => !UNDELETE_ALLOWED.has(f))
      .filter((f) => unDeletes(readFileSync(path.join(root, f), "utf8")) > 0);
    expect(offenders, `Use restorePayments(tx, ids, actorId) from src/lib/payments.ts instead in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the detector sees the patterns it is meant to catch, and the allowed place still has one", () => {
    expect(unDeletes("await tx.payment.updateMany({ where: { id }, data: { deletedAt: null, deletedById: null } });")).toBe(1);
    expect(unDeletes("await tx.payment.update({ where: { id }, data: apply ? { deletedAt: null } : { deletedAt: new Date() } });")).toBe(1);
    expect(unDeletes("await tx.payment.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });")).toBe(0);
    const root = path.resolve(__dirname, "..");
    expect(unDeletes(readFileSync(path.join(root, "src/lib/payments.ts"), "utf8"))).toBeGreaterThan(0);
  });
});

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
