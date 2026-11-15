import { describe, expect, it } from "vitest";
import { accountPairKey, balanceLine, localPairKey, pairLine, pairName } from "@/lib/direct";
import { netBalances } from "@/lib/balances";
import { splitEqual, splitExact, type Share } from "@/lib/split";

// Expenses with one person (a pair): the money is the ordinary group maths with two people. Hand-worked, in paise.
// A = Asha (you, the first member, so she takes any odd paisa), R = Rohan.
// Every case checks the three invariants: shares add up to the expense, the two balances add up to 0, and settling brings both to 0.

const A = "asha";
const R = "rohan";
const sum = (xs: Share[]) => xs.reduce((s, x) => s + x.amount, 0);

type Case = { total: number; paidBy: string; shares: Share[]; kind?: "expense" | "refund" };
function check({ total, paidBy, shares, kind }: Case) {
  const expense = { paidById: paidBy, amount: total, shares, kind };
  const net = netBalances([A, R], [expense]);
  expect(sum(shares)).toBe(total); // shares add up to the expense exactly
  expect(net[A] + net[R]).toBe(0); // the pair's balances add up to 0
  // Settle: whoever is down pays the other exactly what they owe, then both are 0 and nothing else changed.
  const from = net[A] < 0 ? A : R;
  const to = from === A ? R : A;
  const after = netBalances([A, R], [expense], [{ fromId: from, toId: to, amount: Math.abs(net[A]) }]);
  expect(after[A]).toBe(0);
  expect(after[R]).toBe(0);
  return { net, expense };
}
const equal = (total: number) => {
  const r = splitEqual(total, [A, R]);
  if (!r.ok) throw new Error(r.error);
  return r.shares;
};

describe("a pair: equal splits", () => {
  it("₹1,200 equal, Asha paid: 60000 each; Rohan owes her 60000", () => {
    const shares = equal(120000);
    expect(shares).toEqual([{ memberId: A, amount: 60000 }, { memberId: R, amount: 60000 }]);
    const { net, expense } = check({ total: 120000, paidBy: A, shares });
    expect(net[A]).toBe(60000);
    expect(net[R]).toBe(-60000);
    expect(pairLine(expense, A, R, "Rohan", "INR")).toBe("Rohan owes you ₹600 for this expense.");
  });

  it("₹1,200.01 equal, Asha paid: she takes the odd paisa (60001 / 60000); Rohan still owes ₹600", () => {
    const shares = equal(120001);
    expect(shares).toEqual([{ memberId: A, amount: 60001 }, { memberId: R, amount: 60000 }]);
    const { net, expense } = check({ total: 120001, paidBy: A, shares });
    expect(net[A]).toBe(60000); // 120001 paid - 60001 share
    expect(net[R]).toBe(-60000);
    expect(pairLine(expense, A, R, "Rohan", "INR")).toBe("Rohan owes you ₹600 for this expense.");
  });

  it("₹1,200.01 equal, Rohan paid: Asha owes him 60001, which is ₹600.01", () => {
    const shares = equal(120001);
    const { net, expense } = check({ total: 120001, paidBy: R, shares });
    expect(net[A]).toBe(-60001);
    expect(net[R]).toBe(60001);
    expect(pairLine(expense, A, R, "Rohan", "INR")).toBe("You owe Rohan ₹600.01 for this expense.");
  });
});

describe("a pair: custom amounts must add up exactly", () => {
  const custom = (a: number, r: number) => {
    const x = splitExact(120000, [{ memberId: A, amount: a }, { memberId: R, amount: r }]);
    if (!x.ok) throw new Error(x.error);
    return x.shares;
  };
  it("70000 / 50000, Asha paid: Rohan owes 50000", () => {
    const { net, expense } = check({ total: 120000, paidBy: A, shares: custom(70000, 50000) });
    expect(net[R]).toBe(-50000);
    expect(pairLine(expense, A, R, "Rohan", "INR")).toBe("Rohan owes you ₹500 for this expense.");
  });
  it("the same split, Rohan paid: Asha owes 70000", () => {
    const { net, expense } = check({ total: 120000, paidBy: R, shares: custom(70000, 50000) });
    expect(net[A]).toBe(-70000);
    expect(pairLine(expense, A, R, "Rohan", "INR")).toBe("You owe Rohan ₹700 for this expense.");
  });
  it("700 / 400 on ₹1,200 is refused: 1,100 does not add up", () => {
    const r = splitExact(120000, [{ memberId: A, amount: 70000 }, { memberId: R, amount: 40000 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("add up to");
  });
});

describe("a pair: money back", () => {
  it("Rohan got ₹1,000 back, shared equally: he owes Asha 50000", () => {
    const shares = equal(100000);
    const { net, expense } = check({ total: 100000, paidBy: R, shares, kind: "refund" });
    expect(net[R]).toBe(-50000); // his 50000 share, less the 100000 he took
    expect(net[A]).toBe(50000);
    expect(pairLine(expense, A, R, "Rohan", "INR")).toBe("Rohan owes you ₹500 for this money back.");
  });
  it("an expense that nets to nothing says so", () => {
    const shares = [{ memberId: A, amount: 100000 }];
    const { expense } = check({ total: 100000, paidBy: A, shares });
    expect(pairLine(expense, A, R, "Rohan", "INR")).toBe("Nobody owes anything for this expense.");
  });
});

describe("a pair: keys, names and the balance line", () => {
  it("the account key is the same whoever asks, lower id first", () => {
    expect(accountPairKey("b", "a")).toBe("acc:a|acc:b");
    expect(accountPairKey("a", "b")).toBe("acc:a|acc:b");
  });
  it("a name only its owner sees is keyed by owner and a tidy lower-case name", () => {
    expect(localPairKey("acc1", "  Rohan  K ")).toBe("local:acc1|rohan k");
    expect(localPairKey("acc1", "ROHAN K")).toBe(localPairKey("acc1", "rohan   k"));
    expect(localPairKey("acc2", "Rohan K")).not.toBe(localPairKey("acc1", "Rohan K")); // someone else's "Rohan K" is a different pair
  });
  it("the pair's own name never passes 60 characters", () => {
    expect(pairName("Asha", "Rohan")).toBe("Asha & Rohan");
    expect(pairName("A".repeat(50), "B".repeat(50)).length).toBe(60);
  });
  it("the balance line is exact and says who owes whom", () => {
    expect(balanceLine(60000, "Rohan", "INR")).toBe("Rohan owes you ₹600");
    expect(balanceLine(-60001, "Rohan", "INR")).toBe("You owe Rohan ₹600.01");
    expect(balanceLine(0, "Rohan", "INR")).toBe("All settled");
  });
});
