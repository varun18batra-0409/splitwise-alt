import { describe, expect, it } from "vitest";
import { cell, csvFileName, groupCsv } from "@/lib/csv";
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
      "Date,Type,Description,Notes,Category,Paid by,Amount (INR),Original amount,Original currency,Exchange rate,Card markup (INR),Paid with,Status,Varun's share (INR),Asha's share (INR)",
    );
    expect(lines[1]).toBe('2026-10-01,Expense,"Dinner, drinks",Tip paid by Asha,Bites & Sips,Varun,1200.50,,,,,cash,,600.25,600.25');
    expect(lines[2]).toBe("2026-10-03,Expense,Hotel,,Beds & Bunks,Asha,5150.00,2000.00,THB,2.5,150.00,card,Deleted,,5150.00");
    expect(lines[3]).toBe("2026-10-04,Payment,Asha paid Varun,,,Asha,600.25,,,,,,,,");
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
