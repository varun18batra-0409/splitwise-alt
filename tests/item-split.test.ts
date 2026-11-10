import { describe, expect, it } from "vitest";
import { allocate, splitByItems } from "@/lib/item-split";

const sum = (r: Record<string, number>) => Object.values(r).reduce((s, x) => s + x, 0);

describe("split by item", () => {
  it("dinner for three: each pays for what they had, tax and tip shared in proportion", () => {
    // ₹1,000 food + ₹180 tax & tip = ₹1,180 (in paise).
    const r = splitByItems(
      [
        { name: "Pizza", amount: 60000, people: ["asha", "ravi"] },
        { name: "Beer", amount: 40000, people: ["ravi"] },
      ],
      118000,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Asha had ₹300 (30%), Ravi ₹700 (70%): ₹180 extra → ₹54 / ₹126.
    expect(r.amounts).toEqual({ asha: 35400, ravi: 82600 });
    expect(r.extra).toBe(18000);
    expect(sum(r.amounts)).toBe(118000);
  });

  it("odd paise always add up exactly", () => {
    const r = splitByItems([{ name: "Starter", amount: 1000, people: ["a", "b", "c"] }, { name: "Main", amount: 2001, people: ["b"] }], 3337);
    expect(r.ok && sum(r.amounts)).toBe(3337);
    for (let t = 1; t < 200; t++) expect(sum(allocate(t, [{ id: "a", w: 3 }, { id: "b", w: 3 }, { id: "c", w: 1 }]))).toBe(t);
  });

  it("clear messages when something's missing or doesn't add up", () => {
    expect(splitByItems([], 100)).toEqual({ ok: false, error: "Add the items on the bill." });
    expect(splitByItems([{ name: "Fries", amount: 0, people: ["a"] }], 100)).toMatchObject({ ok: false, error: "Add a price for Fries." });
    expect(splitByItems([{ name: "Fries", amount: 100, people: [] }], 100)).toMatchObject({ ok: false, error: "Pick who had Fries." });
    expect(splitByItems([{ name: "Fries", amount: 300, people: ["a"] }], 200)).toMatchObject({ ok: false });
  });

  it("items equal to the total: no extra to share", () => {
    const r = splitByItems([{ name: "Taxi", amount: 500, people: ["a", "b"] }], 500);
    expect(r).toMatchObject({ ok: true, extra: 0, amounts: { a: 250, b: 250 } });
  });
});
