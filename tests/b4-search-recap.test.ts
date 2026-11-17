import { describe, expect, it } from "vitest";
import { recap, recapRows } from "@/lib/search";
import { formatMoney } from "@/lib/money";

// Batch B4 (OP-3, VD2-17): the Search summary counts expenses only (a card game's result is not spending), and its
// "my cut" is the same exact figure as the row under it.
type Row = { item: { id: string; kind: string; amount: number; category: string; refund: boolean; pot?: boolean }; g: { group: { currency: string } } };
const g = { group: { currency: "INR" } };
const mine: Record<string, number> = { hotel: 300000, dinner: 100000, game: 50000, one: 193005 };

describe("recapRows", () => {
  const shown: Row[] = [
    { item: { id: "hotel", kind: "expense", amount: 900000, category: "accommodation", refund: false }, g },
    { item: { id: "dinner", kind: "expense", amount: 300000, category: "food", refund: false }, g },
    { item: { id: "game", kind: "expense", amount: 50000, category: "other", refund: false, pot: true }, g },
    { item: { id: "pay", kind: "payment", amount: 99900, category: "", refund: false }, g },
  ];
  it("Hotel 9,000 (mine 3,000) + Dinner 3,000 (mine 1,000), a game result of 500 is left out: spent 12,000, mine 4,000, 2 expenses", () => {
    const s = recap(recapRows(shown, (r) => mine[r.item.id] ?? 0));
    expect(s.count).toBe(2);
    expect(s.totals).toEqual([{ currency: "INR", spent: 1200000, mine: 400000 }]);
  });
  it("a single expense with my share 1,930.05 reads ₹1,930.05, the same as its row", () => {
    const one: Row[] = [{ item: { id: "one", kind: "expense", amount: 386010, category: "food", refund: false }, g }];
    const s = recap(recapRows(one, (r) => mine[r.item.id] ?? 0));
    expect(formatMoney(s.totals[0].mine, "INR")).toBe("₹1,930.05");
  });
  it("money back counts as minus", () => {
    const back: Row[] = [{ item: { id: "hotel", kind: "expense", amount: 900000, category: "accommodation", refund: true }, g }];
    const s = recap(recapRows(back, (r) => mine[r.item.id] ?? 0));
    expect(s.totals[0]).toMatchObject({ spent: -900000, mine: -300000 });
  });
});
