import { formatMoney } from "../money";
import { applySettleMin, type Transfer } from "../settle";
import { daysInMonth } from "./month";

// Reminders for flats (Home groups that switched them on). Pure: given today
// and the groups, what to send to whom. The daily job sends them once a day.

export type ReminderGroup = {
  id: string;
  name: string;
  type: string;
  reminders: boolean;
  settleDay: number; // 0 none, 1–28, 31 = last day
  settleMin: number;
  currency: string;
  transfers: Transfer[];
  billsTomorrow: { payerId: string; name: string }[];
  names: Record<string, string>;
};

export type Reminder = { memberIds: string[]; title: string; body: string; url: string; tag: string };

export function isSettleDay(settleDay: number, today: string): boolean {
  if (!settleDay) return false;
  const day = Number(today.slice(8, 10));
  const last = daysInMonth(today.slice(0, 7));
  return settleDay >= 31 ? day === last : day === Math.min(settleDay, last);
}

export function reminderPlan(today: string, groups: ReminderGroup[]): Reminder[] {
  const out: Reminder[] = [];
  const monday = new Date(`${today}T12:00:00Z`).getUTCDay() === 1;
  for (const g of groups) {
    if (g.type !== "home" || !g.reminders) continue;
    const money = (n: number) => formatMoney(n, g.currency);
    const name = (id: string) => g.names[id] ?? "someone";
    const title = `🏠 ${g.name}`;
    const { shown } = applySettleMin(g.transfers, g.settleMin);

    for (const b of g.billsTomorrow) {
      out.push({ memberIds: [b.payerId], title, body: `${b.name} is due tomorrow.`, url: `/groups/${g.id}?tab=bills`, tag: `bill-${g.id}-${b.name}-${today}` });
    }
    if (isSettleDay(g.settleDay, today)) {
      for (const t of shown) {
        out.push({ memberIds: [t.from], title, body: `It’s settle-up day in ${g.name}: pay ${name(t.to)} ${money(t.amount)}.`, url: `/groups/${g.id}/settle`, tag: `settle-${g.id}-${today}-${t.from}-${t.to}` });
        out.push({ memberIds: [t.to], title, body: `It’s settle-up day in ${g.name}: ${name(t.from)} pays you ${money(t.amount)}.`, url: `/groups/${g.id}/settle`, tag: `settle-${g.id}-${today}-${t.from}-${t.to}-in` });
      }
    } else if (monday) {
      const owes = new Map<string, number>();
      for (const t of shown) owes.set(t.from, (owes.get(t.from) ?? 0) + t.amount);
      for (const [id, amount] of owes) {
        if (amount <= g.settleMin) continue;
        out.push({ memberIds: [id], title, body: `You owe ${money(amount)} in ${g.name}. Settle up when you can.`, url: `/groups/${g.id}/settle`, tag: `owe-${g.id}-${today}` });
      }
    }
  }
  return out;
}
