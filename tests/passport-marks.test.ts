import { describe, expect, it } from "vitest";
import { continentOf } from "@/lib/continents";
import { COUNTRIES } from "@/lib/geo";
import { buildPassport, newestMark, passportMarks } from "@/lib/passport";

describe("passport moments", () => {
  it("every country in the picker has a continent", () => {
    expect(COUNTRIES.filter((c) => !continentOf(c.code)).map((c) => c.code)).toEqual([]);
    expect(continentOf("in")).toBe("Asia");
    expect(continentOf("TR")).toBe("Europe");
    expect(continentOf("EG")).toBe("Africa");
  });

  it("5 countries over 3 continents: the right moments, the rarest one alerted", () => {
    const hand = ["TH", "FR", "IT", "KE"].map((c) => ({ c }));
    const trip = { groupId: "g1", name: "Goa trip", start: "2026-01-10", end: "2026-01-14", place: "Goa", country: "IN", people: 4 };
    const p = buildPassport([trip], hand, "IN", "2026-11-11");
    expect(p.stats.countries).toBe(5);
    expect(p.stats.continents).toBe(3);
    const ids = p.marks.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining(["abroad-1", "countries-5", "continents-2", "continents-3"]));
    expect(ids).not.toContain("countries-10");
    expect(p.milestones).toContain("5 countries");
    expect(p.milestones).toContain("3 continents");
    expect(newestMark(p.marks, new Set())?.id).toBe("continents-3");
    expect(newestMark(p.marks, new Set(ids))).toBeUndefined();
  });

  it("nothing to celebrate at home only, and moments never mention money", () => {
    expect(passportMarks({ countries: 1, continents: 1, cities: 2, trips: 2 }, false)).toEqual([]);
    for (const m of passportMarks({ countries: 100, continents: 7, cities: 100, trips: 100 }, true)) expect(`${m.title} ${m.body}`).not.toMatch(/₹|\$|€|£|spent|owe|paid/i);
  });
});
