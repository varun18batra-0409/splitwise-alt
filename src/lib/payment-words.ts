// The words on a payment row in the activity lists (Home Latest, a group's Activity, Alerts): what the row says about who paid whom,
// and what it meant for you. A payment someone only SAYS they made (needsOk, not yet confirmed, including older ones with no okAt)
// is a claim: it never says "paid you" or "you received".
export type PaymentStatus = "waiting" | "ok" | undefined;

// The "Not received" question. When the payer and/or the person answering has left, it says plainly that they come back into the group
// until it is sorted (payment-ok.ts does that in the same step). `amount` is already formatted, e.g. "₹400".
export function notReceivedQuestion(o: { amount: string; fromName: string; fromLeft: boolean; iLeft: boolean; groupName: string }): string {
  const base = `Haven’t received ${o.amount} from ${o.fromName}? It comes off the balances (you can undo).`;
  if (o.fromLeft && o.iLeft) return `${base} You and ${o.fromName} both come back into ${o.groupName} until it’s sorted.`;
  if (o.iLeft) return `${base} You’ve left, so you come back into ${o.groupName} until it’s sorted.`;
  if (o.fromLeft) return `${base} ${o.fromName} has left, so ${o.fromName} comes back into ${o.groupName}, owing it, until it’s sorted.`;
  return base;
}

// The message after "Not received" was tapped. `others`: the names of other people put back; `iBack`: the person who tapped was put back too.
export function notReceivedDone(o: { others: string[]; iBack: boolean; groupName: string }): string {
  const plain = "Taken off the balances, and they’ll see you haven’t received it.";
  if (!o.others.length && !o.iBack) return plain;
  if (!o.others.length) return `Taken off the balances. You’re back in ${o.groupName} until it’s sorted.`;
  const names = o.others.length > 1 ? `${o.others.slice(0, -1).join(", ")} and ${o.others[o.others.length - 1]}` : o.others[0];
  if (o.iBack) return `Taken off the balances. You and ${names} are back in ${o.groupName} until it’s sorted, and they’ll see it.`;
  return `Taken off the balances. ${names} ${o.others.length > 1 ? "are" : "is"} back in ${o.groupName} until it’s sorted, and they’ll see it.`;
}

export function paymentTitle(from: string, to: string, status: PaymentStatus, deleted: boolean): string {
  const toWords = to === "You" ? "you" : to;
  return `${from} ${status === "waiting" && !deleted ? "says they paid" : "paid"} ${toWords}`;
}

export function paymentSubline(status: PaymentStatus, to: string, deleted: boolean, deletedNote: string): string {
  if (deleted) return deletedNote;
  if (status === "waiting") return `Waiting for ${to === "You" ? "you" : to} to confirm`;
  return status === "ok" ? "Confirmed ✓" : "Payment";
}

// The label under the amount on the right. `effect` > 0: you paid; < 0: you received; 0: not involved.
export function paymentEffectLabel(status: PaymentStatus, effect: number, deleted: boolean): string {
  if (deleted) return "deleted";
  if (status === "waiting" && effect !== 0) return "to be confirmed";
  return effect > 0 ? "you paid" : effect < 0 ? "you received" : "not involved";
}
