import { decimalsOf, formatMoney, isSupportedCurrency, MAX_MINOR } from "./money";
import { guessCategory } from "./categories";

// Moving a group over from Splitwise.
//
// Splitwise's "Export as spreadsheet" (CSV) has one row per expense or payment:
//   Date, Description, Category, Cost, Currency, <one column per person>
// where each person's column is how that row changed their balance (positive =
// they paid more than their share). The last row, "Total balance", is where
// everyone ended up.
//
// That's enough to rebuild the group exactly: every expense becomes an expense
// with the same people and the same effect on balances, every payment a
// payment, and the balances are checked against Splitwise's own total.

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2_000_000;

export type SwRow = {
  line: number;
  date: string; // "2026-10-14" or "" if unreadable
  description: string;
  category: string; // Splitwise's own category text
  cost: number; // minor units, always ≥ 0
  nets: number[]; // per person, minor units, adds up to 0
  payment: boolean;
};

export type SwParsed =
  | {
      ok: true;
      people: string[];
      currency: string;
      rows: SwRow[];
      skipped: { line: number; reason: string }[];
      otherCurrencies: string[]; // rows in these were left out
      expected: number[] | null; // Splitwise's "Total balance" row, if present
    }
  | { ok: false; error: string };

// A small, strict CSV reader (quotes, doubled quotes, commas and line breaks inside quotes).
export function readCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// "-12.50" / "1,234.5" → minor units (rounded to the currency's smallest unit). Null if not a number.
export function swAmount(raw: string, currency: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  if (s === "") return 0;
  if (!/^-?\d*(\.\d+)?$/.test(s) || s === "-" || s === ".") return null;
  const v = Math.round(Number(s) * 10 ** decimalsOf(currency));
  if (!Number.isSafeInteger(v) || Math.abs(v) > MAX_MINOR) return null;
  return v === 0 ? 0 : v; // no "-0"
}

const HEADER = ["date", "description", "category", "cost", "currency"];

export function parseSplitwiseCsv(text: string): SwParsed {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: "That file is too big. Export one group at a time." };
  const table = readCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (!table.length) return { ok: false, error: "That file is empty." };
  const head = table[0].map((h) => h.trim());
  if (!HEADER.every((h, i) => head[i]?.toLowerCase() === h) || head.length < 6) {
    return {
      ok: false,
      error: "This doesn’t look like a Splitwise export. In Splitwise, open the group → Settings (gear) → Export as spreadsheet, then pick that file.",
    };
  }
  const people = head.slice(5).map((p) => p.trim());
  if (people.some((p) => !p)) return { ok: false, error: "A person’s column has no name. Check the first row of the file." };
  if (new Set(people.map((p) => p.toLowerCase())).size !== people.length) return { ok: false, error: "Two people have the same name in this file." };
  if (people.length > 50) return { ok: false, error: "Loopin groups can have up to 50 people." };

  // The group's currency: the one used most (Splitwise exports one column of currency per row).
  const body = table.slice(1).map((cells, i) => ({ cells, line: i + 2 }));
  const totals = body.filter((r) => r.cells[1]?.trim().toLowerCase() === "total balance");
  const lines = body.filter((r) => r.cells[1]?.trim().toLowerCase() !== "total balance");
  if (lines.length > MAX_IMPORT_ROWS) return { ok: false, error: `That’s more than ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} lines. Export one group at a time.` };
  const count = new Map<string, number>();
  for (const r of lines) {
    const cur = (r.cells[4] ?? "").trim().toUpperCase();
    if (cur) count.set(cur, (count.get(cur) ?? 0) + 1);
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  const currency = ranked[0]?.[0] ?? (totals[0]?.cells[4] ?? "").trim().toUpperCase();
  if (!currency) return { ok: false, error: "There are no expenses in this file." };
  if (!isSupportedCurrency(currency)) return { ok: false, error: `Loopin doesn’t support ${currency} yet.` };
  const otherCurrencies = ranked.slice(1).map(([c]) => c);

  const rows: SwRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  for (const { cells, line } of lines) {
    const cur = (cells[4] ?? "").trim().toUpperCase();
    if (cur !== currency) {
      skipped.push({ line, reason: `in ${cur || "no currency"}` });
      continue;
    }
    const nets = people.map((_, i) => swAmount(cells[5 + i] ?? "", currency));
    const cost = swAmount(cells[3] ?? "", currency);
    if (nets.some((n) => n === null) || cost === null) {
      skipped.push({ line, reason: "a number couldn’t be read" });
      continue;
    }
    const n = nets as number[];
    if (n.every((x) => x === 0)) {
      skipped.push({ line, reason: "it didn’t change anyone’s balance" });
      continue;
    }
    // Rounding (e.g. yen exported with decimals) can leave a unit over: give it to the biggest line.
    const off = n.reduce((s, x) => s + x, 0);
    if (Math.abs(off) > people.length) {
      skipped.push({ line, reason: "its amounts don’t add up" });
      continue;
    }
    if (off) {
      const big = n.reduce((bi, x, i) => (Math.abs(x) > Math.abs(n[bi]) ? i : bi), 0);
      n[big] -= off;
    }
    const date = /^\d{4}-\d{2}-\d{2}/.exec((cells[0] ?? "").trim())?.[0] ?? "";
    const category = (cells[2] ?? "").trim();
    rows.push({
      line,
      date,
      description: (cells[1] ?? "").trim().slice(0, 80) || "Expense",
      category,
      cost: Math.abs(cost as number),
      nets: n,
      payment: category.toLowerCase() === "payment",
    });
  }

  const totalRow = totals.find((t) => (t.cells[4] ?? "").trim().toUpperCase() === currency);
  let expected: number[] | null = null;
  if (totalRow) {
    const v = people.map((_, i) => swAmount(totalRow.cells[5 + i] ?? "", currency));
    if (v.every((x) => x !== null)) expected = v as number[];
  }
  return { ok: true, people, currency, rows, skipped, otherCurrencies, expected };
}

