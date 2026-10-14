// One history list for a group: expenses and settle-up payments, newest first,
// each with what it meant for "me".

type ExpenseRow = {
  id: string;
  description: string;
  category: string;
  amount: number;
  paidById: string;
  createdAt: Date;
  shares: { memberId: string; amount: number }[];
};
type PaymentRow = { id: string; fromId: string; toId: string; amount: number; createdAt: Date };

export type ActivityItem =
  | {
      kind: "expense";
      id: string;
      date: Date;
      title: string;
      category: string;
      amount: number;
      paidById: string;
      people: string[]; // who it was for
      effect: number; // + you're owed this much more, − you owe this much more, 0 not involved
    }
  | { kind: "payment"; id: string; date: Date; fromId: string; toId: string; amount: number; effect: number };

export function buildActivity(expenses: ExpenseRow[], payments: PaymentRow[], myId: string): ActivityItem[] {
  const items: ActivityItem[] = [
    ...expenses.map((e): ActivityItem => {
      const myShare = e.shares.find((s) => s.memberId === myId)?.amount ?? 0;
      return {
        kind: "expense",
        id: e.id,
        date: e.createdAt,
        title: e.description,
        category: e.category,
        amount: e.amount,
        paidById: e.paidById,
        people: e.shares.map((s) => s.memberId),
        effect: (e.paidById === myId ? e.amount : 0) - myShare,
      };
    }),
    ...payments.map(
      (p): ActivityItem => ({
        kind: "payment",
        id: p.id,
        date: p.createdAt,
        fromId: p.fromId,
        toId: p.toId,
        amount: p.amount,
        effect: p.fromId === myId ? p.amount : p.toId === myId ? -p.amount : 0,
      }),
    ),
  ];
  return items.sort((a, b) => b.date.getTime() - a.date.getTime());
}

// "Today", "Yesterday", "Mon 12 Oct", or "12 Oct 2025" for older years.
export function dayLabel(date: Date, now = new Date(), timeZone = "Asia/Kolkata"): string {
  const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone }); // YYYY-MM-DD
  const today = key(now);
  const yesterday = key(new Date(now.getTime() - 86_400_000));
  const k = key(date);
  if (k === today) return "Today";
  if (k === yesterday) return "Yesterday";
  const sameYear = k.slice(0, 4) === today.slice(0, 4);
  return date.toLocaleDateString("en-GB", {
    timeZone,
    weekday: sameYear ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}

// Groups items under day headings, keeping order.
export function byDay<T extends { date: Date }>(items: T[], now = new Date()): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayLabel(item.date, now);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}
