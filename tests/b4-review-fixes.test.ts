import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { homeMoney, recapShownDiff, roundedMinor } from "@/lib/home/display";
import { roundPartsToTotal } from "@/lib/money-display";
import { formatMoney } from "@/lib/money";
import { leaverMoneyLine } from "@/lib/settle-ui";
import { tripIsOver } from "@/lib/passport-cards";

// Batch B4 review fixes. Amounts in paise, every number worked by hand.

describe("M1: the report card's rows add up to the total shown", () => {
  it("₹1,000 split 333.34 + 333.33 + 333.33 shows ₹334 + ₹333 + ₹333 = ₹1,000", () => {
    // floors 333 + 333 + 333 = 999; 100000 paise rounds to 1000 units, so 1 more: the biggest fraction (.34) goes up.
    const rows = roundPartsToTotal([33334, 33333, 33333], "INR");
    expect(rows).toEqual([33400, 33300, 33300]);
    expect(rows.reduce((t, x) => t + x, 0)).toBe(100000);
    expect(homeMoney(rows.reduce((t, x) => t + x, 0), "INR")).toBe("₹1,000");
  });
  it("categories 12,298.50 + 977.50 + 579.50 = ₹13,855.50 show rows adding up to ₹13,856", () => {
    // floors 12298 + 977 + 579 = 13854; the total rounds half up to 13856, so 2 more; the three .50 fractions are tied: the two biggest parts go up.
    const rows = roundPartsToTotal([1229850, 97750, 57950], "INR");
    expect(rows).toEqual([1229900, 97800, 57900]);
    expect(rows.reduce((t, x) => t + x, 0)).toBe(1385600);
    expect(homeMoney(1385550, "INR")).toBe("₹13,856");
  });
  it("the report page rounds the category rows and each person's part together", () => {
    const page = readFileSync("src/app/groups/[id]/report/page.tsx", "utf8");
    expect(page).toContain("roundPartsToTotal(r.categories.map");
    // Each person's part is rounded together with the others by shownParts (ties by member order), the same rule as the Who paid chart.
    expect(page).toContain("shownParts(Object.fromEntries(r.shares.map");
  });
});

describe("M2: someone who has left hears only about their own side", () => {
  const name = (id: string) => ({ a: "Asha", m: "Meera", r: "Ravi" })[id] ?? "?";
  it("pays one person: 'You pay Meera ₹1,234.50 to be square.' and no claim about the group", () => {
    const line = leaverMoneyLine([{ from: "a", to: "m", amount: 123450 }], "a", name, (x) => formatMoney(x, "INR"));
    expect(line).toBe("You pay Meera ₹1,234.50 to be square.");
    expect(line).not.toMatch(/clear|everything|instead of|Nobody/i);
  });
  it("is owed by two people: 'Meera and Ravi owe you ₹300.50.'", () => {
    expect(leaverMoneyLine([{ from: "m", to: "a", amount: 20025 }, { from: "r", to: "a", amount: 10025 }], "a", name, (x) => formatMoney(x, "INR"))).toBe("Meera and Ravi owe you ₹300.50.");
  });
  it("nothing of their own open: 'You don’t owe anyone here, and no one owes you.'", () => {
    expect(leaverMoneyLine([{ from: "m", to: "r", amount: 100 }], "a", name, (x) => String(x))).toBe("You don’t owe anyone here, and no one owes you.");
  });
  it("the settle page and the group box use it for a leaver, and the settle page drops 'N instead of M'", () => {
    const settle = readFileSync("src/app/groups/[id]/settle/page.tsx", "utf8");
    expect(settle).toContain("leaverMoneyLine(");
    expect(settle).toContain("!data.leaver && transfers.length > 0 && before > transfers.length");
    expect(readFileSync("src/lib/group-summary-text.ts", "utf8")).toContain("if (v.leaver) return leaverMoneyLine(");
  });
});

