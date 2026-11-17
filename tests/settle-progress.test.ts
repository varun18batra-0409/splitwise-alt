import { describe, expect, it } from "vitest";
import { settledPercent } from "@/lib/settle-ui";

// Batch B4, step 4a: "100% settled" can't show while a payment is still open, and "0%" can't show once something is paid.
describe("settledPercent(paid, left)", () => {
  const rows: [number, number, number][] = [
    [1995000, 5000, 99], // 99.75 rounds to 100, held at 99 (₹50 still to pay)
    [1, 1999999, 1], // 0.00005% rounds to 0, shown as 1 (something is paid)
    [0, 2000000, 0],
    [2000000, 0, 100],
    [1000000, 1000000, 50],
  ];
  for (const [paid, left, shows] of rows) {
    it(`paid ${paid}, left ${left} shows ${shows}`, () => expect(settledPercent(paid, left)).toBe(shows));
  }
  it("nothing paid and nothing left is 100 (nothing to do)", () => expect(settledPercent(0, 0)).toBe(100));
});
