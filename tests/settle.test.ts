import { describe, expect, it } from "vitest";
import { smartSettle, type Transfer } from "@/lib/settle";
import { netBalances } from "@/lib/balances";
import { buildActivity, byDay, dayLabel } from "@/lib/activity";

// Applying the suggested payments must leave everyone at exactly zero.
function settlesEveryone(net: Record<string, number>, transfers: Transfer[]) {
  const after = { ...net };
  for (const t of transfers) {
    expect(t.amount).toBeGreaterThan(0);
    after[t.from] += t.amount;
    after[t.to] -= t.amount;
  }
  return Object.values(after).every((v) => v === 0);
}

describe("Smart Settle", () => {
  it("routes a chain directly: A owes B, B owes C → A pays C", () => {
    const net = { a: -1000, b: 0, c: 1000 };
    expect(smartSettle(net)).toEqual([{ from: "a", to: "c", amount: 1000 }]);
  });

  it("dinner for three: two payments to the payer", () => {
    const net = { me: 200000, a: -100000, b: -100000 };
    const t = smartSettle(net);
    expect(t).toHaveLength(2);
    expect(settlesEveryone(net, t)).toBe(true);
  });

  it("uses exact matches first", () => {
    const net = { a: -500, b: -300, c: 300, d: 500 };
    expect(smartSettle(net)).toEqual([
      { from: "a", to: "d", amount: 500 },
      { from: "b", to: "c", amount: 300 },
    ]);
  });

  it("nothing to do when everyone is settled", () => {
    expect(smartSettle({ a: 0, b: 0 })).toEqual([]);
  });

  it("always clears every balance with at most (people − 1) payments", () => {
    for (let i = 0; i < 300; i++) {
      const n = 2 + (i % 8);
      const values = Array.from({ length: n - 1 }, () => Math.floor(Math.random() * 200001) - 100000);
      values.push(-values.reduce((s, v) => s + v, 0));
      const net = Object.fromEntries(values.map((v, k) => [`p${k}`, v]));
      const t = smartSettle(net);
      expect(settlesEveryone(net, t)).toBe(true);
      expect(t.length).toBeLessThanOrEqual(n - 1);
    }
  });

  it("works on real expenses plus a recorded payment", () => {
    const expenses = [
      { paidById: "me", amount: 90000, shares: [{ memberId: "me", amount: 30000 }, { memberId: "a", amount: 30000 }, { memberId: "b", amount: 30000 }] },
      { paidById: "a", amount: 60000, shares: [{ memberId: "a", amount: 30000 }, { memberId: "b", amount: 30000 }] },
    ];
    // b paid me back ₹100 already
    const net = netBalances(["me", "a", "b"], expenses, [{ fromId: "b", toId: "me", amount: 10000 }]);
    expect(net).toEqual({ me: 50000, a: 0, b: -50000 });
    expect(smartSettle(net)).toEqual([{ from: "b", to: "me", amount: 50000 }]);
  });
});

describe("activity history", () => {
  const d = (s: string) => new Date(s);
  it("merges expenses and payments newest first, with what each meant for me", () => {
    const items = buildActivity(
      [
        { id: "e1", description: "Dinner", category: "food", amount: 900, paidById: "me", createdAt: d("2026-10-12T10:00:00Z"), shares: [{ memberId: "me", amount: 300 }, { memberId: "a", amount: 300 }, { memberId: "b", amount: 300 }] },
        { id: "e2", description: "Taxi", category: "transport", amount: 400, paidById: "a", createdAt: d("2026-10-13T10:00:00Z"), shares: [{ memberId: "me", amount: 200 }, { memberId: "a", amount: 200 }] },
      ],
      [{ id: "p1", fromId: "b", toId: "me", amount: 300, createdAt: d("2026-10-14T10:00:00Z") }],
      "me",
    );
    expect(items.map((i) => [i.id, i.effect])).toEqual([
      ["p1", -300], // b paid me back: I'm owed 300 less
      ["e2", -200], // I owe a 200
      ["e1", 600], // I lent 600
    ]);
  });

  it("labels days in Indian time", () => {
    const now = d("2026-10-14T12:00:00Z");
    expect(dayLabel(d("2026-10-14T01:00:00Z"), now)).toBe("Today");
    expect(dayLabel(d("2026-10-13T10:00:00Z"), now)).toBe("Yesterday");
    expect(dayLabel(d("2026-10-10T10:00:00Z"), now)).toBe("Sat 10 Oct");
    expect(dayLabel(d("2025-03-01T10:00:00Z"), now)).toBe("1 Mar 2025");
  });

  it("groups by day", () => {
    const now = d("2026-10-14T12:00:00Z");
    const g = byDay([{ date: d("2026-10-14T05:00:00Z") }, { date: d("2026-10-14T04:00:00Z") }, { date: d("2026-10-12T04:00:00Z") }], now);
    expect(g.map((x) => [x.day, x.items.length])).toEqual([["Today", 2], ["Mon 12 Oct", 1]]);
  });
});

describe("pairwiseDebtCount (debts before Smart Settle)", () => {
  it("counts each pair of people who owe each other something", async () => {
    const { pairwiseDebtCount } = await import("@/lib/settle");
    const share = (memberId: string, amount: number) => ({ memberId, amount });
    // a pays for b; b pays for c → 2 separate debts (Smart Settle needs only 1 if amounts match)
    expect(pairwiseDebtCount([
      { paidById: "a", shares: [share("b", 100)] },
      { paidById: "b", shares: [share("c", 100)] },
    ])).toBe(2);
    // b pays a back in full → that debt disappears
    expect(pairwiseDebtCount([{ paidById: "a", shares: [share("b", 100)] }], [{ fromId: "b", toId: "a", amount: 100 }])).toBe(0);
  });
});

describe("history keeps deleted items and shows group changes", () => {
  it("deleted items stay in the list but count for nothing", () => {
    const d = (s: string) => new Date(s);
    const items = buildActivity(
      [{ id: "e1", description: "Dinner", category: "food", amount: 900, paidById: "me", createdAt: d("2026-10-12T10:00:00Z"),
         shares: [{ memberId: "me", amount: 450 }, { memberId: "a", amount: 450 }], createdById: "me", deletedAt: d("2026-10-13T10:00:00Z"), deletedById: "me" }],
      [{ id: "p1", fromId: "a", toId: "me", amount: 450, createdAt: d("2026-10-12T11:00:00Z"), createdById: "a", deletedAt: null }],
      "me",
      [
        { id: "ev1", kind: "group_renamed", actorId: "a", text: "renamed the group to “Goa”", details: "[]", createdAt: d("2026-10-14T10:00:00Z") },
        { id: "ev2", kind: "expense_added", actorId: "me", text: "added Dinner", details: "[]", createdAt: d("2026-10-12T10:00:00Z") },
      ],
    );
    expect(items.map((i) => [i.kind, i.id, i.effect])).toEqual([
      ["event", "ev1", 0], // group change shown as its own line
      ["payment", "p1", -450],
      ["expense", "e1", 0], // deleted: still listed, no effect
    ]);
    const e1 = items.find((i) => i.id === "e1");
    expect(e1?.kind === "expense" && e1.deletedById).toBe("me");
  });
});
