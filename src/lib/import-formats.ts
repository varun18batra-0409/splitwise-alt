import { decimalsOf, isSupportedCurrency, MAX_MINOR } from "./money";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseSplitwiseCsv, readCsv, type SwParsed, type SwRow } from "./splitwise-csv";

// Bringing a group over from another app's spreadsheet (CSV).
//
// Three kinds of file are understood:
// 1. Splitwise's "Export as spreadsheet": recognised by its columns and read
//    exactly (splitwise-csv.ts).
// 2. A Loopin group spreadsheet (group Settings → Download spreadsheet):
//    recognised by its columns and read exactly.
// 3. Anything else with one row per expense (Tricount, Settle Up, a Google
//    Sheet…): the person says which column is which (date, what it was, amount,
//    who paid, who it was for), with sensible guesses filled in.
// All three end up as the same rows (each person's change in balance), so the
// preview, the balance check and the import itself are shared.

export type ImportFormat = "splitwise" | "loopin" | "generic";

// For other apps' files: which column holds what (0-based), and how it's split.
export type ColumnMap = {
  date: number; // -1 = none (today)
  description: number;
  amount: number;
  paidBy: number;
  // How each row is shared:
  //  "everyone" = equally between everyone in the file
  //  "column"   = equally between the names listed in column `forCol` ("Asha, Ravi")
  //  "shares"   = each person's own column holds their share (`shareCols`)
  split: "everyone" | "column" | "shares";
  forCol?: number;
  shareCols?: number[];
  type?: number; // optional: a column saying "payment"/"settlement" for money paid back
};

export type Detected =
  | { ok: true; format: "splitwise" | "loopin"; label: string }
  | { ok: true; format: "generic"; label: string; headers: string[]; sample: string[][]; guess: ColumnMap; currency: string }
  | { ok: false; error: string };

const lower = (s: string | undefined) => (s ?? "").trim().toLowerCase();