describe("L1: never a misleading zero", () => {
  it("₹0.40 shows exactly; so does -₹0.40; zero is ₹0 and never -₹0", () => {
    expect(homeMoney(40, "INR")).toBe("₹0.40");
    expect(homeMoney(-40, "INR")).toBe("-₹0.40");
    expect(homeMoney(0, "INR")).toBe("₹0");
    expect(homeMoney(-0, "INR")).toBe("₹0");
    expect(roundedMinor(-40, "INR")).toBe(0);
    expect(Object.is(roundedMinor(-40, "INR"), -0)).toBe(false);
  });
  it("₹0.60 still rounds to ₹1 (it does not round to zero)", () => {
    expect(homeMoney(60, "INR")).toBe("₹1");
  });
  it("a budget over by ₹0.40 reads '₹0.40 over'", () => {
    expect(`${homeMoney(10040 - 10000, "INR")} over`).toBe("₹0.40 over");
  });
  it("ThisMonthTab says 'Same as last month' when the change is exactly 0", () => {
    expect(readFileSync("src/app/groups/[id]/_components/ThisMonthTab.tsx", "utf8")).toContain("change === 0 ? <>Same as last month</>");
  });
});

describe("L2: the recap's three numbers agree on screen", () => {
  it("paid ₹1,000.60 and share ₹300.40 show ₹1,001, ₹300 and ₹701 (not the rounded real difference ₹700)", () => {
    expect(homeMoney(100060, "INR")).toBe("₹1,001");
    expect(homeMoney(30040, "INR")).toBe("₹300");
    expect(recapShownDiff(100060, 30040, "INR")).toBe(70100);
    expect(homeMoney(100060 - 30040, "INR")).toBe("₹700");
  });
  it("paid ₹1,000.20 and share ₹1,000.00 would show a false zero, so the exact ₹0.20 is kept", () => {
    expect(recapShownDiff(100020, 100000, "INR")).toBe(20);
    expect(homeMoney(recapShownDiff(100020, 100000, "INR"), "INR")).toBe("₹0.20");
  });
});

describe("L3: an undated trip is 'Trip so far' for 3 days after its last spending", () => {
  const t = { start: "2026-11-16", end: "", undated: true };
  it("16 Nov spending: not over on 16, 17, 18 or 19 Nov; over on 20 Nov (16 + 3 = 19 is before 20)", () => {
    expect(["2026-11-16", "2026-11-17", "2026-11-19"].map((d) => tripIsOver(t, d))).toEqual([false, false, false]);
    expect(tripIsOver(t, "2026-11-20")).toBe(true);
  });
  it("a dated trip is over from the day after its last day", () => {
    const d = { start: "2026-11-15", end: "2026-11-19" };
    expect([tripIsOver(d, "2026-11-19"), tripIsOver(d, "2026-11-20")]).toEqual([false, true]);
  });
});

describe("L5, L6 and the Home card", () => {
  it("a leaver gets no 'all square' share picture at all (b3c: they see only their own part, so it is not theirs to say or share)", () => {
    const sq = readFileSync("src/app/groups/[id]/square/page.tsx", "utf8");
    expect(sq).toContain("{w.share && (");
    expect(readFileSync("src/app/groups/[id]/square-image/route.tsx", "utf8")).toContain("if (data.leaver) return new Response(");
    expect(readFileSync("src/components/TripShare.tsx", "utf8")).toContain('r.viewerLeft ? "Everything adds up."');
  });
  it("the group Settle page lists its payments with listMoney", () => {
    const settle = readFileSync("src/app/groups/[id]/settle/page.tsx", "utf8");
    expect(settle).toContain("listMoney(transfers.map");
    expect(settle).toContain("amount={listFmt(t.amount)}");
  });
  it("Home says only 'You’re all square', never a claim about other people", () => {
    const card = readFileSync("src/lib/home/money-card.ts", "utf8");
    for (const old of ["Nobody owes anybody in your", 'label: "Nobody owes anybody"', 'if (x.mode === "square") return "Nobody owes anybody"', 'text: "Nobody owes anybody"']) expect(card).not.toContain(old);
  });
});
