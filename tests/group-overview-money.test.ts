import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { netBalances } from "@/lib/balances";
import { smartSettle } from "@/lib/settle";
import { splitEqual } from "@/lib/split";
import { buildActivity } from "@/lib/activity";
import { recentRows } from "@/lib/group-overview";
import { formatMoney } from "@/lib/money";
import { exactMoney } from "@/lib/money-display";
import { endCode, groupTicketSides, sideCodes, sinceLastPayment } from "@/lib/home/money-card";

// R4: the group page's money ticket (Overview) shows the same figure as Settle up and the People tab. Amounts are paise: 180000 = ₹1,800.00.
// Hand-worked below. You (y), Nupur (n), Ravi (r). Nupur paid Dinner ₹1,800.00 (180000) and Boat tickets ₹3,600.00 (360000), split equally.
//   Dinner:  180000 / 3 = 60000 each.   Boat: 360000 / 3 = 120000 each.   Each person's share: 60000 + 120000 = 180000 = ₹1,800.00.
//   Shares add up to 3 x 180000 = 540000 = ₹5,400.00 (what was spent).   Nupur paid 540000, her share is 180000, so she is +360000 = ₹3,600.00.
//   You: -180000 (₹1,800.00).  Ravi: -180000 (₹1,800.00).  +360000 - 180000 - 180000 = 0.
const ids = ["y", "n", "r"];
const t0 = new Date("2026-10-08T10:00:00Z");
function expense(id: string, description: string, amount: number, minutes: number) {
  const split = splitEqual(amount, ids);
  if (!split.ok) throw new Error("split");
  return { id, description, category: "food", amount, paidById: "n", kind: "expense", createdAt: new Date(t0.getTime() + minutes * 60_000), shares: split.shares };
}
const dinner = expense("e1", "Dinner", 180000, 0);
const boat = expense("e2", "Boat tickets", 360000, 5);
const nameOf = (id: string) => ({ y: "You", n: "Nupur", r: "Ravi" })[id] ?? "Someone";

