// A payment the person who was paid took off ("Not received", or their own delete) can only be brought back by that same person:
// otherwise the payer, or anyone else in the group, could overrule them and make it count again.
// Pure, so the server (save-expense.ts, undo.ts) and the screens (Undo, "Restore payment") use exactly one rule.
// It reads the payment itself (who deleted it), so it also covers payments refused before this rule existed.

export function onlyReceiverCanBringBack(p: { deletedById?: string | null; toId: string }, viewerId: string | undefined): boolean {
  return Boolean(p.deletedById) && p.deletedById === p.toId && viewerId !== p.toId;
}

export const receiverOnlyText = (receiverName: string) => `Only ${receiverName} can bring this back: they said it wasn’t received.`;

// The history lines written before the flag existed ("hasn’t received ₹… from Ravi, so it’s off the balances").
export const NOT_RECEIVED_TEXT_START = "hasn’t received ";
