// "Record a payment" in a group that can't take one: the words for the card shown instead of the form.
// Someone who left (or was removed) comes first, because they can't reopen the group either.
export type PayBlocked = { kind: "left" | "removed" | "closed"; title: string; text: string };

export function payBlocked(g: { name: string; closed: boolean; leaver: { removed: boolean } | null }): PayBlocked | null {
  if (g.leaver) {
    return {
      kind: g.leaver.removed ? "removed" : "left",
      title: g.leaver.removed ? `You were removed from ${g.name}` : `You left ${g.name}`,
      text: "Only people still in the group can record payments here.",
    };
  }
  if (g.closed) {
    return {
      kind: "closed",
      title: `${g.name} is closed`,
      text: "You can’t add payments to a closed group. If something’s still owed, an admin can reopen it from Group settings.",
    };
  }
  return null;
}
