import { describe, expect, it } from "vitest";
import { planSettleRow, type RowFacts } from "@/lib/settle-row";
import { differentAmountHref } from "@/lib/money";

// One layout for every payment on Settle up: one filled main button, one outlined action, one text link.

const base: RowFacts = { iPay: false, iAmPaid: false, closed: false, iLeft: false, receiverCanConfirm: true, payApps: 0, myClaimWaiting: false, theirClaimWaiting: false };

describe("a Settle up row", () => {
  it("I pay someone on Loopin who has a payment app: Open payment app is the filled button, I've paid the outlined one, plus the link", () => {
    const p = planSettleRow({ ...base, iPay: true, payApps: 1 });
    expect(p).toMatchObject({ main: "pay-app", action: "claim", actionFilled: false, actionLabel: "I’ve paid", differentAmount: true, filledButtons: 1 });
  });
  it("I pay someone with no payment app: I've paid becomes the one filled button", () => {
    const p = planSettleRow({ ...base, iPay: true });
    expect(p).toMatchObject({ main: null, action: "claim", actionFilled: true, filledButtons: 1 });
  });
  it("my I've paid is waiting: it says so, no second button, no link; the claim can be taken back", () => {
    const p = planSettleRow({ ...base, iPay: true, payApps: 1, myClaimWaiting: true });
    expect(p).toMatchObject({ action: null, status: "waiting", differentAmount: false });
  });
  it("someone owes me: Remind is the filled button; the outlined one records that they paid me", () => {
    const p = planSettleRow({ ...base, iAmPaid: true });
    expect(p).toMatchObject({ main: "remind", action: "record", actionFilled: false, actionLabel: "They’ve paid me", filledButtons: 1, differentAmount: true });
  });
  it("they already say they paid me: no Remind, no second way to record it; the box above answers it", () => {
    const p = planSettleRow({ ...base, iAmPaid: true, theirClaimWaiting: true });
    expect(p).toMatchObject({ main: null, action: null, status: "their-claim", filledButtons: 0 });
  });
  it("I pay someone who can't confirm (not on Loopin): it counts straight away, with the same words", () => {
    const p = planSettleRow({ ...base, iPay: true, receiverCanConfirm: false });
    expect(p).toMatchObject({ action: "record", actionLabel: "I’ve paid", actionFilled: true });
  });
  it("two other people: Mark paid is the row's one button (filled, as there is nothing else on it)", () => {
    const p = planSettleRow({ ...base });
    expect(p).toMatchObject({ main: null, action: "record", actionLabel: "Mark paid", filledButtons: 1 });
  });
  it("a closed group offers nothing to press; someone who left can't say they paid", () => {
    expect(planSettleRow({ ...base, iPay: true, closed: true, payApps: 1 })).toMatchObject({ action: null, differentAmount: false });
    const left = planSettleRow({ ...base, iPay: true, iLeft: true });
    expect(left).toMatchObject({ action: null, differentAmount: false });
  });
  it("never more than one filled button per row (one per payment app when there are several)", () => {
    for (const iPay of [true, false])
      for (const iAmPaid of [true, false])
        for (const closed of [true, false])
          for (const iLeft of [true, false])
            for (const receiverCanConfirm of [true, false])
              for (const payApps of [0, 1, 2])
                for (const myClaimWaiting of [true, false])
                  for (const theirClaimWaiting of [true, false]) {
                    if (iPay && iAmPaid) continue;
                    const p = planSettleRow({ iPay, iAmPaid, closed, iLeft, receiverCanConfirm, payApps: iPay ? payApps : 0, myClaimWaiting: iPay && myClaimWaiting, theirClaimWaiting: iAmPaid && theirClaimWaiting });
                    expect(p.filledButtons).toBeLessThanOrEqual(Math.max(1, iPay ? payApps : 0));
                    expect(p.actionFilled && p.main !== null).toBe(false);
                  }
  });
  it("Paid a different amount? goes to Record a payment, amount filled, and comes back to Settle up", () => {
    expect(differentAmountHref("g1", "r1", "a1", "500")).toBe("/groups/g1/pay?from=r1&to=a1&amount=500&back=settle");
  });
});
