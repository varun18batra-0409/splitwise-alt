import { describe, expect, it } from "vitest";
import { howPhrase, whoPhrase, youResult, currencySign } from "@/lib/add-expense-sentence";
import { expensePairs } from "@/lib/payers";

const names: Record<string, string> = { me: "You", asha: "Asha", ravi: "Ravi", meera: "Meera" };
const name = (id: string) => names[id];
const inr = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN")}`;

describe("Add expense sentence: how it is split", () => {
  const base = { byItem: false, splitType: "equal" as const, groupSplitOn: false, splitName: "Our split" };
  it("equal, amounts, shares, percentage, item", () => {
    expect(howPhrase(base)).toBe("equally");
    expect(howPhrase({ ...base, splitType: "exact" })).toBe("by amounts");
    expect(howPhrase({ ...base, splitType: "shares" })).toBe("by shares");
    expect(howPhrase({ ...base, splitType: "percent" })).toBe("by percentage");
    expect(howPhrase({ ...base, byItem: true, splitType: "exact" })).toBe("by item");
  });
  it("the group's own split uses its name", () => {
    expect(howPhrase({ ...base, splitType: "shares", groupSplitOn: true })).toBe("by our split");
  });
});

describe("Add expense sentence: between whom", () => {
  it("all 4, both, a count, one name, nobody yet", () => {
    expect(whoPhrase(["me", "asha", "ravi", "meera"], 4, name)).toBe("all 4");
    expect(whoPhrase(["me", "asha"], 2, name)).toBe("both");
    expect(whoPhrase(["me", "asha", "ravi"], 4, name)).toBe("3 people");
    expect(whoPhrase(["ravi"], 4, name)).toBe("Ravi");
    expect(whoPhrase([], 4, name)).toBe("no one yet");
  });
});

describe("Add expense sentence: the result for you", () => {
  // Hand-worked: Asha paid 4,240.96 for 4 equal shares of 1,060.24; you owe Asha 1,060.24.
  it("you owe the one who paid", () => {
    const r = youResult([{ from: "me", to: "asha", amount: 106024 }], "me", false, name, inr);
    expect(r).toEqual([{ tone: "owe", lead: "You owe Asha", amount: "₹1,060.24" }]);
  });
  // You paid 2,400 for 4: Asha, Ravi and Meera owe you 600 each = 1,800 back.
  it("you paid for others: you get back the total of what they owe you", () => {
    const pairs = [
      { from: "asha", to: "me", amount: 60000 },
      { from: "ravi", to: "me", amount: 60000 },
      { from: "meera", to: "me", amount: 60000 },
    ];
    expect(youResult(pairs, "me", false, name, inr)).toEqual([{ tone: "owed", lead: "You get back", amount: "₹1,800" }]);
  });
  it("two people paid and you owe both: names them, one total", () => {
    const pairs = [
      { from: "me", to: "asha", amount: 10000 },
      { from: "me", to: "ravi", amount: 5000 },
    ];
    expect(youResult(pairs, "me", false, name, inr)).toEqual([{ tone: "owe", lead: "You owe Asha and Ravi", amount: "₹150" }]);
  });
  it("money both ways is two lines, never netted", () => {
    const pairs = [
      { from: "me", to: "asha", amount: 10000 },
      { from: "ravi", to: "me", amount: 4000 },
    ];
    const r = youResult(pairs, "me", false, name, inr);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ tone: "owe", lead: "You owe Asha", amount: "₹100" });
    expect(r[1]).toEqual({ tone: "owed", lead: "You get back", amount: "₹40" });
  });
  it("nothing to settle", () => {
    expect(youResult([], "me", true, name, inr)).toEqual([{ tone: "plain", lead: "Just you", amount: "" }]);
    expect(youResult([], "me", false, name, inr)[0].lead).toBe("Nobody owes anyone");
    expect(youResult([{ from: "asha", to: "ravi", amount: 100 }], "me", false, name, inr)[0].lead).toBe("Not shared with you");
  });
  it("matches the real pairs: Asha paid 4,240.96 split equally 4 ways", () => {
    const shares = ["me", "asha", "ravi", "meera"].map((memberId) => ({ memberId, amount: 106024 }));
    const pairs = expensePairs({ paidById: "asha", amount: 424096, kind: "expense", shares });
    const mine = youResult(pairs, "me", false, name, inr);
    expect(mine).toEqual([{ tone: "owe", lead: "You owe Asha", amount: "₹1,060.24" }]);
  });
});

describe("Add expense sentence: the small currency sign", () => {
  it("shows the sign for common currencies", () => {
    expect(currencySign("INR")).toBe("₹");
    expect(currencySign("THB")).toBe("฿");
    expect(currencySign("EUR")).toBe("€");
  });
  it("falls back to the code for something it can't read", () => {
    expect(currencySign("???")).toBe("???");
  });
});
