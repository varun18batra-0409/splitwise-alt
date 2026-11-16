// What one payment row on Settle up offers. The same rules everywhere:
//   one big action on the ticket – "Pay Nupur" (I'm paying: it opens the steps, where "Open payment app" lives) or "Remind Meera" (I'm owed);
//                             cream on the screen's first ticket, an outline pill on the others
//   one quiet text action   – "I've paid" (when I pay) or "Mark paid" (money owed to me, and payments between others). Both record the
//                             payment: it counts straight away and the other person is told.
//   one quiet "More ›"      – "Paid a different amount?"
// Never two cream buttons on one screen.

export type RowFacts = {
  iPay: boolean; // I'm the one paying
  iAmPaid: boolean; // I'm the one being paid
  closed: boolean;
  iLeft: boolean; // someone who left can't say they paid
  payApps: number; // how many ways to pay I have saved (only the first is a button; the rest are small links)
};

export type RowPlan = {
  main: "pay-app" | "remind" | null;
  action: "record" | null;
  actionFilled: boolean; // the action is the row's one filled button
  actionLabel: "I’ve paid" | "Mark paid" | null;
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
  payApps: number;
}): RowFacts {
  return {
    iPay: i.transfer.from === i.myId,
    iAmPaid: i.transfer.to === i.myId,
    closed: i.closed,
    iLeft: i.iLeft,
    payApps: i.payApps,
  };
}

export function planSettleRow(f: RowFacts): RowPlan {
  const canRecord = !f.closed && !f.iLeft;
  const main: RowPlan["main"] = f.iPay && f.payApps > 0 ? "pay-app" : f.iAmPaid && !f.closed ? "remind" : null;
  const action: RowPlan["action"] = canRecord ? "record" : null;
  // Only my own action can be the filled one; "Mark paid" on a payment between two other people stays an outline button, so it never competes with mine.
  const actionFilled = action !== null && main === null && (f.iPay || f.iAmPaid);
  const actionLabel = action === null ? null : f.iPay ? "I’ve paid" : "Mark paid";
  return {
    main,
    action,
    actionFilled,
    actionLabel,
    differentAmount: canRecord,
    filledButtons: main === "pay-app" ? 1 : main === "remind" ? 1 : actionFilled ? 1 : 0,
  };
}

// The closing actions under the payment rows: ONE main button, the others quiet links under it.
//   someone who left            -> none (the server refuses it for them)
//   nothing left to pay         -> "Close group" is the one button
//   a trip that has ended       -> "Settle everything & close" (2+ payments; with one, that payment's own button is the main one)
//   other groups, or a trip still on, 2+ payments -> "mark-all": a quiet "Mark all N paid" under More options (others' payments only; the group stays open)
//   one payment                 -> none: that payment's own button is the main one
export function settleMainAction(i: { type: string; transfers: number; shown: number; left?: boolean; ended?: boolean }): "close" | "mark-all" | null {
  if (i.left) return null;
  if (i.transfers === 0) return "close";
  if (i.type === "trip" && i.ended) return i.shown === 1 ? null : "close";
  return i.shown > 1 ? "mark-all" : null;
}

// Has the trip ended? Its last day (or its first day when there is no end date) is today or earlier, in the viewer's time zone.
// A trip with no dates is treated as not ended. Days are plain "YYYY-MM-DD" strings, so they compare as text.
export function tripEnded(i: { type: string; tripStart: string; tripEnd: string }, today: string): boolean {
  if (i.type !== "trip") return false;
  const last = i.tripEnd || i.tripStart;
  return Boolean(last) && last <= today;
}
