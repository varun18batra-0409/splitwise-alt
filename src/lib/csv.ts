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
  kind?: string | null;
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
  // (A plain negative number like -1500.00 is safe and stays a number.)
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" && !/^-\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
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
  // Money back is written as negative amounts, so a column adds up to what was really spent.
  const sign = (e: Expense) => (e.kind === "refund" ? -1 : 1);
  // One payer: their name. Several: each with their part ("You 2000.00 + Asha 1000.00").
  const paidByCell = (e: Expense) => {
    const list = payersOf(e);
    return list.length > 1 ? list.map((p) => `${name(p.memberId)} ${plain(p.amount, cur)}`).join(" + ") : name(list[0].memberId);
  };
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
        dayKey(date, tz), e.kind === "refund" ? "Money back" : "Expense", e.description, e.notes ?? "", getCategory(e.category).label, paidByCell(e), plain(sign(e) * e.amount, cur),
        foreign ? plain(e.originalAmount, e.originalCurrency) : "", foreign ? e.originalCurrency : "", foreign ? e.exchangeRate : "",
        e.markupAmount ? plain(e.markupAmount, cur) : "", e.paymentMethod, e.deletedAt ? "Deleted" : "",
        ...members.map((m) => {
          const s = e.shares.find((x) => x.memberId === m.id);
          return s ? plain(sign(e) * s.amount, cur) : "";
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

// "Download all my data": one spreadsheet with every expense and payment in
// every group I'm in (deleted ones marked), my share and how each changed my
// balance, under a few lines about my account.
export function myDataCsv(
  account: { email: string; name: string; createdAt: Date } | null,
  groups: { name: string; currency: string; type: string; closed: boolean; myId: string; members: Member[]; expenses: Expense[]; payments: Payment[] }[],
  now: Date,
  tz?: string,
): string {
  const top: (string | number)[][] = [
    ["Loopin: all your data"],
    ["Exported", dayKey(now, tz)],
    ...(account ? [["Email", account.email], ["Name", account.name], ["On Loopin since", dayKey(account.createdAt, tz)]] : []),
    ["Groups", groups.length],
    [],
  ];
  const header = [
    "Group", "Group type", "Date", "Type", "Description", "Notes", "Category", "Paid by", "Amount", "Currency",
    "Your share", "Your balance change", "Original amount", "Original currency", "Status",
  ];
  type Row = { group: string; date: Date; cells: (string | number)[] };
  const rows: Row[] = [];
  for (const g of groups) {
    const cur = g.currency;
    const name = (id: string) => (id === g.myId ? "You" : g.members.find((m) => m.id === id)?.name ?? "Someone");
    const status = (d: Date | null) => (d ? "Deleted" : g.closed ? "Group closed" : "");
    for (const e of g.expenses) {
      const sign = e.kind === "refund" ? -1 : 1;
      const list = payersOf(e);
      const mine = e.shares.find((s) => s.memberId === g.myId)?.amount ?? 0;
      const paidMine = list.find((p) => p.memberId === g.myId)?.amount ?? 0;
      const foreign = e.originalCurrency && e.originalCurrency !== cur;
      const date = e.spentAt ?? e.createdAt;
      rows.push({
        group: g.name,
        date,
        cells: [
          g.name, g.type, dayKey(date, tz), e.kind === "refund" ? "Money back" : "Expense", e.description, e.notes ?? "", getCategory(e.category).label,
          list.length > 1 ? list.map((p) => `${name(p.memberId)} ${plain(p.amount, cur)}`).join(" + ") : name(list[0].memberId),
          plain(sign * e.amount, cur), cur, mine ? plain(sign * mine, cur) : "", plain(sign * (paidMine - mine), cur),
          foreign ? plain(e.originalAmount, e.originalCurrency) : "", foreign ? e.originalCurrency : "", status(e.deletedAt),
        ],
      });
    }
    for (const p of g.payments) {
      const change = p.fromId === g.myId ? p.amount : p.toId === g.myId ? -p.amount : 0;
      rows.push({
        group: g.name,
        date: p.createdAt,
        cells: [
          g.name, g.type, dayKey(p.createdAt, tz), "Payment", `${name(p.fromId)} paid ${name(p.toId)}`, "", "", name(p.fromId),
          plain(p.amount, cur), cur, "", change ? plain(change, cur) : "", "", "", status(p.deletedAt),
        ],
      });
    }
  }
  rows.sort((a, b) => a.group.localeCompare(b.group) || a.date.getTime() - b.date.getTime());
  const lines = [...top, header, ...rows.map((r) => r.cells)].map((r) => r.map(cell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
