import { describe, expect, it } from "vitest";
import { guessCategory } from "@/lib/categories";
import { CORPUS, OUTSIDE_INDIA } from "./fixtures/category-corpus";

describe("categories: everyday names land in the right place", () => {
  for (const [want, names] of Object.entries(CORPUS)) {
    it(`${want} (${names.length} names)`, () => {
      const wrong = names.filter((n) => guessCategory(n) !== want).map((n) => `${n} → ${guessCategory(n)}`);
      expect(wrong).toEqual([]);
    });
  }
  for (const [want, names] of Object.entries(OUTSIDE_INDIA)) {
    it(`outside India: ${want} (${names.length} names)`, () => {
      const wrong = names.filter((n) => guessCategory(n, { india: false }) !== want).map((n) => `${n} → ${guessCategory(n, { india: false })}`);
      expect(wrong).toEqual([]);
    });
  }
  it("in India a lone 'Gas' is still the cooking-gas bill, and 'Dune bashing' is an activity everywhere", () => {
    expect(guessCategory("Gas")).toBe("bills");
    expect(guessCategory("Gas", { india: true })).toBe("bills");
    expect(guessCategory("Dune bashing")).toBe("activities");
  });
  it("context words decide: to take home is a souvenir; kilos and the market are groceries", () => {
    expect(guessCategory("Spices to take home")).toBe("shopping");
    expect(guessCategory("Onions 2 kg")).toBe("groceries");
    expect(guessCategory("Chicken from market")).toBe("groceries");
    expect(guessCategory("Night market dinner")).toBe("food");
    expect(guessCategory("Driver salary")).toBe("bills");
    expect(guessCategory("Room service dinner")).toBe("food");
  });
});
