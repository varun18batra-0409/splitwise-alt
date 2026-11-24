import { describe, expect, it } from "vitest";
import { planSettleRow, settleMainAction, tripEnded, type RowFacts } from "@/lib/settle-row";
import { differentAmountHref } from "@/lib/money";

// One layout for every payment on Settle up: one filled main button, one outlined action, one text link.

const base: RowFacts = { iPay: false, iAmPaid: false, closed: false, iLeft: false, payApps: 0 };

describe("a Settle up row", () => {
  it("I pay someone and have a payment app: Open payment app is the filled button, I've paid the outlined one (it records the payment), plus the link", () => {
    const p = planSettleRow({ ...base, iPay: true, payApps: 1 });
    expect(p).toMatchObject({ main: "pay-app", action: "record", actionFilled: false, actionLabel: "I’ve paid", differentAmount: true, filledButtons: 1 });
  });
  it("UPI and PayPal both saved: still ONE filled button (the other is a small link)", () => {
    expect(planSettleRow({ ...base, iPay: true, payApps: 2 }).filledButtons).toBe(1);
  });
  it("I pay someone with no payment app: I've paid becomes the one filled button", () => {
    const p = planSettleRow({ ...base, iPay: true });
    expect(p).toMatchObject({ main: null, action: "record", actionFilled: true, actionLabel: "I’ve paid", filledButtons: 1 });
  });
  it("someone owes me: Remind is the filled button; the outlined one records that they paid me", () => {
    const p = planSettleRow({ ...base, iAmPaid: true });
    expect(p).toMatchObject({ main: "remind", action: "record", actionFilled: false, actionLabel: "Mark received", filledButtons: 1, differentAmount: true });
  });
  it("two other people: Mark paid is an outline button, never the filled one", () => {
    const p = planSettleRow({ ...base });
    expect(p).toMatchObject({ main: null, action: "record", actionLabel: "Mark paid", actionFilled: false, filledButtons: 0 });
  });
  it("a closed group offers nothing to press; someone who left can't say they paid", () => {
    expect(planSettleRow({ ...base, iPay: true, closed: true, payApps: 1 })).toMatchObject({ action: null, differentAmount: false });
    const left = planSettleRow({ ...base, iPay: true, iLeft: true });
    expect(left).toMatchObject({ action: null, differentAmount: false });
  });
  it("the row's plan is the same whether or not the other person has joined: nothing waits for them any more (no status, no 'claim' action)", () => {
    const p = planSettleRow({ ...base, iPay: true });
    expect(Object.keys(p).sort()).toEqual(["action", "actionFilled", "actionLabel", "differentAmount", "filledButtons", "main"]);
    expect(p.action).not.toBe("claim");
  });
  it("never more than one filled button per row, even with UPI and PayPal both saved", () => {
    for (const iPay of [true, false])
      for (const iAmPaid of [true, false])
        for (const closed of [true, false])
          for (const iLeft of [true, false])
            for (const payApps of [0, 1, 2]) {
              if (iPay && iAmPaid) continue;
              const p = planSettleRow({ iPay, iAmPaid, closed, iLeft, payApps: iPay ? payApps : 0 });
              expect(p.filledButtons).toBeLessThanOrEqual(1);
              expect(p.actionFilled && p.main !== null).toBe(false);
            }
  });
  it("Paid a different amount? goes to Record a payment, amount filled, and comes back to Settle up", () => {
    expect(differentAmountHref("g1", "r1", "a1", "500")).toBe("/groups/g1/pay?from=r1&to=a1&amount=500&back=settle");
  });
});

describe("the closing actions under the rows: one main button", () => {
  it("a trip that has ended: Settle everything & close is the main action; Mark all paid is then a quiet link", () => {
    expect(settleMainAction({ type: "trip", transfers: 2, shown: 2, ended: true })).toBe("close");
  });
  it('a trip still on (or with no dates): "mark-all" (quiet, under More options), the group stays open', () => {
    expect(settleMainAction({ type: "trip", transfers: 2, shown: 2, ended: false })).toBe("mark-all");
    expect(settleMainAction({ type: "trip", transfers: 2, shown: 2 })).toBe("mark-all");
  });
  it("a trip that has ended with ONE payment shown: no second big button (that payment's own button is the main one)", () => {
    expect(settleMainAction({ type: "trip", transfers: 1, shown: 1, ended: true })).toBeNull();
    expect(settleMainAction({ type: "trip", transfers: 1, shown: 1, ended: false })).toBeNull();
  });
  it("someone who left sees no closing button at all, whatever the group", () => {
    expect(settleMainAction({ type: "trip", transfers: 2, shown: 2, ended: true, left: true })).toBeNull();
    expect(settleMainAction({ type: "home", transfers: 2, shown: 2, left: true })).toBeNull();
    expect(settleMainAction({ type: "home", transfers: 0, shown: 0, left: true })).toBeNull();
  });
  it('a home or card group with 2 payments: "mark-all" (shown quietly under More options as "Mark all N paid", other people\'s payments only)', () => {
    expect(settleMainAction({ type: "home", transfers: 2, shown: 2 })).toBe("mark-all");
    expect(settleMainAction({ type: "pot", transfers: 3, shown: 3 })).toBe("mark-all");
  });
  it("one payment in a home group: the payment's own button is the main one", () => {
    expect(settleMainAction({ type: "home", transfers: 1, shown: 1 })).toBeNull();
  });
  it("nothing left to pay: Close group is the one button", () => {
    expect(settleMainAction({ type: "home", transfers: 0, shown: 0 })).toBe("close");
  });
});

describe("tripEnded (viewer's today, plain days)", () => {
  const trip = { type: "trip", tripStart: "2026-11-10", tripEnd: "2026-11-14" };
  it("not ended before or on the day before the last day", () => {
    expect(tripEnded(trip, "2026-11-13")).toBe(false);
  });
  it("ended on the last day and after", () => {
    expect(tripEnded(trip, "2026-11-14")).toBe(true);
    expect(tripEnded(trip, "2026-11-20")).toBe(true);
  });
  it("no end date: the start day is the last day", () => {
    expect(tripEnded({ type: "trip", tripStart: "2026-11-10", tripEnd: "" }, "2026-11-10")).toBe(true);
    expect(tripEnded({ type: "trip", tripStart: "2026-11-10", tripEnd: "" }, "2026-11-09")).toBe(false);
  });
  it("no dates, or not a trip: not ended", () => {
    expect(tripEnded({ type: "trip", tripStart: "", tripEnd: "" }, "2026-11-20")).toBe(false);
    expect(tripEnded({ type: "home", tripStart: "2026-01-01", tripEnd: "" }, "2026-11-20")).toBe(false);
  });
});
