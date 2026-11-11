import { describe, expect, it } from "vitest";
import { expenseSummary } from "@/lib/expense-summary";

// The line above Save on Add expense. Every case has shares that add up to the amount (checked first).

const names = { A: "Asha", R: "Ravi", M: "Meera", D: "Dev" };
type Sh = { memberId: string; amount: number };
function line(amount: number, shares: Sh[], viewer: string, o: { paidBy?: string; payers?: Sh[]; kind?: "expense" | "refund"; converted?: boolean; names?: Record<string, string> } = {}) {
  expect(shares.reduce((s, x) => s + x.amount, 0), "shares must add up to the amount").toBe(amount);
  const payers = o.payers ?? [];
  if (payers.length) expect(payers.reduce((s, x) => s + x.amount, 0)).toBe(amount);
  return expenseSummary({ amount, kind: o.kind ?? "expense", paidById: o.paidBy ?? "A", payers, shares }, viewer, "INR", o.names ?? names, o.converted ?? false);
}
const even = (ids: string[], each: number): Sh[] => ids.map((memberId) => ({ memberId, amount: each }));

describe("expenseSummary (C11)", () => {
  it("₹1,200 ÷ 4 (30000 each): the same for everyone", () => {
    const shares = even(["A", "R", "M", "D"], 30000);
    expect(line(120000, shares, "A")).toBe("₹1,200 · 4 people · ₹300 each");
    expect(line(120000, shares, "R")).toBe("₹1,200 · 4 people · ₹300 each");
  });

  it("₹100 ÷ 3 (3334 / 3333 / 3333), Asha paid: Asha sees she paid ₹100 and her share ₹33.34", () => {
    const shares: Sh[] = [{ memberId: "A", amount: 3334 }, { memberId: "R", amount: 3333 }, { memberId: "M", amount: 3333 }];
    expect(line(10000, shares, "A")).toBe("₹100 · 3 people · you paid ₹100; your share ₹33.34");
  });

  it("same, viewer Ravi (paid nothing): 'Asha paid; your share ₹33.33'", () => {
    const shares: Sh[] = [{ memberId: "A", amount: 3334 }, { memberId: "R", amount: 3333 }, { memberId: "M", amount: 3333 }];
    expect(line(10000, shares, "R")).toBe("₹100 · 3 people · Asha paid; your share ₹33.33");
  });

  it("a 60/40 couple, ₹1,000 (60000 / 40000): 'you paid ₹1,000; your share ₹600'", () => {
    const shares: Sh[] = [{ memberId: "A", amount: 60000 }, { memberId: "R", amount: 40000 }];
    expect(line(100000, shares, "A")).toBe("₹1,000 · 2 people · you paid ₹1,000; your share ₹600");
    expect(line(100000, shares, "R")).toBe("₹1,000 · 2 people · Asha paid; your share ₹400");
  });

  it("7 people, weights 1×6 and 1.5, ₹1,000: the 1.5 person's share is ₹200", () => {
    const ids = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"];
    const amounts = [13334, 13334, 13333, 13333, 13333, 13333, 20000]; // 26668 + 53332 + 20000 = 100000
    const shares = ids.map((memberId, i) => ({ memberId, amount: amounts[i] }));
    const n = Object.fromEntries(ids.map((id) => [id, id]));
    expect(line(100000, shares, "P7", { paidBy: "P1", names: n })).toBe("₹1,000 · 7 people · P1 paid; your share ₹200");
  });

  it("THB 1,000 on a card at 2.50 with 3%: total 257500, 64375 each, every figure with ≈", () => {
    // 100000 satang × 2.50 = 250000 paise; 3% = 7500; total 257500; ÷ 4 = 64375
    const shares = even(["A", "R", "M", "D"], 64375);
    expect(line(257500, shares, "A", { converted: true })).toBe("≈ ₹2,575 · 4 people · ≈ ₹643.75 each");
  });

  it("money back ₹600 ÷ 3 (20000 each)", () => {
    expect(line(60000, even(["A", "R", "M"], 20000), "R", { kind: "refund" })).toBe("₹600 back · 3 people · ₹200 each");
  });

  it("for one person only", () => {
    expect(line(50000, [{ memberId: "R", amount: 50000 }], "A")).toBe("₹500 · for Ravi only");
    expect(line(50000, [{ memberId: "R", amount: 50000 }], "R")).toBe("₹500 · for you only");
  });

  it("you're not in it at all", () => {
    // Ravi paid ₹300 for Asha and Meera (15000 each); Dev is just looking.
    const shares: Sh[] = [{ memberId: "A", amount: 15000 }, { memberId: "M", amount: 15000 }];
    expect(line(30000, shares, "D", { paidBy: "R" })).toBe("₹300 · 2 people · Ravi paid ₹300; not shared with you");
  });

  it("two people paid: you paid your part", () => {
    // ₹1,000: Asha put in 700, Ravi 300; shares 600 / 400. Ravi's view: he paid ₹300, his share is ₹400.
    const shares: Sh[] = [{ memberId: "A", amount: 60000 }, { memberId: "R", amount: 40000 }];
    const payers: Sh[] = [{ memberId: "A", amount: 70000 }, { memberId: "R", amount: 30000 }];
    expect(line(100000, shares, "R", { payers })).toBe("₹1,000 · 2 people · you paid ₹300; your share ₹400");
    expect(line(100000, shares, "M", { payers, names })).toBe("₹1,000 · 2 people · Asha and Ravi paid ₹1,000; not shared with you");
  });

  it("you paid for the others and have no share of your own", () => {
    // Asha paid ₹300 for Ravi and Meera. Equal (150 each): the plain line. Uneven (200 / 100): she paid ₹300, her share is ₹0.
    expect(line(30000, [{ memberId: "R", amount: 15000 }, { memberId: "M", amount: 15000 }], "A")).toBe("₹300 · 2 people · ₹150 each");
    expect(line(30000, [{ memberId: "R", amount: 20000 }, { memberId: "M", amount: 10000 }], "A")).toBe("₹300 · 2 people · you paid ₹300; your share ₹0");
  });
});
