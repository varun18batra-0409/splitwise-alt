import { describe, expect, it } from "vitest";
import { explainBalance } from "@/lib/explain";
import { netBalances } from "@/lib/balances";

// "Why?" on a balance: the lines must always add up to the real balance.
describe("why is my balance this?", () => {
  const d = (s: string) => new Date(s);
  const expenses = [
    { id: "e1", description: "Dinner", category: "food", amount: 90000, markupAmount: 0, paidById: "me", createdAt: d("2026-10-10T10:00:00Z"),
      shares: [{ memberId: "me", amount: 30000 }, { memberId: "a", amount: 30000 }, { memberId: "b", amount: 30000 }] },
    { id: "e2", description: "Hotel", category: "accommodation", amount: 103000, markupAmount: 3000, paidById: "a", createdAt: d("2026-10-11T10:00:00Z"),
      shares: [{ memberId: "me", amount: 51500 }, { memberId: "a", amount: 51500 }] },
    { id: "e3", description: "Taxi", category: "transport", amount: 20000, markupAmount: 0, paidById: "b", createdAt: d("2026-10-12T10:00:00Z"),
      shares: [{ memberId: "a", amount: 10000 }, { memberId: "b", amount: 10000 }] },
  ];
  const payments = [{ id: "p1", fromId: "b", toId: "me", amount: 10000, createdAt: d("2026-10-13T10:00:00Z") }];
  const nameOf = (id: string) => ({ me: "You", a: "Asha", b: "Ben" })[id] ?? "?";

  it("adds up to the balance, for everyone", () => {
    const net = netBalances(["me", "a", "b"], expenses, payments);
    for (const id of ["me", "a", "b"]) {
      const w = explainBalance(id, expenses, payments, nameOf);
      expect(w.balance).toBe(net[id]);
      expect(w.lines.reduce((s, l) => s + l.effect, 0)).toBe(net[id]);
    }
  });

  it("shows what you paid, your share, your card fees and payments", () => {
    const w = explainBalance("me", expenses, payments, nameOf);
    expect(w.paidTotal).toBe(90000);
    expect(w.shareTotal).toBe(81500);
    expect(w.feeTotal).toBe(1500);
    expect(w.received).toBe(10000);
    expect(w.lines.map((l) => l.label)).toEqual(["Ben paid them", "Hotel", "Dinner"]); // newest first, Taxi not involved
  });
});
