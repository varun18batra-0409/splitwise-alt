import { describe, expect, it } from "vitest";
import { netBalances } from "@/lib/balances";
import { buildActivity } from "@/lib/activity";
import { explainBalance } from "@/lib/explain";
import { buildExpense, type ExpenseDraft } from "@/lib/expense";

// Money back (refunds): whoever got the money owes it to the people it's shared with.

const ids = ["you", "asha", "rohan"];
const draft = (over: Partial<ExpenseDraft>): ExpenseDraft => ({
  amount: "1500", currency: "INR", paidById: "asha", forMode: "everyone", selected: [], onePersonId: "",
  splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", ...over,
});
const ctx = { memberIds: ids, baseCurrency: "INR", groupMarkupBp: 300, rate: "1" };

function row(id: string, d: ExpenseDraft, kind: "expense" | "refund", c = ctx) {
  const r = buildExpense({ ...d, kind }, c);
  if (!r.ok) throw new Error(r.error);
  const e = r.expense;
  return { id, description: "x", category: "other", createdAt: new Date(), markupAmount: e.markupAmount, originalAmount: e.originalAmount, originalCurrency: e.originalCurrency, baseCurrency: e.baseCurrency, amount: e.amount, paidById: e.paidById, payers: "", kind: e.kind, shares: e.shares };
}

describe("money back", () => {
  it("Asha got ₹1,500 back, shared by 3: she owes ₹500 to each of the others", () => {
    expect(netBalances(ids, [row("r", draft({}), "refund")])).toEqual({ you: 50000, asha: -100000, rohan: 50000 });
  });
  it("an expense and the same amount back cancel out", () => {
    const net = netBalances(ids, [row("e", draft({}), "expense"), row("r", draft({}), "refund")]);
    expect(net).toEqual({ you: 0, asha: 0, rohan: 0 });
  });
  it("a THB card refund is the exact negative of the same THB expense", () => {
    const thb = draft({ amount: "1000", currency: "THB", paymentMethod: "card" });
    const c = { ...ctx, rate: "2.5" };
    const spent = netBalances(ids, [row("e", thb, "expense", c)]);
    const back = netBalances(ids, [row("r", thb, "refund", c)]);
    for (const id of ids) expect(back[id]).toBe(-spent[id]);
  });
  it("in my history, money someone else got back shows as owed to me", () => {
    const items = buildActivity([{ ...row("r", draft({}), "refund"), title: "x" } as never], [], "you");
    expect(items[0].effect).toBe(50000);
    expect(items[0].kind === "expense" && items[0].refund).toBe(true);
  });
  it("Why? lines still add up to the balance", () => {
    const rows = [row("e", draft({ paidById: "you" }), "expense"), row("r", draft({}), "refund")];
    const net = netBalances(ids, rows);
    for (const id of ids) expect(explainBalance(id, rows, [], (x) => x).balance).toBe(net[id]);
  });
});