export type PlannedLine =
  | { type: "payment"; row: SwRow; from: number; to: number; amount: number }
  | { type: "expense"; row: SwRow; amount: number; payers: { i: number; a: number }[]; shares: { i: number; a: number }[] };

// How one Splitwise row becomes a Loopin expense or payment, with exactly the
// same effect on balances. Splitwise only gives each person's net change, so:
// people who came out behind paid nothing and owe exactly that; people who came
// out ahead paid it back plus an equal part of whatever's left of the cost.
// (One payer, the usual case, comes out exactly as it was in Splitwise.)
export function planRow(row: SwRow): PlannedLine {
  const pos = row.nets.map((a, i) => ({ i, a })).filter((x) => x.a > 0);
  const neg = row.nets.map((a, i) => ({ i, a: -a })).filter((x) => x.a > 0);
  if (row.payment && pos.length === 1 && neg.length === 1) return { type: "payment", row, from: pos[0].i, to: neg[0].i, amount: pos[0].a };
  const ahead = pos.reduce((s, x) => s + x.a, 0);
  const rest = row.cost - ahead; // the payers' own shares, together
  if (rest < 0 || !pos.length) return { type: "expense", row, amount: ahead, payers: pos, shares: neg };
  const each = Math.floor(rest / pos.length);
  const extra = rest - each * pos.length;
  const own = pos.map((x, k) => ({ i: x.i, a: each + (k < extra ? 1 : 0) }));
  return {
    type: "expense",
    row,
    amount: row.cost,
    payers: pos.map((x, k) => ({ i: x.i, a: x.a + own[k].a })),
    shares: [...neg, ...own.filter((x) => x.a > 0)].sort((x, y) => x.i - y.i),
  };
}

export function balancesOf(plans: PlannedLine[], people: number): number[] {
  const net = Array(people).fill(0) as number[];
  for (const p of plans) {
    if (p.type === "payment") {
      net[p.from] += p.amount;
      net[p.to] -= p.amount;
    } else {
      for (const x of p.payers) net[x.i] += x.a;
      for (const x of p.shares) net[x.i] -= x.a;
    }
  }
  return net;
}

// Splitwise's categories → Loopin's (falls back to guessing from the name).
const CATEGORY_MAP: [RegExp, string][] = [
  [/groceries/i, "groceries"],
  [/dining|food|liquor|restaurant/i, "food"],
  [/taxi|car|bus|train|plane|flight|fuel|gas\/fuel|parking|bicycle|transport/i, "transport"],
  [/hotel|rent|mortgage|lodging/i, "accommodation"],
  [/electric|water|heat|tv|phone|internet|utilities|trash|cleaning|insurance|bill/i, "bills"],
  [/movies|music|games|sports|entertainment|activities/i, "activities"],
  [/clothing|gifts|household|furniture|electronics|shopping|supplies/i, "shopping"],
];
export function mapCategory(swCategory: string, description: string): string {
  if (!/^(general|other|uncategorized|)$/i.test(swCategory.trim())) {
    for (const [re, id] of CATEGORY_MAP) if (re.test(swCategory)) return id;
  }
  return guessCategory(description);
}

// One-line summary for the preview screen.
export function previewText(p: Extract<SwParsed, { ok: true }>): { expenses: number; payments: number; balances: { name: string; text: string }[] } {
  const plans = p.rows.map(planRow);
  const net = balancesOf(plans, p.people.length);
  return {
    expenses: plans.filter((x) => x.type === "expense").length,
    payments: plans.filter((x) => x.type === "payment").length,
    balances: p.people.map((name, i) => ({
      name,
      text: net[i] === 0 ? "all square" : net[i] > 0 ? `gets back ${formatMoney(net[i], p.currency)}` : `owes ${formatMoney(-net[i], p.currency)}`,
    })),
  };
}
