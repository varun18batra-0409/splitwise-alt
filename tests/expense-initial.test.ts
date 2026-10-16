import { describe, expect, it } from "vitest";
import { initialFromExpense } from "@/lib/expense-initial";

// Starting a new expense from one that was just saved ("Save & add another")
// or from an old one ("Repeat"), and editing one — all from the same rules.

const saved = {
  id: "e1",
  description: "Dinner at Bastian",
  category: "food",
  notes: "Rahul paid the tip",
  amount: 300000,
  originalAmount: 300000,
  originalCurrency: "INR",
  baseCurrency: "INR",
  exchangeRate: "1",
  rateDate: "2026-10-14",
  paymentMethod: "",
  markupBp: 0,
  splitType: "shares",
  forMode: "everyone",
  paidById: "you",
  payers: JSON.stringify([{ m: "you", a: 200000 }, { m: "asha", a: 100000 }]),
  kind: "expense",
  spentAt: new Date("2026-10-14T12:00:00+05:30"),
  createdAt: new Date("2026-10-14T12:00:00+05:30"),
  editedAt: null,
  shares: [{ memberId: "you", amount: 112500 }, { memberId: "asha", amount: 93750 }, { memberId: "rohan", amount: 93750 }],
};
const ctx = { groupMarkupBp: 0, groupWeights: { you: 120, asha: 100, rohan: 100 }, tz: "Asia/Kolkata", today: "2026-10-16" };

describe("initialFromExpense", () => {
  it("edit: everything as saved, with the version", () => {
    const i = initialFromExpense(saved, ctx, "edit");
    expect(i.name).toBe("Dinner at Bastian");
    expect(i.amount).toBe("3000");
    expect(i.date).toBe("2026-10-14");
    expect(i.splitType).toBe("shares");
    expect(i.shares).toEqual({ you: "1.2", asha: "1", rohan: "1" });
    expect(i.multiPay).toBe(true);
    expect(i.payers).toEqual({ you: "2000", asha: "1000" });
    expect(i.version).toBe(saved.createdAt.toISOString());
  });
  it("again: same people, payers, split and date; empty name, amount and notes", () => {
    const i = initialFromExpense(saved, ctx, "again");
    expect(i.name).toBe("");
    expect(i.amount).toBe("");
    expect(i.notes).toBe("");
    expect(i.date).toBe("2026-10-14");
    expect(i.multiPay).toBe(true);
    expect(i.payers).toEqual({});
    expect(i.paidById).toBe("you");
    expect(i.splitType).toBe("shares");
    expect(i.version).toBe("");
  });
  it("repeat: everything the same, dated today", () => {
    const i = initialFromExpense(saved, ctx, "repeat");
    expect(i.name).toBe("Dinner at Bastian");
    expect(i.amount).toBe("3000");
    expect(i.date).toBe("2026-10-16");
    expect(i.payers).toEqual({ you: "2000", asha: "1000" });
    expect(i.version).toBe("");
  });
  it("money back stays money back", () => {
    expect(initialFromExpense({ ...saved, kind: "refund", payers: "" }, ctx, "repeat").kind).toBe("refund");
  });
});
