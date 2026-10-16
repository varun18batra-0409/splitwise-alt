import { describe, expect, it } from "vitest";
import { buildActivity, filterActivity, hasFilter } from "@/lib/activity";

// History filters: type, dates, who paid, amount.

const day = (d: string) => new Date(`${d}T12:00:00+05:30`);
const exp = (id: string, d: string, amount: number, extra: object = {}) => ({
  id, description: id, category: "food", amount, paidById: "you", createdAt: day(d), spentAt: day(d),
  shares: [{ memberId: "you", amount: amount / 2 }, { memberId: "asha", amount: amount / 2 }], ...extra,
});
const items = buildActivity(
  [
    exp("Dinner", "2026-10-02", 120000),
    exp("Taxi", "2026-10-10", 40000),
    exp("Hotel", "2026-09-28", 600000, { payers: JSON.stringify([{ m: "you", a: 300000 }, { m: "rohan", a: 300000 }]) }),
    exp("Refund", "2026-10-11", 20000, { kind: "refund", paidById: "asha" }),
  ],
  [{ id: "p1", fromId: "asha", toId: "you", amount: 50000, createdAt: day("2026-10-12") }],
  "you",
  [{ id: "e1", kind: "group_renamed", actorId: "you", text: "renamed the group", details: "[]", createdAt: day("2026-10-01") }],
);
const names = (list: ReturnType<typeof filterActivity>) => list.map((i) => (i.kind === "expense" ? i.title : i.kind === "payment" ? "payment" : "change"));
const run = (f: Parameters<typeof filterActivity>[1]) => names(filterActivity(items, f, (id) => id));

describe("history filters", () => {
  it("by type", () => {
    expect(run({ type: "payment" })).toEqual(["payment"]);
    expect(run({ type: "refund" })).toEqual(["Refund"]);
    expect(run({ type: "expense" }).sort()).toEqual(["Dinner", "Hotel", "Taxi"]);
    expect(run({ type: "change" })).toEqual(["change"]);
  });
  it("by dates, inclusive, in India time", () => {
    expect(run({ from: "2026-10-02", to: "2026-10-10", tz: "Asia/Kolkata" }).sort()).toEqual(["Dinner", "Taxi"]);
    expect(run({ from: "2026-10-11", tz: "Asia/Kolkata" }).sort()).toEqual(["Refund", "payment"]);
  });
  it("by who paid, counting everyone who paid", () => {
    expect(run({ by: "rohan" })).toEqual(["Hotel"]);
    expect(run({ by: "asha" }).sort()).toEqual(["Refund", "payment"]);
  });
  it("by amount (in the group currency)", () => {
    expect(run({ min: "500" }).sort()).toEqual(["Dinner", "Hotel", "payment"]);
    expect(run({ min: "300", max: "1200" }).sort()).toEqual(["Dinner", "Taxi", "payment"]);
  });
  it("each new filter counts as filtering", () => {
    for (const f of [{ type: "payment" }, { from: "2026-10-01" }, { to: "2026-10-01" }, { by: "you" }, { min: "1" }, { max: "1" }] as const) {
      expect(hasFilter(f)).toBe(true);
    }
    expect(hasFilter({})).toBe(false);
  });
});