describe("the group ticket is Settle up is the People tab", () => {
  const net = netBalances(ids, [dinner, boat]);
  const transfers = smartSettle(net);
  it("shares are ₹1,800.00 each and add up to ₹5,400.00", () => {
    expect([dinner, boat].flatMap((e) => e.shares).reduce((t, s) => t + s.amount, 0)).toBe(540000);
    for (const id of ids) expect([dinner, boat].flatMap((e) => e.shares).filter((s) => s.memberId === id).reduce((t, s) => t + s.amount, 0)).toBe(180000);
  });
  it("Nupur +₹3,600.00, You -₹1,800.00, Ravi -₹1,800.00, and the balances add to zero", () => {
    expect(net).toEqual({ y: -180000, n: 360000, r: -180000 });
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it("Overview ticket: 'You owe Nupur' ₹1,800.00 (the very figure Settle up lists for you)", () => {
    expect(transfers).toEqual(expect.arrayContaining([{ from: "y", to: "n", amount: 180000 }, { from: "r", to: "n", amount: 180000 }]));
    const sides = groupTicketSides({ mine: net.y, myId: "y", transfers, nameOf });
    expect(sides).toEqual([{ side: "owe", amount: 180000, names: ["Nupur"] }]);
    const ticket = exactMoney(sides[0].amount, "INR");
    const settleUp = formatMoney(transfers.find((t) => t.from === "y")!.amount, "INR"); // what the Settle up card prints
    expect(ticket).toBe("₹1,800.00");
    expect(settleUp).toBe(ticket);
    expect(sideCodes("owe", sides[0].names)).toEqual({ from: "YOU", to: "NUP" });
  });
  it("People tab: Nupur 'gets ₹3,600.00', You and Ravi 'owes ₹1,800.00' (same formatter the tab uses)", () => {
    const words = (b: number) => (b > 0 ? `gets ${formatMoney(b, "INR")}` : b < 0 ? `owes ${formatMoney(-b, "INR")}` : "settled");
    expect([words(net.n), words(net.y), words(net.r)]).toEqual(["gets ₹3,600.00", "owes ₹1,800.00", "owes ₹1,800.00"]);
    const tab = readFileSync("src/app/groups/[id]/_components/BalancesTab.tsx", "utf8");
    expect(tab).toContain("`gets ${money(b)}`");
    expect(tab).toContain("`owes ${money(-b)}`");
  });
  it("Nupur's own ticket: ₹3,600.00 owed to her by 2 people, codes 2 PPL to YOU", () => {
    const sides = groupTicketSides({ mine: net.n, myId: "n", transfers, nameOf: (id) => ({ y: "Asha", n: "Nupur", r: "Ravi" })[id] ?? "?" });
    expect(sides).toHaveLength(1);
    expect(sides[0].amount).toBe(360000);
    expect(exactMoney(sides[0].amount, "INR")).toBe("₹3,600.00");
    expect(sideCodes("owed", sides[0].names)).toEqual({ from: "2 PPL", to: "YOU" });
  });
  it("after both pay Nupur ₹1,800.00: everything is zero, no sides (All square)", () => {
    const pays = [{ fromId: "y", toId: "n", amount: 180000 }, { fromId: "r", toId: "n", amount: 180000 }];
    const after = netBalances(ids, [dinner, boat], pays);
    expect(after).toEqual({ y: 0, n: 0, r: 0 });
    expect(smartSettle(after)).toEqual([]);
    expect(groupTicketSides({ mine: after.y, myId: "y", transfers: smartSettle(after), nameOf })).toEqual([]);
  });
  it("₹1,000.00 split 3 ways is 33334 / 33333 / 33333 paise (sum 100000); the balances sum to zero", () => {
    const s = splitEqual(100000, ids);
    if (!s.ok) throw new Error("split");
    expect(s.shares.map((x) => x.amount)).toEqual([33334, 33333, 33333]);
    expect(s.shares.reduce((t, x) => t + x.amount, 0)).toBe(100000);
    const lunch = { id: "e3", description: "Lunch", category: "food", amount: 100000, paidById: "n", kind: "expense", createdAt: t0, shares: s.shares };
    const n = netBalances(ids, [lunch]);
    expect(Object.values(n).reduce((a, b) => a + b, 0)).toBe(0);
    expect(n.n).toBe(100000 - 33333); // Nupur paid 100000 and owes herself 33333
  });
});

describe("Recent expenses are the first rows of Expenses", () => {
  it("same builder, same amounts: Boat tickets ₹3,600.00 then Dinner ₹1,800.00, newest first, at most 3", () => {
    const all = buildActivity([dinner, boat], [], "y");
    const recent = recentRows([dinner, boat], [], "y");
    expect(recent.map((r) => r.id)).toEqual(all.slice(0, 3).map((r) => r.id));
    expect(recent.map((r) => (r.kind === "expense" ? `${r.title} ${formatMoney(r.amount, "INR")}` : ""))).toEqual(["Boat tickets ₹3,600.00", "Dinner ₹1,800.00"]);
    const many = Array.from({ length: 5 }, (_, i) => expense(`x${i}`, `Item ${i}`, 10000, 10 + i));
    expect(recentRows(many, [], "y")).toHaveLength(3);
  });
  it("a deleted expense stays in the list, crossed out, the same on both", () => {
    const gone = { ...dinner, deletedAt: new Date(t0.getTime() + 60 * 60_000), deletedById: "n" };
    const recent = recentRows([gone, boat], [], "y");
    expect(recent.find((r) => r.id === "e1")).toMatchObject({ kind: "expense", deletedById: "n", effect: 0 });
    expect(buildActivity([gone, boat], [], "y").find((r) => r.id === "e1")).toEqual(recent.find((r) => r.id === "e1"));
  });
  it("a refund is a row of its own, flagged the same", () => {
    const back = { ...expense("e9", "Refund: boat", 120000, 30), kind: "refund" };
    expect(recentRows([dinner, boat, back], [], "y").find((r) => r.id === "e9")).toMatchObject({ kind: "expense", refund: true });
  });
});

describe("the pass fields", () => {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  it("with no payment yet every live expense counts: since 8 Oct, 2 items", () => {
    expect(sinceLastPayment([dinner, boat], [], day)).toEqual({ since: "2026-10-08", items: 2 });
  });
  it("after a payment only later expenses count; deleted ones never do; nothing new means no date and 0 items", () => {
    const pay = { createdAt: new Date(t0.getTime() + 10 * 60_000) };
    const later = expense("e4", "Taxi", 30000, 20);
    expect(sinceLastPayment([dinner, boat, later], [pay], day)).toEqual({ since: "2026-10-08", items: 1 });
    expect(sinceLastPayment([dinner, boat, { ...later, deletedAt: t0 }], [pay], day)).toEqual({ since: null, items: 0 });
    expect(sinceLastPayment([dinner], [{ createdAt: t0, deletedAt: t0 }], day).items).toBe(1); // a deleted payment is not a payment
  });
  it("codes: Settle up names become codes, you are YOU, several are N PPL, a name that would read YOU steps aside", () => {
    expect(endCode("You")).toBe("YOU");
    expect(endCode("Nupur")).toBe("NUP");
    expect(endCode("3 people")).toBe("3 PPL");
    expect(endCode("Youssef Khan")).toBe("YKH");
    expect(sideCodes("owed", ["Kabir Rao", "Meera"])).toEqual({ from: "2 PPL", to: "YOU" });
    expect(sideCodes("owe", [])).toEqual({ from: "YOU", to: "GRP" });
  });
});
