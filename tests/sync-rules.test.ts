import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs without types
import { splitStatements, findForbiddenStatement, droppedUniqueIndexes } from "../scripts/sync-rules.mjs";

// L3 and L4: the statement checks behind scripts/turso-sync.mjs.
const bad = (sql: string) => findForbiddenStatement(splitStatements(sql));

describe("statement check (L4)", () => {
  it("allows ordinary additions", () => {
    expect(bad('ALTER TABLE "T" ADD COLUMN "x" TEXT;\nCREATE INDEX "T_x_idx" ON "T"("x");')).toBeUndefined();
  });
  it("refuses each transaction or outside-database word", () => {
    for (const w of ["PRAGMA foreign_keys=OFF", "BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT a", "RELEASE a", "ATTACH 'x.db' AS o", "DETACH o"]) {
      expect(bad(`CREATE INDEX "i" ON "T"("x");\n${w};`), w).toBeDefined();
      expect(bad(`${w.toLowerCase()};`), w).toBeDefined();
    }
  });
  it("ignores the same words inside quotes: a column named \"commit\" passes", () => {
    expect(bad('ALTER TABLE "T" ADD COLUMN "commit" TEXT;')).toBeUndefined();
    expect(bad('ALTER TABLE "T" ADD COLUMN "end" TEXT DEFAULT \'rollback\';')).toBeUndefined();
    expect(bad('ALTER TABLE "T" ADD COLUMN "a""release" TEXT;')).toBeUndefined();
  });
  it("catches a word hidden after a quoted one", () => {
    expect(bad('ALTER TABLE "commit" ADD COLUMN "x" TEXT;\nCOMMIT;')).toBe("COMMIT");
  });
});

describe("dropping a unique index (L3)", () => {
  const U = 'CREATE UNIQUE INDEX "Pay_key" ON "Pay"("a","b")';
  const existing = [
    { type: "index", name: "Pay_key", sql: U },
    { type: "index", name: "Pay_plain", sql: 'CREATE INDEX "Pay_plain" ON "Pay"("a")' },
  ];
  it("a lone DROP of a unique index is flagged", () => {
    expect(droppedUniqueIndexes(['DROP INDEX "Pay_key"'], existing)).toEqual(["Pay_key"]);
  });
  it("a lone DROP of a plain index, or of one that does not exist, is not", () => {
    expect(droppedUniqueIndexes(['DROP INDEX "Pay_plain"', 'DROP INDEX "nothing"'], existing)).toEqual([]);
  });
  it("replaced by an identical CREATE UNIQUE in the same plan is fine (spacing ignored)", () => {
    const stmts = splitStatements('-- x\nDROP INDEX "Pay_key";\nCREATE UNIQUE INDEX "Pay_key"\n  ON "Pay"("a","b");');
    expect(droppedUniqueIndexes(stmts, existing)).toEqual([]);
  });
  it("replaced by a different unique index (other columns) is flagged", () => {
    expect(droppedUniqueIndexes(['DROP INDEX "Pay_key"', 'CREATE UNIQUE INDEX "Pay_key" ON "Pay"("a")'], existing)).toEqual(["Pay_key"]);
  });
  it("replaced by a non-unique index is flagged", () => {
    expect(droppedUniqueIndexes(['DROP INDEX "Pay_key"', 'CREATE INDEX "Pay_key" ON "Pay"("a","b")'], existing)).toEqual(["Pay_key"]);
  });
});
