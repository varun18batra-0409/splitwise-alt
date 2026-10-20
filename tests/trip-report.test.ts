import { describe, expect, it } from "vitest";
import { insightLines, reportText, tripReport } from "@/lib/trip-report";
import { myDataCsv } from "@/lib/csv";

// The trip report and the short insight lines on Charts.

const day = (d: string) => new Date(`${d}T12:00:00.000Z`);
const members = [
  { id: "a", name: "Asha" },
  { id: "r", name: "Ravi" },
  { id: "v", name: "Varun" },
];
const ex = (id: string, description: string, amount: number, category: string, paidById: string, d: string, shares: [string, number][], kind = "expense") => ({
  id,
  description,
  amount,
  category,
  paidById,
  kind,
  payers: "",
  spentAt: day(d),
  createdAt: day(d),
  shares: shares.map(([memberId, a]) => ({ memberId, amount: a })),
});
const expenses = [
  ex("1", "Hotel", 900000, "accommodation", "a", "2026-10-10", [["a", 300000], ["r", 300000], ["v", 300000]]),
  ex("2", "Dinner", 300000, "food", "v", "2026-10-10", [["a", 100000], ["r", 100000], ["v", 100000]]),
  ex("3", "Lunch", 150000, "food", "v", "2026-10-12", [["a", 50000], ["r", 50000], ["v", 50000]]),
  ex("4", "Taxi", 60000, "transport", "r", "2026-10-13", [["a", 20000], ["r", 20000], ["v", 20000]]),
  ex("5", "Taxi refund", 30000, "transport", "r", "2026-10-13", [["a", 10000], ["r", 10000], ["v", 10000]], "refund"),
];
const r = tripReport({ name: "Goa trip", currency: "INR", members, expenses, transfers: [{ from: "r", to: "a", amount: 120000 }], tz: "Asia/Kolkata" });

describe("trip report", () => {
  it("adds up totals, days and each person", () => {
    expect(r.total).toBe(1380000); // refunds count against spending
    expect([r.from, r.to, r.days]).toEqual(["2026-10-10", "2026-10-13", 4]);
    expect(r.perDay).toBe(345000);
    expect(r.people).toBe(3);
    expect(r.perPerson).toBe(460000);
    expect(r.shares.map((s) => s.amount).reduce((a, b) => a + b, 0)).toBe(r.total);
  });

  it("finds the top categories, biggest expense, top payer and busiest day", () => {
    expect(r.categories.map((c) => [c.id, c.pct])).toEqual([["accommodation", 65], ["food", 33], ["transport", 2]]);
    expect(r.biggest).toEqual({ description: "Hotel", amount: 900000 });
    expect(r.topPayer).toMatchObject({ name: "Asha", amount: 900000 });
    expect(r.busiestDay).toEqual({ day: "2026-10-10", amount: 1200000 });
    expect(r.settle).toEqual([{ from: "Ravi", to: "Asha", amount: 120000 }]);
  });

  it("writes the WhatsApp message, with no link to the group", () => {
    const t = reportText(r);
    expect(t).toContain("🧳 Goa trip");
    expect(t).toContain("10 Oct – 13 Oct 2026 · 4 days · 5 expenses");
    expect(t).toContain("Total ₹13,800 · about ₹4,600 each · ₹3,450 a day");
    expect(t).toContain("• Ravi pays Asha ₹1,200");
    expect(t).not.toMatch(/https?:|\/groups\/|join/);
    const done = reportText({ ...r, settle: [] });
    expect(done).toContain("All settled ✅");
  });

  it("gives up to three insight lines, and none for a tiny group", () => {
    const lines = insightLines(r, "v");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/Accommodation is 65% of all spending/i);
    expect(lines[1]).toMatch(/a day over 4 days; the biggest day was 10 Oct/);
    expect(lines[2]).toBe("Asha has paid the most: 65% of everything.");
    expect(insightLines(r, "a")[2]).toBe("You’ve paid 65% of everything so far.");
    const small = tripReport({ name: "x", currency: "INR", members, expenses: expenses.slice(0, 2), transfers: [], tz: "Asia/Kolkata" });
    expect(insightLines(small, "v")).toEqual([]);
  });

  it("rounds 'about … each / a day' to whole rupees, and words other groups as a group", () => {
    const odd = tripReport({ name: "Friday dinners", type: "other", currency: "INR", members, expenses: expenses.slice(0, 3).map((e) => ({ ...e, amount: e.amount + 7 })), transfers: [], tz: "Asia/Kolkata" });
    expect(odd.perPerson % 100).toBe(0);
    expect(odd.perDay % 100).toBe(0);
    expect(reportText(odd)).toContain("📊 Friday dinners: in numbers");
  });

  it("handles an empty group", () => {
    const empty = tripReport({ name: "x", currency: "INR", members, expenses: [], transfers: [], tz: "Asia/Kolkata" });
    expect(empty).toMatchObject({ total: 0, days: 0, biggest: null, topPayer: null, from: "" });
  });
});

describe("download all my data", () => {
  const now = new Date("2026-10-20T06:00:00Z");
  const csv = myDataCsv(
    { email: "varun@example.com", name: "Varun", createdAt: new Date("2026-10-01T06:00:00Z") },
    [
      {
        name: "Goa trip", currency: "INR", type: "trip", closed: false, myId: "v", members,
        expenses: expenses.map((e) => ({ ...e, notes: "", originalAmount: e.amount, originalCurrency: "INR", exchangeRate: "1", markupAmount: 0, paymentMethod: "", deletedAt: null })),
        payments: [{ fromId: "r", toId: "v", amount: 50000, createdAt: day("2026-10-14"), deletedAt: null }],
      },
    ],
    now,
    "Asia/Kolkata",
  );
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");

  it("starts with the account, then one row per expense and payment", () => {
    expect(lines[0]).toBe("Loopin: all your data");
    expect(lines).toContain("Email,varun@example.com");
    const head = lines.findIndex((l) => l.startsWith("Group,"));
    expect(lines.length - head - 1).toBe(6);
  });

  it("shows my share and how each line changed my balance", () => {
    const dinner = lines.find((l) => l.includes(",Dinner,"))!;
    expect(dinner).toContain(",You,3000.00,INR,1000.00,2000.00,"); // I paid 3000, my share 1000
    const hotel = lines.find((l) => l.includes(",Hotel,"))!;
    expect(hotel).toContain(",Asha,9000.00,INR,3000.00,-3000.00,");
    const pay = lines.find((l) => l.includes("Ravi paid You"))!;
    expect(pay).toContain(",500.00,INR,,-500.00,");
  });
});
