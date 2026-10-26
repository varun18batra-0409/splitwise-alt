import { describe, expect, it } from "vitest";
import { parseQuickLine } from "@/lib/quickline";
import { extraAmount, itemize, itemsNote } from "@/lib/itemize";

const M = [
  { id: "me", name: "Varun" },
  { id: "r", name: "Ravi Kumar" },
  { id: "a", name: "Asha" },
  { id: "m", name: "Meera" },
  { id: "d", name: "Dev" },
];
const q = (t: string) => {
  const { understood: _u, ...rest } = parseQuickLine(t, M, "me");
  return rest;
};

describe("Quick line (type an expense as a sentence, no AI)", () => {
  it("amount, who paid, and who it was with", () => {
    expect(q("Dinner 2400 Ravi paid split with Asha Meera")).toEqual({ name: "Dinner", amount: "2400", paidById: "r", forIds: ["r", "a", "m"] });
    expect(q("paid by Asha 500 lunch")).toEqual({ name: "Lunch", amount: "500", paidById: "a", forIds: undefined });
    expect(q("Movie tickets ₹900 with Asha")).toEqual({ name: "Movie tickets", amount: "900", paidById: undefined, forIds: ["me", "a"] });
  });

  it("except, everyone, just one person", () => {
    expect(q("Cab 600 except Dev").forIds).toEqual(["me", "r", "a", "m"]);
    expect(q("Petrol 2,000 everyone")).toMatchObject({ name: "Petrol", amount: "2000", forIds: ["me", "r", "a", "m", "d"] });
    expect(q("I paid 300 for Asha")).toMatchObject({ amount: "300", paidById: "me", forIds: ["a"] });
  });

  it("amounts the way people type them", () => {
    expect(q("Groceries 1.2k").amount).toBe("1200");
    expect(q("Taxi 1,20,000 split with Asha,Meera")).toMatchObject({ amount: "120000", forIds: ["me", "a", "m"] });
    expect(q("Cake $25.50 Ravi Kumar paid")).toMatchObject({ amount: "25.50", paidById: "r", name: "Cake" });
    expect(q("Snacks Rs.120").amount).toBe("120");
  });

  it("a few Hindi words", () => {
    expect(q("Ravi ne 500 diye cab ke liye")).toMatchObject({ name: "Cab", amount: "500", paidById: "r" });
    expect(q("Chai 200 sab").forIds).toEqual(["me", "r", "a", "m", "d"]);
  });

  it("leaves things alone it didn't understand", () => {
    expect(q("Groceries")).toEqual({ name: "Groceries", amount: "", paidById: undefined, forIds: undefined });
    expect(q("")).toEqual({ name: "", amount: "", paidById: undefined, forIds: undefined });
  });
});

describe("Split by item, with tax / service / tip", () => {
  it("each item shared by who had it; extras by what each ordered; adds up exactly", () => {
    // Asha: ₹300 soup. Ravi + Varun share ₹900 biryani. Everyone shares ₹300 dessert.
    const r = itemize(
      [
        { name: "Soup", price: 30000, who: ["a"] },
        { name: "Biryani", price: 90000, who: ["r", "me"] },
        { name: "Dessert", price: 30000, who: ["a", "r", "me"] },
      ],
      [extraAmount("10%", 150000, "INR")!, extraAmount("50", 150000, "INR")!],
    )!;
    // Items: Asha 400, Ravi 550, Varun 550 = 1,500. Extras ₹150 + ₹50 = ₹200, split 4 : 5.5 : 5.5.
    expect(r.subtotal).toBe(150000);
    expect(r.extras).toBe(20000);
    expect(r.total).toBe(170000);
    expect(r.perPerson.a + r.perPerson.r + r.perPerson.me).toBe(170000);
    expect(r.perPerson).toEqual({ a: 45334, r: 62333, me: 62333 }); // the odd paisa goes to the first, never lost
  });

  it("rejects an item nobody had, and odd extras", () => {
    expect(itemize([{ name: "X", price: 100, who: [] }], [])).toBeNull();
    expect(itemize([], [])).toBeNull();
    expect(extraAmount("abc", 1000, "INR")).toBeNull();
    expect(extraAmount("150%", 1000, "INR")).toBeNull();
    expect(extraAmount("", 1000, "INR")).toBe(0);
    expect(extraAmount("5%", 99999, "INR")).toBe(5000);
  });

  it("writes the bill into the notes", () => {
    expect(itemsNote([{ name: "Soup", priceText: "₹300", whoText: "Asha" }, { name: "", priceText: "", whoText: "" }], ["Tax 10%: shared by what each had"])).toBe("Soup ₹300 (Asha)\nTax 10%: shared by what each had");
  });
});
