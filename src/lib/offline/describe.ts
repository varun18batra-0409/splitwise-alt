import { addDays } from "../local-time";
import { niceDate } from "../format";
import { formatMoney, parseAmount } from "../money";
import type { Draft } from "./types";

// Plain words about a waiting expense, from what was typed. This only FORMATS typed values for display ("1200" -> "₹1,200");
// it never splits, converts or adds anything.

export const draftTitle = (d: Pick<Draft, "name">) => d.name.trim() || "Expense";

export function amountText(d: Pick<Draft, "amount" | "currency">): string {
  const minor = parseAmount(d.amount, d.currency);
  return minor === null ? `${d.currency} ${d.amount}` : formatMoney(minor, d.currency);
}

export function whoPaidText(d: Pick<Draft, "paidById" | "memberId" | "multiPay" | "kind">, nameOf: (id: string) => string): string {
  if (d.multiPay) return d.kind === "refund" ? "Several got it" : "Several paid";
  const n = d.paidById === d.memberId ? "You" : nameOf(d.paidById);
  return d.kind === "refund" ? `${n} got it back` : `${n} paid`;
}

export function splitText(d: Pick<Draft, "forMode" | "splitType" | "selected" | "seen">): string {
  if (d.splitType === "exact") return "split by amounts";
  if (d.splitType === "percent") return "split by percent";
  if (d.splitType === "shares") return "split by shares";
  const n = d.forMode === "everyone" ? d.seen.activeMemberIds.length : d.forMode === "one" ? 1 : d.selected.length;
  return n === 1 ? "for one person" : `split ${n} ways`;
}

// "11:05 am", in the group's time zone.
export function timeText(ms: number, tz: string): string {
  try {
    return new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz });
  } catch {
    return new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
  }
}

// The sheet's second line: "You paid · split 6 ways · 11:05 am".
export const sheetLine = (d: Draft, tz: string, nameOf: (id: string) => string) => [whoPaidText(d, nameOf), splitText(d), timeText(d.typedAt, tz)].join(" · ");

// The group page's row: "You paid ₹1,200 · Waiting".
export const rowLine = (d: Draft, nameOf: (id: string) => string) => `${whoPaidText(d, nameOf)} ${amountText(d)} · ${d.status === "refused" ? "Needs a look" : "Waiting"}`;

// "Today", "Yesterday" or "17 Nov 2026", for a saved day, by the phone's own clock (a copy kept on Monday still reads right on Thursday).
export function dayWords(day: string, today: string): string {
  return day === today ? "Today" : day === addDays(today, -1) ? "Yesterday" : niceDate(day);
}
