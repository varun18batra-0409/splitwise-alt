import { describe, expect, it } from "vitest";
import { formatMoney, formatPercent, parseAmount, parsePercent } from "@/lib/money";
import { CATEGORIES, getCategory, guessCategory } from "@/lib/categories";

describe("parseAmount (typed amount → smallest units)", () => {
  it("reads common ways of typing rupees", () => {
    expect(parseAmount("250")).toBe(25000);
    expect(parseAmount("99.5")).toBe(9950);
    expect(parseAmount("99.50")).toBe(9950);
    expect(parseAmount("₹ 1,250.75")).toBe(125075);
    expect(parseAmount(".5")).toBe(50);
  });

  it("rejects things that aren't amounts", () => {
    for (const bad of ["", "abc", "0", "1.234", "-5", "1.2.3", "."]) expect(parseAmount(bad)).toBeNull();
  });

  it("knows yen, dong and rupiah have no decimals", () => {
    expect(parseAmount("1500", "JPY")).toBe(1500);
    expect(parseAmount("1500.5", "JPY")).toBeNull();
    expect(parseAmount("250,000", "VND")).toBe(250000);
    expect(parseAmount("3000", "THB")).toBe(300000);
  });

  it("caps amounts at what the database can hold", () => {
    expect(parseAmount("20000000", "INR")).toBe(2_000_000_000);
    expect(parseAmount("20000001", "INR")).toBeNull();
  });
});

describe("parsePercent / formatPercent", () => {
  it("reads percentages as hundredths of a percent", () => {
    expect(parsePercent("50")).toBe(5000);
    expect(parsePercent("33.33")).toBe(3333);
    expect(parsePercent("")).toBe(0);
    expect(parsePercent("101")).toBeNull();
  });
  it("formats them back", () => {
    expect(formatPercent(300)).toBe("3%");
    expect(formatPercent(350)).toBe("3.5%");
    expect(formatPercent(3333)).toBe("33.33%");
  });
});

describe("formatMoney", () => {
  it("shows rupees the Indian way", () => {
    expect(formatMoney(125050)).toBe("₹1,250.50");
    expect(formatMoney(25000)).toBe("₹250");
    expect(formatMoney(1234567800)).toBe("₹1,23,45,678");
  });
  it("shows other currencies with their code", () => {
    expect(formatMoney(300000, "THB")).toBe("THB 3,000");
    expect(formatMoney(1500, "JPY")).toBe("JPY 1,500");
    expect(formatMoney(1999, "USD")).toBe("USD 19.99");
  });
});

describe("categories", () => {
  it("has the 8 requested categories with icons", () => {
    expect(CATEGORIES.map((c) => c.label)).toEqual([
      "Food & Drinks", "Transport", "Accommodation", "Shopping", "Groceries",
      "Activities & Tickets", "Bills & Utilities", "Other",
    ]);
    for (const c of CATEGORIES) expect(c.emoji.length).toBeGreaterThan(0);
  });

  it.each([
    ["Dinner at Jay Fai", "food"],
    ["beers", "food"],
    ["Grab to airport", "transport"],
    ["Goa flight tickets", "transport"],
    ["Airbnb 2 nights", "accommodation"],
    ["7-Eleven snacks run", "groceries"],
    ["Blinkit order", "groceries"],
    ["Grand Palace tickets", "activities"],
    ["Movie night", "activities"],
    ["Electricity bill", "bills"],
    ["Amazon order", "shopping"],
    ["random thing", "other"],
  ])("%s → %s", (text, expected) => {
    expect(guessCategory(text)).toBe(expected);
  });

  it("uses the first word it recognises", () => {
    expect(guessCategory("flight tickets")).toBe("transport");
    expect(guessCategory("tickets")).toBe("activities");
  });

  it("matches whole words only", () => {
    expect(guessCategory("team outing")).toBe("other"); // "team" is not "tea"
    expect(guessCategory("parking")).toBe("transport"); // not "park"
  });

  it("maps old category names to the new ones", () => {
    expect(getCategory("drinks").id).toBe("food");
    expect(getCategory("stay").id).toBe("accommodation");
    expect(getCategory("fun").id).toBe("activities");
    expect(getCategory("nonsense").id).toBe("other");
  });
});
