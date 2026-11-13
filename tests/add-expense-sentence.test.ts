import { describe, expect, it } from "vitest";
import { howPhrase, whoPhrase, youResult, currencySign, resultSentence, whoRowPhrase, splitSubline, groupDigits } from "@/lib/add-expense-sentence";
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
    // Not in the shares at all: "Not shared with you".
    expect(youResult([{ from: "asha", to: "ravi", amount: 100 }], "me", false, name, inr, false)[0].lead).toBe("Not shared with you");
  });
  // Hand-worked: 1,000 split 4 ways = 250 each. You paid 250, Asha paid 750. You put in 250 and owe 250: square.
  // Ravi and Meera each owe Asha 250 (pairs that don't involve you).
  it("you're square when what you paid equals your share (never 'Not shared with you')", () => {
    const shares = ["me", "asha", "ravi", "meera"].map((memberId) => ({ memberId, amount: 25000 }));
    const payers = JSON.stringify([{ m: "me", a: 25000 }, { m: "asha", a: 75000 }]);
    const pairs = expensePairs({ paidById: "asha", amount: 100000, kind: "expense", payers, shares });
    expect(pairs).toEqual([
      { from: "ravi", to: "asha", amount: 25000 },
      { from: "meera", to: "asha", amount: 25000 },
    ]);
    expect(youResult(pairs, "me", false, name, inr, true)[0].lead).toBe("You're square");
    const s = resultSentence({ payers: [{ memberId: "me", amount: 25000 }, { memberId: "asha", amount: 75000 }], total: 100000, pairs, myId: "me", myShare: 25000, inShares: true, justMe: false, refund: false, name, money: inr });
    expect(s).toEqual([{ text: "You're square", amount: "", tone: "plain" }]);
  });
  it("not in the shares at all: 'Not shared with you'", () => {
    const pairs = [{ from: "ravi", to: "asha", amount: 25000 }];
    const s = resultSentence({ payers: [{ memberId: "asha", amount: 50000 }], total: 50000, pairs, myId: "me", myShare: 0, inShares: false, justMe: false, refund: false, name, money: inr });
    expect(s).toEqual([{ text: "Not shared with you", amount: "", tone: "plain" }]);
  });
});

describe("Add expense sentence: the line under the card", () => {
  // Nupur paid 1,800 for 6 equal shares of 300: your share is 300.
  it("someone else paid: their name, the total, your share", () => {
    const n = (id: string) => ({ me: "You", nupur: "Nupur" })[id] ?? id;
    const pairs = [{ from: "me", to: "nupur", amount: 30000 }];
    expect(resultSentence({ payers: [{ memberId: "nupur", amount: 180000 }], total: 180000, pairs, myId: "me", myShare: 30000, inShares: true, justMe: false, refund: false, name: n, money: inr })).toEqual([
      { text: "Nupur paid ₹1,800.", amount: "", tone: "plain" },
      { text: "Your share is", amount: "₹300.", tone: "owe" },
    ]);
  });
  // You paid 2,400 for 4: 600 each, so Asha, Ravi and Meera owe you 1,800.
  it("you paid: what you get back", () => {
    const pairs = ["asha", "ravi", "meera"].map((from) => ({ from, to: "me", amount: 60000 }));
    expect(resultSentence({ payers: [{ memberId: "me", amount: 240000 }], total: 240000, pairs, myId: "me", myShare: 60000, inShares: true, justMe: false, refund: false, name, money: inr })).toEqual([
      { text: "You paid ₹2,400.", amount: "", tone: "plain" },
      { text: "You get back", amount: "₹1,800.", tone: "owed" },
    ]);
  });
  // You 100 + Asha 100 paid 200 for 4 (50 each): you and Asha are each owed 50 by Ravi / Meera.
  it("several payers are joined with +", () => {
    const pairs = [{ from: "ravi", to: "me", amount: 5000 }, { from: "meera", to: "asha", amount: 5000 }];
    const s = resultSentence({ payers: [{ memberId: "me", amount: 10000 }, { memberId: "asha", amount: 10000 }], total: 20000, pairs, myId: "me", myShare: 5000, inShares: true, justMe: false, refund: false, name, money: inr });
    expect(s[0].text).toBe("You + Asha paid ₹200.");
    expect(s[1]).toEqual({ text: "You get back", amount: "₹50.", tone: "owed" });
  });
  // Money back: Asha got 400 back, shared by 4 (100 each): you get back 100 of it.
  it("money back says who got it", () => {
    const pairs = [{ from: "asha", to: "me", amount: 10000 }];
    const s = resultSentence({ payers: [{ memberId: "asha", amount: 40000 }], total: 40000, pairs, myId: "me", myShare: 10000, inShares: true, justMe: false, refund: true, name, money: inr });
    expect(s).toEqual([
      { text: "Asha got ₹400 back.", amount: "", tone: "plain" },
      { text: "You get back", amount: "₹100.", tone: "owed" },
    ]);
  });
  it("just you", () => {
    expect(resultSentence({ payers: [{ memberId: "me", amount: 5000 }], total: 5000, pairs: [], myId: "me", myShare: 5000, inShares: true, justMe: true, refund: false, name, money: inr })).toEqual([{ text: "Just you", amount: "", tone: "plain" }]);
  });
});

