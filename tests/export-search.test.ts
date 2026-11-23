import { describe, expect, it } from "vitest";
import { cell, csvFileName, groupCsv, myDataCsv } from "@/lib/csv";
import { parseImport } from "@/lib/import-formats";
import { filterActivity, hasFilter, type ActivityItem } from "@/lib/activity";

const members = [
  { id: "me", name: "Varun" },
  { id: "a", name: "Asha" },
];
const names: Record<string, string> = { me: "Varun you", a: "Asha" };
const nameOf = (id: string) => names[id] ?? "";

describe("spreadsheet export", () => {
  it("one row per expense and payment, oldest first, shares in columns", () => {
    const csv = groupCsv(
      { name: "Goa", currency: "INR" },
      members,
      [
        {
          description: "Dinner, drinks", notes: "Tip paid by Asha", category: "food", amount: 120050, paidById: "me", originalAmount: 120050, originalCurrency: "INR",
          exchangeRate: "1", markupAmount: 0, paymentMethod: "cash", createdAt: new Date("2026-10-02T10:00:00Z"), spentAt: new Date("2026-10-01T06:30:00Z"),
          deletedAt: null, shares: [{ memberId: "me", amount: 60025 }, { memberId: "a", amount: 60025 }],
        },
        {
          description: "Hotel", category: "accommodation", amount: 515000, paidById: "a", originalAmount: 200000, originalCurrency: "THB",
          exchangeRate: "2.5", markupAmount: 15000, paymentMethod: "card", createdAt: new Date("2026-10-03T10:00:00Z"), spentAt: null,
          deletedAt: new Date(), shares: [{ memberId: "a", amount: 515000 }],
        },
      ],
      [{ fromId: "a", toId: "me", amount: 60025, createdAt: new Date("2026-10-04T10:00:00Z"), deletedAt: null }],
    );
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe(
      "Date,Type,Description,Notes,Category,Paid by,Amount (INR),Original amount,Original currency,Exchange rate,Card markup (INR),Paid with,Status,Counts as spending (INR),Varun's share (INR),Asha's share (INR)",
    );
    expect(lines[1]).toBe('2026-10-01,Expense,"Dinner, drinks",Tip paid by Asha,Bites & Sips,Varun,1200.50,,,,,cash,,1200.50,600.25,600.25');
    // LM-9: a deleted line keeps its row, but amount, original amount/currency/rate, markup and shares are empty; what it was goes in Notes.
    expect(lines[2]).toBe("2026-10-03,Expense,Hotel,Deleted (it was 5150.00),Beds & Bunks,Asha,,,,,,card,Deleted,,,");
    expect(lines[3]).toBe("2026-10-04,Payment,Asha paid Varun,,,Asha,600.25,,,,,,,,,");
  });

  it("quotes awkward text and blocks spreadsheet formulas", () => {
    expect(cell('Say "hi"')).toBe('"Say ""hi"""');
    expect(cell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(cell(12)).toBe("12");
    expect(csvFileName("Goa trip 2026 🏖️")).toBe("Goa-trip-2026-expenses.csv");
  });
});

describe("search and filter", () => {
  const exp = (id: string, title: string, category: string, paidById: string, people: string[]): ActivityItem => ({
    kind: "expense", id, date: new Date(), title, category, amount: 1000, paidById, people, effect: 0,
    createdById: paidById, edited: false, deletedById: null, original: null,
  });
  const items: ActivityItem[] = [
    exp("1", "Dinner at Toit", "food", "me", ["me", "a"]),
    exp("2", "Uber to airport", "transport", "a", ["a"]),
    exp("3", "Beers", "food", "a", ["a"]),
    { kind: "payment", id: "p", date: new Date(), fromId: "a", toId: "me", amount: 500, effect: -500, createdById: "a", deletedById: null },
    { kind: "event", id: "e", date: new Date(), actorId: "me", text: "renamed the group to Goa", details: "[]", effect: 0 },
  ];
  const ids = (f: Parameters<typeof filterActivity>[1]) => filterActivity(items, f, nameOf).map((i) => i.id);

  it("no filter shows everything", () => {
    expect(hasFilter({ q: "  " })).toBe(false);
    expect(ids({})).toEqual(["1", "2", "3", "p", "e"]);
  });
  it("words match names, categories and people, in any case", () => {
    expect(ids({ q: "dinner" })).toEqual(["1"]);
    expect(ids({ q: "transport" })).toEqual(["2"]);
    expect(ids({ q: "asha" })).toEqual(["1", "2", "3", "p"]);
    expect(ids({ q: "uber airport" })).toEqual(["2"]);
    expect(ids({ q: "goa" })).toEqual(["e"]);
    expect(ids({ q: "you" })).toEqual(["1", "p", "e"]);
  });
  it("category and person filters combine", () => {
    expect(ids({ cat: "food" })).toEqual(["1", "3"]);
    expect(ids({ who: "me" })).toEqual(["1", "p"]);
    expect(ids({ cat: "food", who: "me" })).toEqual(["1"]);
    expect(ids({ cat: "food", q: "beer" })).toEqual(["3"]);
  });
});

// M7: an honest "Counts as spending" column. Hand-worked rows (rupees): Dinner 1,000.00; money back -200.00; a game result 150.00; a payment 400.00.
// The Amount column adds to 1,000 - 200 + 150 + 400 = 1,350.00; the new column to 1,000 - 200 + 0 = 800.00 (the game moves money between
// players and the payment is not spending, so its cell is empty). A deleted line has an empty cell too.
describe("the Counts as spending column", () => {
  const mk = (description: string, amount: number, kind: string | null, deletedAt: Date | null = null) => ({
    description, category: "food", amount, paidById: "me", kind, originalAmount: amount, originalCurrency: "INR", exchangeRate: "1", markupAmount: 0, paymentMethod: "cash",
    createdAt: new Date("2026-10-01T10:00:00Z"), spentAt: null, deletedAt, shares: [{ memberId: "me", amount: amount / 2 }, { memberId: "a", amount: amount / 2 }],
  });
  const expenses = [mk("Dinner", 100000, null), mk("Refund", 20000, "refund"), mk("Cards", 15000, "pot"), mk("Mistake", 50000, null, new Date())];
  const payments = [{ fromId: "a", toId: "me", amount: 40000, createdAt: new Date("2026-10-02T10:00:00Z"), deletedAt: null }];
  const parse = (csv: string) => csv.slice(1).trim().split("\r\n").map((l) => l.split(","));
  const sum = (rows: string[][], i: number) => rows.reduce((t, r) => t + Math.round(Number(r[i] || 0) * 100), 0);

  it("group spreadsheet: Amount 1,350.00, Counts as spending 800.00, shares add up to what they did", () => {
    const rows = parse(groupCsv({ name: "Goa", currency: "INR" }, members, expenses, payments));
    expect(rows[0][13]).toBe("Counts as spending (INR)");
    const body = rows.slice(1);
    expect(sum(body, 6)).toBe(135000);
    expect(sum(body, 13)).toBe(80000);
    expect(body.find((r) => r[2] === "Cards")![13]).toBe("0.00");
    expect(body.find((r) => r[2] === "Refund")![13]).toBe("-200.00");
    expect(body.find((r) => r[1] === "Payment")![13]).toBe("");
    expect(body.find((r) => r[2] === "Mistake")![13]).toBe("");
  });

  it("all my data: the same column at the end, adding to 800.00", () => {
    const rows = parse(myDataCsv(null, [{ name: "Goa", currency: "INR", type: "trip", closed: false, myId: "me", members, expenses, payments }], new Date("2026-10-05T10:00:00Z")));
    const head = rows.find((r) => r[0] === "Group")!;
    expect(head[head.length - 1]).toBe("Counts as spending");
    const body = rows.filter((r) => r[0] === "Goa");
    expect(sum(body, 8)).toBe(135000);
    expect(sum(body, head.length - 1)).toBe(80000);
  });

  it("bringing the spreadsheet back in reads the same expenses (the new column is not a person)", () => {
    const csv = groupCsv({ name: "Goa", currency: "INR" }, members, expenses.slice(0, 3), []);
    const p = parseImport(csv);
    if (!p.ok) throw new Error(p.error);
    expect(p.people).toEqual(["Varun", "Asha"]);
    expect(p.rows.map((r) => [r.description, r.cost])).toEqual([["Dinner", 100000], ["Refund", 20000], ["Cards", 15000]]);
  });
});
