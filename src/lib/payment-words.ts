// The words on a payment row in the activity lists (Home Latest, a group's Activity, Alerts): what the row says about who paid whom,
// and what it meant for you. A payment someone only SAYS they made (needsOk, not yet confirmed, including older ones with no okAt)
// is a claim: it never says "paid you" or "you received".
export type PaymentStatus = "waiting" | "ok" | undefined;

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