export function detectFormat(text: string): Detected {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: "That file is too big. Export one group at a time." };
  const table = readCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (table.length < 2) return { ok: false, error: "That file has no expenses in it." };
  const head = table[0].map((h) => h.trim());
  const h = head.map(lower);
  if (h[0] === "loopin: all your data") {
    return { ok: false, error: "This is Loopin’s “all my data” download, which holds every group. In the group you want, open Settings → Download spreadsheet, and pick that file." };
  }
  if (["date", "description", "category", "cost", "currency"].every((x, i) => h[i] === x)) return { ok: true, format: "splitwise", label: "Splitwise export" };
  if (h[0] === "date" && h[1] === "type" && h[2] === "description" && h[5] === "paid by" && /^amount \(/.test(h[6] ?? "")) {
    return { ok: true, format: "loopin", label: "Loopin spreadsheet" };
  }
  const guess = guessColumns(head);
  const curCol = h.findIndex((x) => /^currency$|currency code/.test(x));
  let currency = "INR";
  if (curCol >= 0) {
    const counts = new Map<string, number>();
    for (const r of table.slice(1)) {
      const c = (r[curCol] ?? "").trim().toUpperCase();
      if (isSupportedCurrency(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "INR";
  } else {
    const m = /\(([A-Z]{3})\)/.exec(head[guess.amount] ?? "");
    if (m && isSupportedCurrency(m[1])) currency = m[1];
  }
  return { ok: true, format: "generic", label: "spreadsheet from another app", headers: head, sample: table.slice(1, 4), guess, currency };
}

// Best guesses for which column is which, from the column names.
export function guessColumns(head: string[]): ColumnMap {
  const h = head.map(lower);
  const find = (re: RegExp, not: number[] = []) => h.findIndex((x, i) => re.test(x) && !not.includes(i));
  const paidBy = find(/paid ?by|payer|who paid|^paid$|^from$/);
  const date = find(/date|^day$|^when$|time/);
  const amount = find(/amount|cost|price|total|value|^sum$|^spent$/, [paidBy]);
  const description = find(/description|title|item|^what$|expense|details|^name$|^note|purpose|reason/, [paidBy, amount, date]);
  const forCol = find(/split|for whom|between|participants|shared|for$|impacted|involved|members|people/, [paidBy, amount, date, description]);
  const shareCols = h.map((x, i) => (/share|owes?$|owed|portion|part$/.test(x) && ![paidBy, amount, date, description, forCol].includes(i) ? i : -1)).filter((i) => i >= 0);
  const type = find(/^type$|^kind$|category|transaction type/, [paidBy, amount, date, description, forCol, ...shareCols]);
  return {
    date,
    description: description >= 0 ? description : 0,
    amount, // -1 = not found: the person picks it
    paidBy,
    split: shareCols.length >= 2 ? "shares" : forCol >= 0 ? "column" : "everyone",
    forCol: forCol >= 0 ? forCol : undefined,
    shareCols: shareCols.length >= 2 ? shareCols : undefined,
    type: type >= 0 ? type : undefined,
  };
}

// The one entry point: any supported file → the same rows.
export function parseImport(text: string, opts: { map?: ColumnMap; currency?: string } = {}): SwParsed & { format?: ImportFormat } {
  const d = detectFormat(text);
  if (!d.ok) return d;
  if (d.format !== "generic") return d.format === "splitwise" ? { ...parseSplitwiseCsv(text), format: "splitwise" } : { ...parseLoopinCsv(text), format: "loopin" };
  const map = opts.map ?? d.guess;
  return { ...parseGenericCsv(text, map, opts.currency ?? d.currency), format: "generic" };
}

// Money in any common spelling: "1,234.50", "₹ 500", "$12", "-40", "(40)".
export function looseAmount(raw: string, currency: string): number | null {
  let s = (raw ?? "").trim();
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d.,\-]/g, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  // "1.234,50" (comma decimals) → "1234.50"; otherwise commas are thousands.
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d*(\.\d+)?$/.test(s) || s === "" || s === ".") return null;
  const v = Math.round(Number(s) * 10 ** decimalsOf(currency));
  if (!Number.isSafeInteger(v) || v > MAX_MINOR) return null;
  return neg ? -v : v;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// Dates as people write them: 2026-10-18, 18/10/2026, 18-10-26, 18 Oct 2026, Oct 18, 2026.
// Ambiguous numbers (03/04/2026) are read day-first, as in India and most of the world.
export function looseDate(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ok = (y: number, m: number, d: number) => {
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100 ? `${y}-${pad(m)}-${pad(d)}` : "";
  };
  if (iso) return ok(+iso[1], +iso[2], +iso[3]);
  const num = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/.exec(s);
  if (num) {
    const a = +num[1], b = +num[2], y = +num[3];
    return b > 12 ? ok(y, a, b) : ok(y, b, a);
  }
  const words = s.toLowerCase().replace(/,/g, " ").split(/\s+/);
  const mi = words.findIndex((w) => MONTHS.includes(w.slice(0, 3)));
  if (mi >= 0) {
    const nums = words.filter((w) => /^\d+$/.test(w)).map(Number);
    const day = nums.find((n) => n >= 1 && n <= 31);
    const year = nums.find((n) => n > 31) ?? new Date().getUTCFullYear();
    if (day) return ok(year, MONTHS.indexOf(words[mi].slice(0, 3)) + 1, day);
  }
  return "";
}

// Names in one cell: "Asha, Ravi & Zoe", "Asha; Ravi", "Asha and Ravi".
export function splitNames(cell: string): string[] {
  return (cell ?? "")
    .split(/\s*(?:,|;|\/|&|\+|\band\b|\n)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean);
}

function finish(people: string[], rows: SwRow[], skipped: { line: number; reason: string }[], currency: string): SwParsed {
  if (!people.length) return { ok: false, error: "No people were found in this file." };
  if (people.length > 50) return { ok: false, error: "Loopin groups can have up to 50 people." };
  if (!rows.length) return { ok: false, error: skipped.length ? `None of the ${skipped.length} lines could be read (${skipped[0].reason}).` : "There are no expenses in this file." };
  if (!isSupportedCurrency(currency)) return { ok: false, error: `Loopin doesn’t support ${currency} yet.` };
  return { ok: true, people, currency, rows, skipped, otherCurrencies: [], expected: null };
}

// 2. A Loopin group spreadsheet: Date, Type, Description, Notes, Category,
// Paid by, Amount (CUR), …, Status, "<name>'s share (CUR)"…
export function parseLoopinCsv(text: string): SwParsed {
  const table = readCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  const head = table[0].map((h) => h.trim());
  const currency = /\(([A-Z]{3})\)/.exec(head[6] ?? "")?.[1] ?? "INR";
  const shareCols = head.map((x, i) => (/'s share \(/i.test(x) ? i : -1)).filter((i) => i >= 0);
  const people = shareCols.map((i) => head[i].replace(/'s share \([A-Z]{3}\)$/i, "").trim());
  const statusCol = head.findIndex((x) => lower(x) === "status");
  const index = new Map(people.map((p, i) => [p.toLowerCase(), i]));
  const rows: SwRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  table.slice(1).forEach((cells, k) => {
    const line = k + 2;
    if (statusCol >= 0 && lower(cells[statusCol]) === "deleted") return skipped.push({ line, reason: "it was deleted" });
    const type = lower(cells[1]);
    const amount = looseAmount(cells[6] ?? "", currency);
    if (amount === null || amount === 0) return skipped.push({ line, reason: "no amount" });
    const nets = people.map(() => 0);
    if (type === "payment") {
      // "Asha paid Ravi": from the Paid by column, to the other name in the description.
      const from = index.get(lower(cells[5]));
      const rest = (cells[2] ?? "").replace(new RegExp(`^${escapeRe(cells[5] ?? "")}\\s+paid\\s+`, "i"), "").trim().toLowerCase();
      const to = index.get(rest);
      if (from === undefined || to === undefined || from === to) return skipped.push({ line, reason: "the payment’s people couldn’t be matched" });
      nets[from] += Math.abs(amount);
      nets[to] -= Math.abs(amount);
      rows.push({ line, date: looseDate(cells[0] ?? ""), description: cells[2]?.trim().slice(0, 80) || "Payment", category: "Payment", cost: Math.abs(amount), nets, payment: true });
      return;
    }
    // Paid by: "Asha", or several: "Asha 2000.00 + Ravi 1000.00". Amounts are negative for money back.
    const sign = amount < 0 ? -1 : 1;
    const paidCell = (cells[5] ?? "").trim();
    const parts = paidCell.split(/\s\+\s/);
    if (parts.length > 1) {
      for (const part of parts) {
        const m = /^(.*\S)\s+(-?[\d,]+(?:\.\d+)?)$/.exec(part.trim());
        const i = m ? index.get(m[1].toLowerCase()) : undefined;
        const a = m ? looseAmount(m[2], currency) : null;
        if (i === undefined || a === null) return skipped.push({ line, reason: "who paid couldn’t be read" });
        nets[i] += sign * Math.abs(a);
      }
    } else {
      const i = index.get(paidCell.toLowerCase());
      if (i === undefined) return skipped.push({ line, reason: `“${paidCell}” isn’t one of the people` });
      nets[i] += amount;
    }
    for (const [k2, col] of shareCols.entries()) {
      const s = looseAmount(cells[col] ?? "", currency);
      if (s === null) return skipped.push({ line, reason: "a share couldn’t be read" });
      nets[k2] -= s;
    }
    if (nets.reduce((a, b) => a + b, 0) !== 0) return skipped.push({ line, reason: "its shares don’t add up to the amount" });
    rows.push({ line, date: looseDate(cells[0] ?? ""), description: cells[2]?.trim().slice(0, 80) || "Expense", category: cells[4] ?? "", cost: Math.abs(amount), nets, payment: false });
  });
  return finish(people, rows, skipped, currency);
}

// 3. Anything else, with the columns the person picked.
export function parseGenericCsv(text: string, map: ColumnMap, currency: string): SwParsed {
  const table = readCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  const head = table[0].map((h) => h.trim());
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) return { ok: false, error: `That’s more than ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} lines.` };
  const cell = (r: string[], i: number | undefined) => (i === undefined || i < 0 ? "" : (r[i] ?? "").trim());
  if (map.amount < 0) return { ok: false, error: "Pick the column with the amounts." };
  if (map.paidBy < 0) return { ok: false, error: "Pick the column that says who paid." };
  if (map.paidBy === map.amount) return { ok: false, error: "“Paid by” and “Amount” need to be different columns." };
  if (map.split === "column" && (map.forCol === undefined || map.forCol < 0)) return { ok: false, error: "Pick the column that says who each one was for." };
  if (map.split === "shares" && (map.shareCols ?? []).length < 2) return { ok: false, error: "Tick each person’s share column (at least two)." };

  // Everyone in the file: payers, names in the "for" column, or the share columns' names.
  const names: string[] = [];
  const add = (n: string) => {
    const t = n.trim().replace(/\s+/g, " ").slice(0, 40);
    if (t && !names.some((x) => x.toLowerCase() === t.toLowerCase())) names.push(t);
  };
  const shareCols = map.split === "shares" ? (map.shareCols ?? []) : [];
  const shareName = (i: number) => head[i].replace(/['’]s\b|\b(share|owes?|owed|portion|part)\b|\(.*?\)/gi, "").trim() || head[i];
  for (const i of shareCols) add(shareName(i));
  for (const r of body) {
    for (const p of splitNames(cell(r, map.paidBy))) add(p);
    if (map.split === "column") for (const p of splitNames(cell(r, map.forCol))) add(p);
  }
  const index = (n: string) => names.findIndex((x) => x.toLowerCase() === n.trim().toLowerCase());

  const rows: SwRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  body.forEach((r, k) => {
    const line = k + 2;
    const amount = looseAmount(cell(r, map.amount), currency);
    if (amount === null) return skipped.push({ line, reason: "the amount couldn’t be read" });
    if (amount === 0) return skipped.push({ line, reason: "no amount" });
    const payers = splitNames(cell(r, map.paidBy)).map(index).filter((i) => i >= 0);
    if (!payers.length) return skipped.push({ line, reason: "nobody is named as paying" });
    const nets = names.map(() => 0);
    // Paid: shared equally between the payers named (usually one).
    spreadEqually(Math.abs(amount), payers).forEach(([i, a]) => (nets[i] += a));
    // Owed:
    let who: number[] = [];
    if (map.split === "shares") {
      let sum = 0;
      for (const col of shareCols) {
        const s = looseAmount(cell(r, col), currency);
        if (s === null) return skipped.push({ line, reason: "a share couldn’t be read" });
        nets[index(shareName(col))] -= Math.abs(s);
        sum += Math.abs(s);
      }
      if (sum !== Math.abs(amount)) return skipped.push({ line, reason: "its shares don’t add up to the amount" });
    } else {
      who = map.split === "column" ? splitNames(cell(r, map.forCol)).map(index).filter((i) => i >= 0) : names.map((_, i) => i);
      if (!who.length) who = names.map((_, i) => i);
      spreadEqually(Math.abs(amount), who).forEach(([i, a]) => (nets[i] -= a));
    }
    const payment = /payment|settle|transfer|reimburs|paid back/i.test(cell(r, map.type)) && who.length === 1;
    // A negative amount is money back: everything flips.
    const signed = amount < 0 ? nets.map((x) => -x) : nets;
    if (signed.every((x) => x === 0)) return skipped.push({ line, reason: "it didn’t change anyone’s balance" });
    rows.push({
      line,
      date: map.date >= 0 ? looseDate(cell(r, map.date)) : "",
      description: cell(r, map.description).slice(0, 80) || "Expense",
      category: map.type !== undefined ? cell(r, map.type) : "",
      cost: Math.abs(amount),
      nets: signed.map((x) => (x === 0 ? 0 : x)),
      payment,
    });
  });
  return finish(names, rows, skipped, currency);
}

// An amount split as evenly as possible, the odd paise going to the first people.
function spreadEqually(total: number, who: number[]): [number, number][] {
  const each = Math.floor(total / who.length);
  const extra = total - each * who.length;
  return who.map((i, k) => [i, each + (k < extra ? 1 : 0)]);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
