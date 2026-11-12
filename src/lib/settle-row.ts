// What one payment row on Settle up offers. The same rules everywhere:
//   one FILLED main button  – "Open payment app" (I'm paying and they have one) or "Remind" (I'm owed)
//   one OUTLINED action     – "I've paid" (a claim: counts after Confirm received), or the same words recorded straight away
//                             where the other person can't confirm; "They've paid me" for money owed to me; "Mark paid" for others
//   one quiet text link     – "Paid a different amount?"
// A row with no main button makes its one action the filled one. Never two buttons that look alike.

import { needsOkFor } from "./payment-ok";

export type RowFacts = {
  iPay: boolean; // I'm the one paying
  iAmPaid: boolean; // I'm the one being paid
  closed: boolean;
  iLeft: boolean; // someone who left can't say they paid
  receiverCanConfirm: boolean; // the person paid is on Loopin and can tap Confirm received
  payApps: number; // how many ways to pay I have saved (only the first is a button; the rest are small links)
  myClaimWaiting: boolean; // my "I've paid" is waiting for them
  theirClaimWaiting: boolean; // they say they paid me (answered in the box at the top)
};

export type RowPlan = {
  main: "pay-app" | "remind" | null;
  action: "claim" | "record" | null;
  actionFilled: boolean; // the action is the row's one filled button
  actionLabel: "I’ve paid" | "They’ve paid me" | "Mark paid" | null;
  status: "waiting" | "their-claim" | null;
  differentAmount: boolean; // show "Paid a different amount?"
  filledButtons: number; // how many filled buttons the row shows: never more than one
};

// The facts for one row, worked out from the pair and the viewer: the Settle up page and its tests both use this,
// so a test of the plan proves what the page really offers.
export function settleRowFacts(i: {
  transfer: { from: string; to: string };
  myId: string;
  closed: boolean;
  iLeft: boolean;
  receiver: Parameters<typeof needsOkFor>[0]; // the person paid, as found in the group
  payApps: number;
  myClaimWaiting: boolean;
  theirClaimWaiting: boolean;
}): RowFacts {
  return {
    iPay: i.transfer.from === i.myId,
    iAmPaid: i.transfer.to === i.myId,
    closed: i.closed,
    iLeft: i.iLeft,
    receiverCanConfirm: needsOkFor(i.receiver, i.myId),
    payApps: i.payApps,
    myClaimWaiting: i.myClaimWaiting,
    theirClaimWaiting: i.theirClaimWaiting,
  };
}

export function planSettleRow(f: RowFacts): RowPlan {
  const canRecord = !f.closed && !f.iLeft;
  const claimable = f.iPay && !f.closed && !f.iLeft && f.receiverCanConfirm;
  const main: RowPlan["main"] = f.iPay && f.payApps > 0 ? "pay-app" : f.iAmPaid && !f.closed && !f.theirClaimWaiting ? "remind" : null;
  let action: RowPlan["action"] = null;
  let status: RowPlan["status"] = null;
  if (claimable && f.myClaimWaiting) status = "waiting";
  else if (claimable) action = "claim";
  else if (canRecord && !f.theirClaimWaiting) action = "record";
  else if (f.theirClaimWaiting) status = "their-claim";
  const actionFilled = action !== null && main === null;
  const actionLabel = action === null ? null : f.iPay ? "I’ve paid" : f.iAmPaid ? "They’ve paid me" : "Mark paid";
  return {
    main,
    action,
    actionFilled,
    actionLabel,
    status,
    differentAmount: canRecord && status !== "waiting",
    filledButtons: main === "pay-app" ? 1 : main === "remind" ? 1 : actionFilled ? 1 : 0,
  };
}

// The closing actions under the payment rows: ONE main button, the others quiet links under it.
//   nothing left to pay        -> "Close group" is the one button
//   a trip (it ends)           -> "Settle everything & close"
//   other groups, 2+ payments  -> "Mark all paid (N)" (the group stays open)
//   other groups, 1 payment    -> none: that payment's own button is the main one
export function settleMainAction(i: { type: string; transfers: number; shown: number }): "close" | "mark-all" | null {
  if (i.transfers === 0) return "close";
  if (i.type === "trip") return "close";
  return i.shown > 1 ? "mark-all" : null;
}
