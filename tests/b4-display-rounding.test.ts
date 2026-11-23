import { describe, expect, it } from "vitest";
import { listMoney, percentsTo100, roundPartsToTarget, roundPartsToTotal, shownParts } from "@/lib/money-display";
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

// VA2-2 / VD-7: the trip report and Charts round everyone's figure together, ties by the group's own member order.
// Hand-worked (paise): shares Asha 2,551,450 (25,514.50), Ben 2,551,450, Cy 2,551,500; total 7,654,400 = 76,544.00.
// Rounded down: 25,514 + 25,514 + 25,515 = 76,543; one unit is missing. Asha and Ben tie at .50 and are equal parts, so the group's
// member order decides: Asha first. Asha ₹25,515, Ben ₹25,514, Cy ₹25,515 = ₹76,544, however the screen lists them (Ben is "You" and first below).
describe("shownParts: the same figures on every screen", () => {
  const order = ["asha", "ben", "cy"];
  const parts = { ben: 2551450, asha: 2551450, cy: 2551500 }; // keys in the order a screen with "You" first would list them
  it("Asha 25,515, Ben 25,514, Cy 25,515 adding to 76,544, whatever order the rows are given", () => {
    const shown = shownParts(parts, order, "INR");
    expect(shown).toEqual({ asha: 2551500, ben: 2551400, cy: 2551500 });
    expect(Object.values(shown).reduce((s, x) => s + x, 0)).toBe(7654400);
    expect(shownParts({ cy: 2551500, asha: 2551450, ben: 2551450 }, order, "INR")).toEqual(shown);
    expect(formatMoney(shown.asha, "INR")).toBe("₹25,515");
    expect(formatMoney(shown.ben, "INR")).toBe("₹25,514");
  });
  it("Ben's parts land on his shown total: Stay 1,500,050 + Food 1,051,400 are shown as ₹15,000 + ₹10,514 = ₹25,514", () => {
    const out = roundPartsToTarget([1500050, 1051400], 2551400, "INR");
    expect(out).toEqual([1500000, 1051400]);
    expect(out.reduce((s, x) => s + x, 0)).toBe(2551400);
  });
  it("who paid: Asha 3,827,250 and Ben 3,827,150 (total 76,544.00) show as ₹38,273 + ₹38,271 = ₹76,544", () => {
    // Rounded down 38,272 + 38,271 = 76,543; one missing; both fractions are .50, the bigger part (Asha) takes it.
    const shown = shownParts({ ben: 3827150, asha: 3827250 }, ["asha", "ben"], "INR");
    expect(shown).toEqual({ asha: 3827300, ben: 3827100 });
    expect(shown.asha + shown.ben).toBe(7654400);
  });
  it("a part that cannot land on the target (or money back) is rounded on its own / left as it is", () => {
    expect(roundPartsToTarget([1000, 1000, 1000], 100000, "INR")).toEqual(roundPartsToTotal([1000, 1000, 1000], "INR"));
    expect(roundPartsToTarget([1229800, -4450], 1229800, "INR")).toEqual([1229800, -4450]);
  });
});

// VA4-2: Home's Latest shows whole units like the month card ($48.50 reads $49), with the exact amount kept in the tooltip.
describe("Home's Latest rows round like the month card", () => {
  it("4,850 cents is $49 on Home and $48.50 exactly", async () => {
    const { homeMoney } = await import("@/lib/home/display");
    expect(homeMoney(4850, "USD")).toBe("$49");
    expect(formatMoney(4850, "USD")).toBe("$48.50");
  });
  it("the Latest row asks for whole units (and group lists do not)", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/(home)/page.tsx", "utf8")).toMatch(/<ActivityRow[^>]* whole \/>/);
    const row = readFileSync("src/components/ActivityRow.tsx", "utf8");
    expect(row).toContain("whole ? (m: number) => homeMoney(m, currency) : money");
    expect(readFileSync("src/app/groups/[id]/_components/ActivityTab.tsx", "utf8")).not.toMatch(/<ActivityRow[^>]* whole/);
  });
});
