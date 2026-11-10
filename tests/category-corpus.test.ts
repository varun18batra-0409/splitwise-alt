import { describe, expect, it } from "vitest";
import { guessCategory } from "@/lib/categories";
import { CORPUS } from "./fixtures/category-corpus";

describe("categories: everyday names land in the right place", () => {
  for (const [want, names] of Object.entries(CORPUS)) {
    it(`${want} (${names.length} names)`, () => {
      const wrong = names.filter((n) => guessCategory(n) !== want).map((n) => `${n} → ${guessCategory(n)}`);
      expect(wrong).toEqual([]);
    });
  }
  it("context words decide: to take home is a souvenir; kilos and the market are groceries", () => {
    expect(guessCategory("Spices to take home")).toBe("shopping");
    expect(guessCategory("Onions 2 kg")).toBe("groceries");
    expect(guessCategory("Chicken from market")).toBe("groceries");
    expect(guessCategory("Night market dinner")).toBe("food");
    expect(guessCategory("Driver salary")).toBe("bills");
    expect(guessCategory("Room service dinner")).toBe("food");
  });
});
