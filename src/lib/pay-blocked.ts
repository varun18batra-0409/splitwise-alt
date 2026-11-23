// "Record a payment" in a group that can't take one: the words for the card shown instead of the form.
// Someone who left (or was removed) comes first, because they can't reopen the group either.
export type PayBlocked = { kind: "left" | "removed" | "closed"; title: string; text: string };

// `mine` (the leaver's own balance, for the page): what to do next. Square: nothing owed either way. Owes one person: pay them outside Loopin and
// ask someone still in the group to record it (a person who left on their own can also rejoin and record it). Anything else keeps the first words.
export type PayBlockedMine = { square: boolean; owes: { name: string; amount: string } | null };

export function payBlocked(g: { name: string; closed: boolean; leaver: { removed: boolean } | null; mine?: PayBlockedMine }): PayBlocked | null {
  if (g.leaver) {
    const owes = g.mine?.owes;
    const text = g.mine?.square
      ? "You’re square in this group. Anyone still in it can record payments between others."
      : owes
        ? `Pay ${owes.name} ${owes.amount} outside Loopin (Settle up has your payment apps), then ask someone still in the group to record the full ${owes.amount}${g.leaver.removed ? "." : ", or rejoin to record it yourself."}`
        : "Only people still in the group can record payments here.";
    return {
      kind: g.leaver.removed ? "removed" : "left",
      title: g.leaver.removed ? `You were removed from ${g.name}` : `You left ${g.name}`,
      text,
    };
  }
  if (g.closed) {
    return {
      kind: "closed",
      title: `${g.name} is closed`,
      text: "You can’t add payments to a closed group. If something’s still owed, reopen the group first.",
    };
  }
  return null;
}
