import { describe, expect, it } from "vitest";
import { listMoney, percentsTo100, roundPartsToTotal } from "@/lib/money-display";
import { formatMoney } from "@/lib/money";

// Batch B4, step 1: display-only helpers so that the rows of a card add up to the total shown above them.
// Amounts are in paise. Every number below is worked by hand.

describe("roundPartsToTotal: rows that add up to the rounded total", () => {
  it("VI1-24: 12,298.00 + 977.89 + 579.02 + 244.48 = 14,099.39, shown as ₹14,099", () => {
    // Rounded down: 12298 + 977 + 579 + 244 = 14098. The exact sum 14099.39 rounds to 14099, so 1 unit is needed.
    // The biggest leftover fraction is .89 (977.89), so that row goes up to 978.
    const out = roundPartsToTotal([1229800, 97789, 57902, 24448], "INR");
    expect(out).toEqual([1229800, 97800, 57900, 24400]);
    expect(out.reduce((s, x) => s + x, 0)).toBe(1409900);
    expect(formatMoney(1409900, "INR")).toBe("₹14,099");
  });
  it("ties go to the bigger part, then to list order", () => {
    // 0.5 + 0.5 = 1.00 -> round(1.00) = 1 unit; the two fractions are tied, both parts equal, so the first row gets it.
    expect(roundPartsToTotal([50, 50], "INR")).toEqual([100, 0]);
    // 100.50 + 200.50 = 301.00; floors 100 + 200 = 300; shortfall 1; tied .50, the bigger part (200.50) gets it.
    expect(roundPartsToTotal([10050, 20050], "INR")).toEqual([10000, 20100]);
  });
  it("money back (a negative part) or a currency without decimals is returned unchanged", () => {
    expect(roundPartsToTotal([1229800, -4450, 57902], "INR")).toEqual([1229800, -4450, 57902]);
    expect(roundPartsToTotal([1500, 2500], "JPY")).toEqual([1500, 2500]);
  });
  it("whole amounts stay as they are", () => {
    expect(roundPartsToTotal([300000, 100000], "INR")).toEqual([300000, 100000]);
  });
});

describe("percentsTo100: whole percentages that always add up to 100", () => {
  it("VI1-10: 46.5, 29.5, 10.5, 9.5 and 4 -> 47, 30, 10, 9, 4 (adds to 100)", () => {
    // Rounded down: 46 + 29 + 10 + 9 + 4 = 98. Four .5 fractions are tied; the two biggest amounts go up.
    const out = percentsTo100([4650000, 2950000, 1050000, 950000, 400000]);
    expect(out).toEqual([47, 30, 10, 9, 4]);
    expect(out.reduce((s, x) => s + x, 0)).toBe(100);
  });
  it("the old way (rounding each) left 'Everything else 2%': 47 + 30 + 11 + 10 = 98", () => {
    const each = [4650000, 2950000, 1050000, 950000].map((a) => Math.round((a * 100) / 10000000));
    expect(each.reduce((s, x) => s + x, 0)).toBe(98);
    expect(100 - 98).toBe(2);
  });
  it("[1, 1, 1] is [34, 33, 33]; [1050, 1050, 7900] is [11, 10, 79] (rounding each would give 101)", () => {
    expect(percentsTo100([1, 1, 1])).toEqual([34, 33, 33]);
    expect(percentsTo100([1050, 1050, 7900])).toEqual([11, 10, 79]);
    expect([1050, 1050, 7900].map((a) => Math.round((a * 100) / 10000)).reduce((s, x) => s + x, 0)).toBe(101);
  });
  it("a total of 0 gives zeros; a negative amount falls back to rounding each one", () => {
    expect(percentsTo100([0, 0])).toEqual([0, 0]);
    expect(percentsTo100([])).toEqual([]);
    expect(percentsTo100([6000, -1000, 5000])).toEqual([Math.round((6000 * 100) / 10000), Math.round((-1000 * 100) / 10000), Math.round((5000 * 100) / 10000)]);
  });
});

describe("listMoney: paise on every row when any row has paise", () => {
  it("VA1-9: ₹30,723.44 · ₹17,618.19 · ₹17,251.47 · ₹2,670.00, adding to ₹68,263.10", () => {
    const rows = [3072344, 1761819, 1725147, 267000];
    const f = listMoney(rows, "INR");
    expect(rows.map(f)).toEqual(["₹30,723.44", "₹17,618.19", "₹17,251.47", "₹2,670.00"]);
    expect(rows.reduce((s, x) => s + x, 0)).toBe(6826310);
    expect(formatMoney(6826310, "INR")).toBe("₹68,263.10");
  });
  it("whole rows stay plain", () => {
    const f = listMoney([250000, 100000], "INR");
    expect([250000, 100000].map(f)).toEqual(["₹2,500", "₹1,000"]);
  });
  it("formatMoney with keepDecimals is add-only: the default is unchanged", () => {
    expect(formatMoney(267000, "INR")).toBe("₹2,670");
    expect(formatMoney(267000, "INR", { keepDecimals: true })).toBe("₹2,670.00");
    expect(formatMoney(267050, "INR", { keepDecimals: true })).toBe("₹2,670.50");
  });
});
