import { describe, expect, it } from "vitest";
import { formatMoney, parseAmount, parsePercent } from "@/lib/money";
import { guessCategory } from "@/lib/categories";

describe("parseAmount (rupees typed → paise)", () => {
  it("reads common ways of typing money", () => {
    expect(parseAmount("250")).toBe(25000);
    expect(parseAmount("99.5")).toBe(9950);
    expect(parseAmount("99.50")).toBe(9950);
    expect(parseAmount("₹ 1,250.75")).toBe(125075);
    expect(parseAmount(".5")).toBe(50);
  });

  it("rejects things that aren't amounts", () => {
    for (const bad of ["", "abc", "0", "1.234", "-5", "1.2.3", "."]) expect(parseAmount(bad)).toBeNull();
  });
});

describe("parsePercent", () => {
  it("reads percentages as hundredths of a percent", () => {
    expect(parsePercent("50")).toBe(5000);
    expect(parsePercent("33.33")).toBe(3333);
    expect(parsePercent("")).toBe(0);
    expect(parsePercent("101")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("shows rupees the Indian way", () => {
    expect(formatMoney(125050)).toBe("₹1,250.50");
    expect(formatMoney(25000)).toBe("₹250");
    expect(formatMoney(12345678900)).toBe("₹12,34,56,789");
  });
});

describe("guessCategory (smart buckets)", () => {
  it.each([
    ["Dinner at Toit", "food"],
    ["beers", "drinks"],
    ["Uber to airport", "transport"],
    ["Goa flight tickets", "travel"],
    ["Airbnb 2 nights", "stay"],
    ["Blinkit order", "groceries"],
    ["Movie night", "fun"],
    ["Electricity bill", "bills"],
    ["Medicines", "health"],
    ["Amazon order", "shopping"],
    ["random thing", "other"],
  ])("%s → %s", (text, expected) => {
    expect(guessCategory(text)).toBe(expected);
  });

  it("uses the first word it recognises", () => {
    expect(guessCategory("dinner and drinks")).toBe("food");
    expect(guessCategory("drinks and dinner")).toBe("drinks");
  });

  it("matches whole words only", () => {
    expect(guessCategory("team outing")).toBe("other"); // "team" is not "tea"
  });
});