describe("Add expense: the two rows", () => {
  it("who it is split between", () => {
    expect(whoRowPhrase(["me"], "me", name)).toBe("Just you");
    expect(whoRowPhrase(["asha", "me"], "me", name)).toBe("You and Asha");
    expect(whoRowPhrase(["asha", "ravi"], "me", name)).toBe("Asha and Ravi");
    expect(whoRowPhrase(["asha"], "me", name)).toBe("Asha");
    expect(whoRowPhrase(["me", "asha", "ravi", "meera", "x", "y"], "me", name)).toBe("6 people");
  });
  it("how it is split, with the per-person figure only when equal", () => {
    const b = { byItem: false, splitType: "equal" as const, groupSplitOn: false, splitName: "Our split", each: "₹300" };
    expect(splitSubline(b)).toBe("Equally · ₹300 each");
    expect(splitSubline({ ...b, each: null })).toBe("Equally");
    expect(splitSubline({ ...b, splitType: "exact" })).toBe("By amounts");
    expect(splitSubline({ ...b, splitType: "shares" })).toBe("By shares");
    expect(splitSubline({ ...b, splitType: "percent" })).toBe("By percentage");
    expect(splitSubline({ ...b, byItem: true })).toBe("By item");
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
  it("other dollars get a prefix; US dollars stay $", () => {
    expect(currencySign("USD")).toBe("$");
    expect(currencySign("AUD")).toBe("A$");
    expect(currencySign("CAD")).toBe("C$");
    expect(currencySign("SGD")).toBe("S$");
    expect(currencySign("NZD")).toBe("NZ$");
    expect(currencySign("HKD")).toBe("HK$");
  });
});

describe("groupDigits (display only: the typed amount is what is saved)", () => {
  it("INR is lakh style, others are thousands", () => {
    expect(groupDigits("123456", "INR")).toBe("1,23,456");
    expect(groupDigits("1000", "INR")).toBe("1,000");
    expect(groupDigits("100", "INR")).toBe("100");
    expect(groupDigits("1234567.5", "INR")).toBe("12,34,567.5");
    expect(groupDigits("1800", "THB")).toBe("1,800");
    expect(groupDigits("1234567", "USD")).toBe("1,234,567");
  });
  it("anything that is not plain digits is left exactly as typed", () => {
    expect(groupDigits("12,50", "INR")).toBe("12,50");
    expect(groupDigits("", "INR")).toBe("");
    expect(groupDigits("1,000", "INR")).toBe("1,000");
  });
  it("what the form reads is unchanged: the grouped text parses to the same amount", async () => {
    const { parseAmount } = await import("@/lib/money");
    expect(parseAmount(groupDigits("123456", "INR"), "INR")).toBe(parseAmount("123456", "INR"));
    expect(parseAmount(groupDigits("1800", "THB"), "THB")).toBe(parseAmount("1800", "THB"));
  });
});
