import { describe, expect, it } from "vitest";
import { applySettleMin } from "@/lib/settle";
import { reminderPlan, isSettleDay } from "@/lib/home/reminders";

// Reminders (flats only, switched on in settings) and settle-up rules.

describe("leaving out small payments", () => {
  it("hides payments under the minimum and says how many", () => {
    const r = applySettleMin(
      [
        { from: "a", to: "b", amount: 3000 },
        { from: "c", to: "b", amount: 40000 },
      ],
      5000,
    );
    expect(r.shown).toEqual([{ from: "c", to: "b", amount: 40000 }]);
    expect(r.hidden).toBe(1);
    expect(applySettleMin([{ from: "a", to: "b", amount: 3000 }], 0)).toEqual({ shown: [{ from: "a", to: "b", amount: 3000 }], hidden: 0 });
  });
});

describe("settle-up day", () => {
  it("31 means the last day of the month", () => {
    expect(isSettleDay(31, "2026-02-28")).toBe(true);
    expect(isSettleDay(31, "2026-10-30")).toBe(false);
    expect(isSettleDay(1, "2026-11-01")).toBe(true);
    expect(isSettleDay(0, "2026-11-01")).toBe(false);
  });
});

describe("what reminders go out today", () => {
  const flat = {
    id: "g1", name: "Flat 402", type: "home", reminders: true, settleDay: 0, settleMin: 5000, currency: "INR",
    transfers: [
      { from: "rohan", to: "you", amount: 120000 },
      { from: "asha", to: "you", amount: 3000 },
    ],
    billsTomorrow: [] as { payerId: string; name: string }[],
    names: { you: "Varun", rohan: "Rohan", asha: "Asha" } as Record<string, string>,
  };
  it("nothing when reminders are off, or for a couple", () => {
    expect(reminderPlan("2026-10-19", [{ ...flat, reminders: false }])).toEqual([]);
    expect(reminderPlan("2026-10-19", [{ ...flat, type: "couple" }])).toEqual([]);
  });
  it("Mondays: whoever owes more than the minimum gets one nudge", () => {
    const p = reminderPlan("2026-10-19", [flat]); // a Monday
    expect(p.map((x) => [x.memberIds, x.body])).toEqual([[["rohan"], "You owe ₹1,200 in Flat 402. Settle up when you can."]]);
    expect(reminderPlan("2026-10-20", [flat])).toEqual([]); // Tuesday: nothing
  });
  it("a bill due tomorrow: only its payer is told", () => {
    const p = reminderPlan("2026-10-20", [{ ...flat, billsTomorrow: [{ payerId: "asha", name: "Electricity" }] }]);
    expect(p.map((x) => [x.memberIds, x.body])).toEqual([[["asha"], "Electricity is due tomorrow."]]);
  });
  it("settle-up day: everyone in a payment is told exactly what to pay or get", () => {
    const p = reminderPlan("2026-10-31", [{ ...flat, settleDay: 31 }]);
    expect(p.map((x) => [x.memberIds, x.body])).toEqual([
      [["rohan"], "It’s settle-up day in Flat 402: pay Varun ₹1,200."],
      [["you"], "It’s settle-up day in Flat 402: Rohan pays you ₹1,200."],
    ]);
  });
});
