import { describe, expect, it } from "vitest";
import { exactMoney } from "@/lib/money-display";
import { formatMoney } from "@/lib/money";
import { foreignPartLine, ledgerSummary } from "@/lib/foreign-part";

// Group screens (ticket, Balances, People, group lists, activity rows, alerts) show EXACT amounts, the same text Settle up shows.
// Expected strings are worked by hand.

describe("exactMoney: what group screens show", () => {
  it("is exactly what Settle up shows (formatMoney)", () => {
    for (const [minor, cur] of [[123450, "INR"], [509917, "THB"], [1234, "JPY"], [12345675, "INR"]] as const) {
      expect(exactMoney(minor, cur)).toBe(formatMoney(minor, cur));
    }
  });
  it("₹1,234.50 stays ₹1,234.50 (not ₹1,235)", () => {
    expect(exactMoney(123450, "INR")).toBe("₹1,234.50");
  });
  it("three people: +1,000.50 / -500.25 / -500.25 reads exactly and tallies", () => {
    const net = [100050, -50025, -50025];
    expect(net.reduce((a, b) => a + b, 0)).toBe(0);
    expect(exactMoney(net[0], "INR")).toBe("₹1,000.50");
    expect(exactMoney(-net[1], "INR")).toBe("₹500.25");
    expect(exactMoney(-net[2], "INR")).toBe("₹500.25");
  });
  it("lakh style: ₹1,23,456.75", () => {
    expect(exactMoney(12345675, "INR")).toBe("₹1,23,456.75");
  });
  it("JPY has no decimals", () => {
    expect(exactMoney(1234567, "JPY")).toBe("JPY 1,234,567");
  });
  it("THB 5,099.17 stays THB 5,099.17", () => {
    expect(exactMoney(509917, "THB")).toBe("THB 5,099.17");
  });
});

describe("Balances sentences use the exact default", () => {
  it("foreign part line: THB 5,099.17", () => {
    expect(foreignPartLine([{ currency: "THB", amount: -509917 }], true)).toContain("you owe THB 5,099.17");
  });
  it("ledger summary: exact in THB and in ₹", () => {
    expect(ledgerSummary([{ currency: "THB", amount: -509917 }], 1761819, "INR")).toBe(
      "In THB alone, you owe THB 5,099.17. Overall you’re owed ₹17,618.19.",
    );
  });
});

// The group screens that used the rounding <Amt> (People page, This month balance lines) now call the exact formatter.
describe("People page and This month use exact amounts for balances", () => {
  it("source: no rounding helper left on balance lines", async () => {
    const { readFileSync } = await import("node:fs");
    const people = readFileSync("src/app/groups/[id]/people/page.tsx", "utf8");
    expect(people).not.toContain("<Amt");
    expect(people).toContain("`gets ${money(bal)}`");
    expect(people).toContain("`owes ${money(bal)}`");
    const month = readFileSync("src/app/groups/[id]/_components/ThisMonthTab.tsx", "utf8");
    for (const line of month.split("\n").filter((l) => /Overall you|ahead|behind|Yours|put in/.test(l))) expect(line, line).not.toContain("<Amt");
    expect(month).toContain("{money(mine)}");
    expect(month).toContain("{money(-mine)}");
  });
  it("₹1,000.50 owed by a flatmate reads exactly", () => {
    expect(exactMoney(100050, "INR")).toBe("₹1,000.50");
  });
});
