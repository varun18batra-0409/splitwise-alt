// Display only: money that belongs to people who have left a flat, so what is shown adds up to the total. Nothing here changes any balance.

type Who = { id: string; name: string; leftAt?: Date | null };

// Deposit shares still held for someone who left: listed read-only under "Left the flat" (they count in the total).
export function leaverDepositRows<S extends { memberId: string; amount: number; status: string }>(shares: S[], members: Who[]): { memberId: string; name: string; amount: number }[] {
  const left = new Map(members.filter((m) => m.leftAt).map((m) => [m.id, m.name]));
  return shares.filter((s) => s.status === "held" && left.has(s.memberId)).map((s) => ({ memberId: s.memberId, name: left.get(s.memberId)!, amount: s.amount }));
}

// Money set aside for a goal by people who left: one extra tile, only when there is some.
export function leaverGoalTotal(entries: { memberId: string; amount: number }[], members: Who[]): number {
  const left = new Set(members.filter((m) => m.leftAt).map((m) => m.id));
  return entries.filter((e) => left.has(e.memberId)).reduce((t, e) => t + e.amount, 0);
}

// "Well done, ..." follows how many people are in the flat now.
export function wellDoneWords(peopleNow: number): string {
  return peopleNow <= 1 ? "Well done, you." : peopleNow === 2 ? "Well done, both of you." : "Well done, all of you.";
}
