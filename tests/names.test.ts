import { describe, expect, it } from "vitest";
import { cleanNames, sameName } from "@/lib/names";

describe("cleanNames", () => {
  it("trims, drops blanks and removes duplicates ignoring case", () => {
    expect(cleanNames(["  Asha ", "", "asha", "Ravi  Kumar", "   "])).toEqual(["Asha", "Ravi Kumar"]);
  });
});

describe("sameName", () => {
  it("ignores case and outer spaces", () => {
    expect(sameName(" Ravi", "ravi ")).toBe(true);
    expect(sameName("Ravi", "Ravina")).toBe(false);
  });
});
