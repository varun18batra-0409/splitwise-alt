import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { guessCategory } from "@/lib/categories";

// Batch B4 (VA1-21 / VI1-26 / VI2-41): the screenshots showed "Other" for everything because the demo script saved no category
// (the stored default is "other"). The app's own guesser files these correctly; the script now uses it, and this keeps it so.
describe("the category guesser the screenshot script uses", () => {
  it("Groceries -> groceries, Boat tickets -> transport", () => {
    expect(guessCategory("Groceries")).toBe("groceries");
    expect(guessCategory("Boat tickets")).toBe("transport");
  });
  it("the screenshot script files every demo expense with the guessed category (not the stored default)", () => {
    expect(readFileSync("scripts/screenshots.ts", "utf8")).toContain("category: guessCategory(description)");
  });
});
