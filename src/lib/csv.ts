import { payersOf } from "./payers";
import { getCategory } from "./categories";
import { decimalsOf } from "./money";
import { dayKey } from "./dates";

// A group's expenses and payments as a spreadsheet (CSV) that opens in Excel
// or Google Sheets. One row per expense or payment, oldest first, with each
// person's share in its own column. Deleted lines are included and marked.

type Member = { id: string; name: string };
type Expense = {
  description: string;
  notes?: string;
  category: string;
  amount: number;
  paidById: string;
  payers?: string | null;
  originalAmount: number;
  originalCurrency: string;
  exchangeRate: string;
  markupAmount: number;
  paymentMethod: string;
  createdAt: Date;
  spentAt: Date | null;
  deletedAt: Date | null;
  shares: { memberId: string; amount: number }[];
};
type Payment = { fromId: string; toId: string; amount: number; createdAt: Date; deletedAt: Date | null };

export function cell(v: string | number): string {
  const s = String(v);
  // Quote anything with commas, quotes or line breaks; stop spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function plain(minor: number, currency: string): string {
  const d = decimalsOf(currency);
  return (minor / 10 ** d).toFixed(d);
}

export function groupCsv(
  group: { name: string; currency: string },
  members: Member[],
  expenses: Expense[],
  payments: Payment[],
  tz?: string,
): string {
  const cur = group.currency;
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "Someone";
  const header = [
    "Date", "Type", "Description", "Notes", "Category", "Paid by", `Amount (${cur})`,
    "Original amount", "Original currency", "Exchange rate", `Card markup (${cur})`, "Paid with", "Status",
    ...members.map((m) => `${m.name}'s share (${cur})`),
  ];
  type Row = { date: Date; cells: (string | number)[] };
  const rows: Row[] = [];
  for (const e of expenses) {
    const foreign = e.originalCurrency && e.originalCurrency !== cur;
    const date = e.spentAt ?? e.createdAt;
    rows.push({
      date,
      cells: [
        dayKey(date, tz), "Expense", e.description, e.notes ?? "", getCategory(e.category).label, payersOf(e).map((p) => name(p.memberId)).join(" + "), plain(e.amount, cur),
        foreign ? plain(e.originalAmount, e.originalCurrency) : "", foreign ? e.originalCurrency : "", foreign ? e.exchangeRate : "",
        e.markupAmount ? plain(e.markupAmount, cur) : "", e.paymentMethod, e.deletedAt ? "Deleted" : "",
        ...members.map((m) => {
          const s = e.shares.find((x) => x.memberId === m.id);
          return s ? plain(s.amount, cur) : "";
        }),
      ],
    });
  }
  for (const p of payments) {
    rows.push({
      date: p.createdAt,
      cells: [
        dayKey(p.createdAt, tz), "Payment", `${name(p.fromId)} paid ${name(p.toId)}`, "", "", name(p.fromId), plain(p.amount, cur),
        "", "", "", "", "", p.deletedAt ? "Deleted" : "", ...members.map(() => ""),
      ],
    });
  }
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  const lines = [header, ...rows.map((r) => r.cells)].map((r) => r.map(cell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n"; // the mark at the start makes Excel read ₹ and names correctly
}

export function csvFileName(groupName: string): string {
  const base = groupName.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "group";
  return `${base}-expenses.csv`;
}
