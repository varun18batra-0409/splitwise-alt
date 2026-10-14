// Expense dates are calendar days ("2026-10-14") in Indian time, so an expense
// added late at night never slips onto the wrong day. Stored as noon that day.

export const TIME_ZONE = "Asia/Kolkata";

// "2026-10-14" for a moment, in Indian time.
export function dayKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
}

export function todayKey(now = new Date()): string {
  return dayKey(now);
}

// "2026-10-14" → a Date at noon that day (Indian time). Null if it isn't a
// real date, is before 2000, or is more than a day in the future.
export function parseDay(input: string, now = new Date()): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+05:30`);
  if (Number.isNaN(d.getTime()) || dayKey(d) !== input.trim()) return null; // e.g. 31 Feb
  if (d.getFullYear() < 2000) return null;
  if (d.getTime() > now.getTime() + 36 * 60 * 60 * 1000) return null;
  return d;
}

// When an expense happened: the chosen day, or when it was added.
export function expenseDate(e: { spentAt?: Date | null; createdAt: Date }): Date {
  return e.spentAt ?? e.createdAt;
}
