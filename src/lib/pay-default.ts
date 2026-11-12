// Record a payment, opened with nothing filled in: when you are the one owed, start from the biggest payment
// Smart Settle suggests to you ("Ravi pays you"), so recording it is one tap. When you owe, or are square,
// or the page was opened with details already (from Settle up), nothing is guessed.
export type SuggestedPayment = { from: string; to: string; amount: number };

export function defaultPayment(transfers: SuggestedPayment[], myId: string, myNet: number, canUse: (memberId: string) => boolean = () => true): SuggestedPayment | null {
  if (!(myNet > 0)) return null;
  const toMe = transfers.filter((t) => t.to === myId && t.amount > 0 && canUse(t.from));
  if (!toMe.length) return null;
  return toMe.reduce((best, t) => (t.amount > best.amount ? t : best));
}
