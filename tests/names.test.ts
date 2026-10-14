import { describe, expect, it } from "vitest";
import { cleanNames, cleanPeople, cleanPhone, sameName } from "@/lib/names";

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

describe("cleanPeople (people typed or picked from contacts)", () => {
  it("keeps each name with its phone number", () => {
    const r = cleanPeople(["Asha", "  Ravi  Kumar "], ["+91 98765-43210", ""]);
    expect(r.people).toEqual([
      { name: "Asha", phone: "+919876543210" },
      { name: "Ravi Kumar", phone: "" },
    ]);
  });

  it("drops blanks and duplicates, and skips people already in the group", () => {
    const r = cleanPeople(["", "Asha", "asha", "Meera"], ["", "1", "2", "3"], ["MEERA"]);
    expect(r.people).toEqual([{ name: "Asha", phone: "1" }]);
    expect(r.skipped).toEqual(["asha", "Meera"]);
  });
});

describe("cleanPhone", () => {
  it("keeps digits and a leading +", () => {
    expect(cleanPhone("(022) 2345 6789")).toBe("02223456789");
    expect(cleanPhone("+1 415-555-0100")).toBe("+14155550100");
  });
});
