import { describe, expect, it } from "vitest";
import { computeSplit, splitEqual, splitExact, splitPercent, type Share } from "@/lib/split";

const sum = (shares: Share[]) => shares.reduce((s, x) => s + x.amount, 0);
function shares(r: ReturnType<typeof splitEqual>) {
  if (!r.ok) throw new Error(r.error);
  return r.shares;
}

describe("splitEqual", () => {
  it("splits evenly when it divides", () => {
    expect(shares(splitEqual(30000, ["a", "b", "c"])).map((s) => s.amount)).toEqual([10000, 10000, 10000]);
  });

  it("gives leftover paise to the first people, total stays exact", () => {
    const s = shares(splitEqual(10000, ["a", "b", "c"])); // ₹100 / 3
    expect(s.map((x) => x.amount)).toEqual([3334, 3333, 3333]);
    expect(sum(s)).toBe(10000);
  });

  it("handles 1 paisa among many people", () => {
    const s = shares(splitEqual(1, ["a", "b", "c"]));
    expect(s.map((x) => x.amount)).toEqual([1, 0, 0]);
  });

  it("ignores the same person listed twice", () => {
    expect(shares(splitEqual(1000, ["a", "a", "b"])).length).toBe(2);
  });

  it("always adds up exactly, for many random amounts", () => {
    for (let i = 0; i < 500; i++) {
      const total = 1 + Math.floor(Math.random() * 10_000_000);
      const people = Array.from({ length: 1 + (i % 9) }, (_, k) => `p${k}`);
      const s = shares(splitEqual(total, people));
      expect(sum(s)).toBe(total);
      const amounts = s.map((x) => x.amount);
      expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
    }
  });

  it("rejects zero amount and no people", () => {
    expect(splitEqual(0, ["a"]).ok).toBe(false);
    expect(splitEqual(100, []).ok).toBe(false);
  });
});

describe("splitExact", () => {
  it("accepts amounts that add up", () => {
    const s = shares(splitExact(50000, [{ memberId: "a", amount: 30000 }, { memberId: "b", amount: 20000 }]));
    expect(sum(s)).toBe(50000);
  });

  it("drops people with zero", () => {
    const s = shares(splitExact(500, [{ memberId: "a", amount: 500 }, { memberId: "b", amount: 0 }]));
    expect(s).toEqual([{ memberId: "a", amount: 500 }]);
  });

  it("explains when amounts don't add up", () => {
    const r = splitExact(50000, [{ memberId: "a", amount: 30000 }, { memberId: "b", amount: 10000 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("₹400");
  });
});

describe("splitPercent", () => {
  it("splits by percentage", () => {
    const s = shares(splitPercent(100000, [{ memberId: "a", basisPoints: 6000 }, { memberId: "b", basisPoints: 4000 }]));
    expect(s.map((x) => x.amount)).toEqual([60000, 40000]);
  });

  it("thirds of ₹100 still add up to exactly ₹100", () => {
    const s = shares(
      splitPercent(10000, [
        { memberId: "a", basisPoints: 3333 },
        { memberId: "b", basisPoints: 3333 },
        { memberId: "c", basisPoints: 3334 },
      ]),
    );
    expect(sum(s)).toBe(10000);
  });

  it("gives rounding leftovers to whoever lost the most", () => {
    // ₹0.10 split 55% / 45% → 5.5p and 4.5p → first gets the extra paisa (tie → listed first)
    const s = shares(splitPercent(10, [{ memberId: "a", basisPoints: 5500 }, { memberId: "b", basisPoints: 4500 }]));
    expect(s.map((x) => x.amount)).toEqual([6, 4]);
  });

  it("always adds up exactly, for many random splits", () => {
    for (let i = 0; i < 500; i++) {
      const total = 1 + Math.floor(Math.random() * 10_000_000);
      const a = Math.floor(Math.random() * 10001);
      const b = Math.floor(Math.random() * (10001 - a));
      const c = 10000 - a - b;
      const s = shares(
        splitPercent(total, [
          { memberId: "a", basisPoints: a },
          { memberId: "b", basisPoints: b },
          { memberId: "c", basisPoints: c },
        ]),
      );
      expect(sum(s)).toBe(total);
    }
  });

  it("rejects percentages that aren't 100%", () => {
    const r = splitPercent(1000, [{ memberId: "a", basisPoints: 5000 }, { memberId: "b", basisPoints: 4000 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("90%");
  });
});

describe("computeSplit (what the Add expense screen uses)", () => {
  const base = { memberIds: ["a", "b", "c"], participants: ["a", "b", "c"], exact: {}, percent: {} };

  it("equal split among only the ticked people", () => {
    const r = computeSplit({ ...base, amount: "300", splitType: "equal", participants: ["a", "c"] });
    expect(r.ok && r.shares).toEqual([{ memberId: "a", amount: 15000 }, { memberId: "c", amount: 15000 }]);
  });

  it("exact split from typed amounts, blanks mean zero", () => {
    const r = computeSplit({ ...base, amount: "500", splitType: "exact", exact: { a: "300", b: "200", c: "" } });
    expect(r.ok && r.shares.length).toBe(2);
  });

  it("percent split from typed percentages", () => {
    const r = computeSplit({ ...base, amount: "1000", splitType: "percent", percent: { a: "50", b: "25", c: "25" } });
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([50000, 25000, 25000]);
  });

  it("rejects a bad amount", () => {
    expect(computeSplit({ ...base, amount: "abc", splitType: "equal" }).ok).toBe(false);
  });
});
