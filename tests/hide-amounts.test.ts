import { describe, expect, it } from "vitest";
import { squareNumbers, squareTiles } from "@/lib/square";
import { pictureWords } from "@/lib/wrapped";
import { formatMoney } from "@/lib/money";

// "Hide amounts" on the shared pictures (All square, Wrapped): money tiles become counts, so no ₹ or figure
// of what anyone spent is in the picture's text. Amounts are shown by default.

const at = new Date("2026-10-05T10:00:00Z");
const expenses = [
  { amount: 90000, createdAt: at, spentAt: at },
  { amount: 30000, createdAt: at, spentAt: at },
];
const n = squareNumbers({ expenses, payments: [{}, {}], people: 3, tripStart: "2026-10-01", tripEnd: "2026-10-05" });
const inr = (m: number) => formatMoney(m, "INR");

describe("All square tiles", () => {
  it("shown by default: ₹1,200 spent together (900 + 300), 2 expenses, 5 days", () => {
    expect(n).toMatchObject({ spent: 120000, expenses: 2, payments: 2, days: 5, people: 3 });
    expect(squareTiles(n, { hide: false, formatSpent: inr })).toEqual([
      ["₹1,200", "spent together"],
      ["2", "expenses"],
      ["5 days", "3 of you"],
    ]);
  });
  it("hidden: the same three tiles, only the money blanked (₹ ••••), and no figure of what was spent (VI1-36)", () => {
    const tiles = squareTiles(n, { hide: true, formatSpent: inr });
    expect(tiles).toEqual([
      ["₹\u00a0••••", "spent together"],
      ["2", "expenses"],
      ["5 days", "3 of you"],
    ]);
    expect(JSON.stringify(tiles)).not.toMatch(/1,200|1200|\d,\d{3}/);
    // The labels are the same as when amounts are shown, so nothing says a payment was made.
    expect(tiles.map((t) => t[1])).toEqual(squareTiles(n, { hide: false, formatSpent: inr }).map((t) => t[1]));
    expect(JSON.stringify(tiles)).not.toMatch(/payment/);
  });
  it("hidden with no payments made: still the same three tiles, and the same shape as with payments", () => {
    const none = squareNumbers({ expenses, payments: [], people: 2 });
    const tiles = squareTiles(none, { hide: true, formatSpent: inr });
    expect(tiles.length).toBe(3);
    expect(tiles.map((t) => t[1])).toEqual(["spent together", "expenses", "people"]);
    expect(JSON.stringify(tiles)).not.toMatch(/\d,\d{3}|1200/);
    expect(squareTiles(n, { hide: true, formatSpent: inr }).length).toBe(tiles.length);
  });
});

describe("Wrapped picture words", () => {
  const p = { total: { amount: "₹1,200", each: "₹400" }, day: { label: "Sat 3", amount: "₹700" }, splurge: { amount: "₹900", payer: "Asha" }, spentCount: 2, people: 3 };
  it("shown by default: the total, 'About ₹400 each', the day's and the splurge's amounts", () => {
    expect(pictureWords({ ...p, hide: false })).toEqual({ totalKicker: "TOGETHER WE SPENT", totalBig: "₹1,200", totalSub: "About ₹400 each", daySmall: "₹700", splurgeSmall: "₹900" });
  });
  it("hidden: counts and names only, no ₹", () => {
    const w = pictureWords({ ...p, hide: true });
    expect(w).toEqual({ totalKicker: "TOGETHER WE ADDED", totalBig: "2 expenses", totalSub: "3 of us", daySmall: "the busiest day", splurgeSmall: "paid by Asha" });
    expect(Object.values(w).join(" ")).not.toContain("₹");
    expect(pictureWords({ ...p, spentCount: 1, hide: true }).totalBig).toBe("1 expense");
  });
});
