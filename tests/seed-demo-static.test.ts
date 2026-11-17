import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// OB-15: the demo seed must use the app's own functions for money, and must not hide a failure.
describe("seed-demo uses the app's own money functions", () => {
  const src = readFileSync("scripts/seed-demo.ts", "utf8");
  it("writes no payment straight to the database", () => {
    expect(src).not.toMatch(/db\.payment\.create/);
    expect(src).toContain("recordPaymentCore");
    expect(src).toMatch(/warnOver:\s*false/);
    expect(src).toMatch(/fp:\s*"seed"/);
  });
  it("hides no failure (no .catch(() => undefined))", () => {
    expect(src).not.toMatch(/\.catch\(\s*\(\)\s*=>\s*undefined\s*\)/);
  });
  it("settles and closes Goa with the app's own Settle everything & close, and throws if it does not work", () => {
    expect(src).toContain("settleAllAndClose");
    expect(src).toMatch(/if \(!settled\.ok\) throw/);
    expect(src).toMatch(/if \(paid\.kind !== "done"\) throw/);
    // Goa is created open (the app closes it), not pre-closed.
    expect(src).toMatch(/group\("Goa 2025", \[[^\]]*\]\)/);
  });
});
