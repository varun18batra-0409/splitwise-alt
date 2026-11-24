// A payment the person who was paid took off ("Not received", or their own delete) can only be brought back by that same person:
// otherwise the payer, or anyone else in the group, could overrule them and make it count again.
// Pure, so the server (save-expense.ts, undo.ts) and the screens (Undo, "Restore payment") use exactly one rule.
// It reads the payment itself (who deleted it), so it also covers payments refused before this rule existed.

export function onlyReceiverCanBringBack(p: { deletedById?: string | null; toId: string }, viewerId: string | undefined): boolean {
  return Boolean(p.deletedById) && p.deletedById === p.toId && viewerId !== p.toId;
}

export const receiverOnlyText = (receiverName: string) => `Only ${receiverName} can bring this back: they said it wasn’t received.`;

// A covering payment (a flatmate pays the leaver what someone still settling up owes) that its PAYER took off ("I can’t cover it") can only be
// brought back by that payer, or the leaver (who is back in the flat owing it) could put it straight back on them. The flag is written on the
// payment's "taken off" line (byPayer in its undo data); `undo` is that line's JSON. A later delete by someone else writes a line without it.
export const payerFlagged = (undo: string | null | undefined): boolean => Boolean(undo) && undo!.includes('"byPayer":true');
export function onlyPayerCanBringBack(p: { deletedById?: string | null; fromId: string }, takenOffUndo: string | null | undefined, viewerId: string | undefined): boolean {
  return Boolean(p.deletedById) && p.deletedById === p.fromId && viewerId !== p.fromId && payerFlagged(takenOffUndo);
}
export const payerOnlyText = (payerName: string) => `Only ${payerName} can bring this back: they said they can’t cover it.`;

// The history lines written before the flag existed ("hasn’t received ₹… from Ravi, so it’s off the balances").
export const NOT_RECEIVED_TEXT_START = "hasn’t received ";
