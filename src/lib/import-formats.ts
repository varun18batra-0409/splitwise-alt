import { decimalsOf, isSupportedCurrency, MAX_MINOR } from "./money";
import { safeSkipReason, unsupportedCurrencyError } from "./import-errors";
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

// A currency cell as people write it: a code ("INR", "usd"), or a common symbol or short form ("₹", "Rs", "฿", "A$", "RM"…).
//   code set            = a currency we can read
//   code "" and text "" = an empty cell: the row is in the file's own currency
//   code "" and text    = something written that we can't read ("dollars", "baht"): never taken as the file's currency
// "$" is read as the file's own currency when that is a dollar currency, otherwise as US dollars.
const DOLLARS = ["USD", "AUD", "CAD", "SGD", "NZD", "HKD"];
const CURRENCY_WORDS: Record<string, string> = {
  "₹": "INR", RS: "INR", "RS.": "INR", "US$": "USD", "£": "GBP", "€": "EUR", "฿": "THB",
  "A$": "AUD", "S$": "SGD", "C$": "CAD", "HK$": "HKD", RM: "MYR", RP: "IDR",
};
export function currencyCell(raw: string | undefined, main = ""): { code: string; text: string } {
  const text = (raw ?? "").trim();
  const t = text.toUpperCase().replace(/\s+/g, "");
  if (!t) return { code: "", text: "" };
  if (t === "$") return { code: DOLLARS.includes(main) ? main : "USD", text };
  // "¥" is both yen and yuan: it follows the file's own currency when that is one of them, otherwise yen.
  if (t === "¥" || t === "￥") return { code: main === "CNY" ? "CNY" : "JPY", text };
  if (CURRENCY_WORDS[t]) return { code: CURRENCY_WORDS[t], text };
  return /^[A-Z]{3}$/.test(t) ? { code: t, text } : { code: "", text };
}

export function detectFormat(text: string): Detected {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: "That file is too big. Export one group at a time." };
  const table = readCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  if (table.length < 2) return { ok: false, error: "That file has no expenses in it." };
  const head = table[0].map((h) => h.trim());
  const h = head.map(lower);
  if (h[0] === "loopin: all your data") {
    return { ok: false, error: "This is Loopin’s “all my data” download, which holds every group. In the group you want, open Settings → Download spreadsheet, and pick that file." };
  }
  if (["date", "description", "category", "cost", "currency"].every((x, i) => h[i] === x)) return { ok: true, format: "splitwise", label: "Spreadsheet from another app" };
  if (h[0] === "date" && h[1] === "type" && h[2] === "description" && h[5] === "paid by" && /^amount \(/.test(h[6] ?? "")) {
    return { ok: true, format: "loopin", label: "Loopin spreadsheet" };
  }
  const guess = guessColumns(head);
  const curCol = h.findIndex((x) => /^currency$|currency code/.test(x));
  let currency = "INR";
  if (curCol >= 0) {
    const counts = new Map<string, number>();
    let bare = 0; // rows that just say "$": read as the file's own dollar currency when it has one
    for (const r of table.slice(1)) {
      if ((r[curCol] ?? "").trim() === "$") bare++;
      else {
        const c = currencyCell(r[curCol]).code;
        if (isSupportedCurrency(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    if (bare) {
      // "$" rows join a dollar currency written out in the file only when that currency has at least as many rows as the
      // bare "$" rows (an AUD file with a few "$"); one stray "SGD" row never turns fifty "$" rows into Singapore dollars.
      const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
      const d = top && DOLLARS.includes(top[0]) && top[1] >= bare ? top[0] : "USD";
      counts.set(d, (counts.get(d) ?? 0) + bare);
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

// Money in any common spelling: "1,234.50", "₹ 500", "$12", "-40", "(40)", "Rs.500", "Rs. 500/-", "500 Rs.", "INR 1,234.50", "−40".
// One clear number only: a cell with anything else mixed into the digits ("500 x 2", "1e3", "12/03", "1 2"), a thousands grouping that
// doesn't make sense ("1,2,3"), or more decimals than the currency has ("1,234.567", "1.234") is NOT read (null), so the line is skipped
// and listed rather than turned into a different number. Zeros after the point are fine ("500.00" in yen).
// Currency words and signs are taken off the two ends of the cell, as many as are written ("INR Rs 500"), but only ones that mean THIS file's
// currency: "12 USD" in a rupee file, "2 lakh" and "1.5k" are not read (the cell is then not a number, so the line is skipped and listed).
const TOKEN_START = /^\s*([A-Za-z]*[₹$£€¥￥฿]|[A-Za-z]+\.?)\s*/;
const TOKEN_END = /\s*([A-Za-z]*[₹$£€¥￥฿]|[A-Za-z]+\.?)\s*$/;
export function looseAmount(raw: string, currency: string): number | null {
  let s = (raw ?? "").trim();
  if (!s) return 0;
  s = s.replace(/^[\u2212\u2013]/, "-"); // a typographic minus or an en-dash at the start is a minus sign
  s = s.replace(/\/-\s*$/, ""); // "500/-" (the Indian way of writing a whole-rupee amount)
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  // One dot after a word is part of the word, so the "." of "Rs." is never a decimal point ("Rs.500" is 500, not 0.50).
  const mine = (tok: string) => {
    const t = tok.trim();
    return currencyCell(t, currency).code === currency || currencyCell(t.replace(/\.$/, ""), currency).code === currency;
  };
  const edges = (x: string) => {
    for (let m = TOKEN_START.exec(x); m && mine(m[1]); m = TOKEN_START.exec(x)) x = x.slice(m[0].length);
    for (let m = TOKEN_END.exec(x); m && mine(m[1]); m = TOKEN_END.exec(x)) x = x.slice(0, m.index);
    return x.trim();
  };
  s = edges(s);
  const sign = /^[-+\u2212\u2013]/.exec(s)?.[0];
  if (sign) {
    if (sign !== "+") neg = !neg;
    s = edges(s.slice(1));
  }
  if (/^\.\d+$/.test(s)) s = `0${s}`;
  // "1 234,56" / "1 234.50" (a space, or a non-breaking space, between groups of exactly 3) and "1'234.50" (an apostrophe between groups of 3).
  const grouped = /^(\d{1,3}(?:[ \u00a0\u202f'’]\d{3})+)(?:,(\d{1,2})|\.(\d+))?$/.exec(s);
  if (grouped) s = grouped[1].replace(/[ \u00a0\u202f'’]/g, "") + (grouped[2] !== undefined ? `.${grouped[2]}` : grouped[3] !== undefined ? `.${grouped[3]}` : "");
  // "1.234,50" (comma decimals) → "1234.50"; otherwise commas are thousands, in groups of 3 (1,234,567) or the Indian way (12,34,567).
  else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^(\d+|\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})+,\d{3})(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else return null;
  const d = decimalsOf(currency);
  const [whole, frac = ""] = s.split(".");
  // More decimals than the currency has can't be placed without rounding: only zeros past the currency's own decimals ("500.000", "500.00" in yen) are let through.
  if (frac.length > d && !/^0+$/.test(frac.slice(d))) return null;
  const v = Number(whole + frac.slice(0, d).padEnd(d, "0"));
  if (!Number.isSafeInteger(v) || v > MAX_MINOR) return null;
  return v === 0 ? 0 : neg ? -v : v;
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

// One way to compare names, everywhere in an import: composed Unicode, spaces trimmed and collapsed (a non-breaking space counts as a space),
// cut to 40 characters (the longest name a person row keeps), then compared without regard to case.
// `nameText` is the form shown (and stored); `nameKey` is what two names are compared by.
export const nameText = (n: string) => (n ?? "").normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 40).trim();
export const nameKey = (n: string) => nameText(n).toLowerCase();
// The whole name, for telling two different long names apart when their first 40 characters are the same.
const fullKey = (n: string) => (n ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
const UNMATCHED = "a name couldn’t be matched";
const SAME_NAMES = "Two people in this file have names that are the same for the first 40 letters, so Loopin can’t tell them apart. Shorten those names in the other app and export again.";

function finish(people: string[], rows: SwRow[], skipped: { line: number; reason: string }[], currency: string, otherCurrencies: string[] = []): SwParsed {
  if (!people.length) return { ok: false, error: "No people were found in this file." };
  if (people.length > 50) return { ok: false, error: "Loopin groups can have up to 50 people." };
  if (!rows.length) return { ok: false, error: skipped.length ? `None of the ${skipped.length} lines could be read (${safeSkipReason(skipped[0].reason)}).` : "There are no expenses in this file." };
  if (!isSupportedCurrency(currency)) return { ok: false, error: unsupportedCurrencyError(currency) };
  return { ok: true, people, currency, rows, skipped, otherCurrencies, expected: null };
}

// 2. A Loopin group spreadsheet: Date, Type, Description, Notes, Category,
// Paid by, Amount (CUR), …, Status, "<name>'s share (CUR)"…
export function parseLoopinCsv(text: string): SwParsed {
  const table = readCsv(text).filter((r) => r.some((c) => c.trim() !== ""));
  const head = table[0].map((h) => h.trim());
  if (table.length - 1 > MAX_IMPORT_ROWS) return { ok: false, error: `That’s more than ${MAX_IMPORT_ROWS.toLocaleString("en-IN")} lines. Export one group at a time.` };
  const currency = /\(([A-Z]{3})\)/.exec(head[6] ?? "")?.[1] ?? "INR";
  const shareCols = head.map((x, i) => (/'s share \(/i.test(x) ? i : -1)).filter((i) => i >= 0);
  const people = shareCols.map((i) => nameText(head[i].replace(/'s share \([A-Z]{3}\)$/i, "")));
  const statusCol = head.findIndex((x) => lower(x) === "status");
  // Names are matched one way (nameKey) everywhere below; two people whose names are the same by that rule can't be told apart.
  const index = new Map(people.map((p, i) => [nameKey(p), i]));
  if (index.size !== people.length) return { ok: false, error: SAME_NAMES };
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
      const from = index.get(nameKey(cells[5] ?? ""));
      const rest = nameKey((cells[2] ?? "").replace(new RegExp(`^${escapeRe(cells[5] ?? "")}\\s+paid\\s+`, "i"), ""));
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
        const i = m ? index.get(nameKey(m[1])) : undefined;
        const a = m ? looseAmount(m[2], currency) : null;
        if (i === undefined || a === null) return skipped.push({ line, reason: "who paid couldn’t be read" });
        nets[i] += sign * Math.abs(a);
      }
    } else {
      const i = index.get(nameKey(paidCell));
      if (i === undefined) return skipped.push({ line, reason: `“${paidCell}” isn’t one of the people` });
      nets[i] += amount;
    }
    for (const [k2, col] of shareCols.entries()) {
      const s = looseAmount(cells[col] ?? "", currency);
      if (s === null) return skipped.push({ line, reason: "a share couldn’t be read" });
      nets[k2] -= s;
    }
    if (nets.reduce((a, b) => a + b, 0) !== 0) return skipped.push({ line, reason: "its shares don’t add up to the amount" });
    // "Just you": the payer is the only one sharing, so nobody's balance changes. Nothing to bring over.
    if (nets.every((x) => x === 0)) return skipped.push({ line, reason: "it didn’t change anyone’s balance" });
    const kind = type === "money back" ? ("refund" as const) : type === "card game" || type === "game result" ? ("pot" as const) : undefined;
    rows.push({ line, date: looseDate(cells[0] ?? ""), description: cells[2]?.trim().slice(0, 80) || "Expense", category: cells[4] ?? "", cost: Math.abs(amount), nets, payment: false, ...(kind ? { kind } : {}) });
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
  // A column number past the file's own header (a stale choice, or a file that changed) is a message, never a crash.
  const PAST = "One of the columns picked isn’t in this file. Pick the columns again.";
  if (map.amount >= head.length || map.paidBy >= head.length) return { ok: false, error: PAST };
  if (map.split === "column" && map.forCol !== undefined && map.forCol >= head.length) return { ok: false, error: PAST };
  if (map.split === "shares" && (map.shareCols ?? []).some((i) => i >= head.length)) return { ok: false, error: PAST };
  if (map.paidBy === map.amount) return { ok: false, error: "“Paid by” and “Amount” need to be different columns." };
  if (map.split === "column" && (map.forCol === undefined || map.forCol < 0)) return { ok: false, error: "Pick the column that says who each one was for." };
  if (map.split === "shares" && (map.shareCols ?? []).length < 2) return { ok: false, error: "Tick each person’s share column (at least two)." };

  // A currency column (if any): rows in another currency than the group's are left out and listed,
  // never read as if they were in the group's currency (10 USD is not 10 rupees).
  const curCol = head.findIndex((x) => /^currency$|currency code/.test(lower(x)));
  // What a row says its currency is: "" for an empty cell (the file's own); the code if readable; otherwise the text as
  // written, which is never the file's currency (so it is left out and listed, not imported by guessing).
  const rowCurrency = (r: string[]) => {
    if (curCol < 0) return "";
    const c = currencyCell(r[curCol], currency);
    return c.code || c.text;
  };
  const isOther = (r: string[]) => {
    const c = rowCurrency(r);
    return c !== "" && c !== currency;
  };
  const otherCurrencies: string[] = [];
  for (const r of body) {
    const c = rowCurrency(r);
    if (isOther(r) && !otherCurrencies.includes(c)) otherCurrencies.push(c);
  }

  // Everyone in the file: payers, names in the "for" column, or the share columns' names.
  const names: string[] = [];
  const whole = new Map<string, string>(); // nameKey → the whole name, to catch two different long names with the same first 40 characters
  let clash = false;
  const add = (n: string) => {
    const t = nameText(n);
    if (!t) return;
    const k = t.toLowerCase();
    const full = fullKey(n);
    if (whole.has(k) && whole.get(k) !== full) clash = true;
    whole.set(k, whole.get(k) ?? full);
    if (!names.some((x) => nameKey(x) === k)) names.push(t);
  };
  const shareCols = map.split === "shares" ? (map.shareCols ?? []) : [];
  // "Asha's share" → Asha, "Owes Asha" → Asha, "Share (Asha)" → Asha (a name in brackets counts when nothing else names the person).
  const payerKeys = new Set(body.flatMap((r) => splitNames(cell(r, map.paidBy)).map(nameKey)));
  // A 3-letter bracket is a currency ("Asha's share (INR)") unless it is a payer's name or isn't a currency Loopin knows ("Share (ANN)").
  const isCurrencyWord = (x: string) => /^[A-Za-z]{3}$/.test(x) && isSupportedCurrency(x.toUpperCase()) && !payerKeys.has(nameKey(x));
  const shareName = (i: number) => {
    const h = head[i] ?? "";
    const words = (x: string) => x.replace(/['’]s\b|\b(share|owes?|owed|portion|part)\b/gi, "").replace(/\s+/g, " ").trim();
    const outside = words(h.replace(/\(.*?\)/g, ""));
    if (outside) return outside;
    const inside = words(/\(([^)]*)\)/.exec(h)?.[1] ?? "");
    return inside && !isCurrencyWord(inside) ? inside : h;
  };
  for (const i of shareCols) add(shareName(i));
  for (const r of body) {
    if (isOther(r)) continue; // someone who only appears in a left-out row isn't added
    for (const p of splitNames(cell(r, map.paidBy))) add(p);
    if (map.split === "column") for (const p of splitNames(cell(r, map.forCol))) add(p);
  }
  if (clash) return { ok: false, error: SAME_NAMES };
  const index = (n: string) => names.findIndex((x) => nameKey(x) === nameKey(n));

  const rows: SwRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  body.forEach((r, k) => {
    const line = k + 2;
    if (isOther(r)) {
      const c = rowCurrency(r);
      return skipped.push({ line, reason: /^[A-Z]{3}$/.test(c) ? `in ${c}` : `in “${c}”` });
    }
    const amount = looseAmount(cell(r, map.amount), currency);
    if (amount === null) return skipped.push({ line, reason: "the amount couldn’t be read" });
    if (amount === 0) return skipped.push({ line, reason: "no amount" });
    const paidNames = splitNames(cell(r, map.paidBy));
    if (!paidNames.length) return skipped.push({ line, reason: "nobody is named as paying" });
    const payers = paidNames.map(index);
    // A name that can't be matched is never dropped quietly (that would leave the balances not adding up): the line is left out and listed.
    if (payers.some((i) => i < 0)) return skipped.push({ line, reason: UNMATCHED });
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
        const person = index(shareName(col));
        if (person < 0) return skipped.push({ line, reason: UNMATCHED });
        nets[person] -= Math.abs(s);
        sum += Math.abs(s);
      }
      if (sum !== Math.abs(amount)) return skipped.push({ line, reason: "its shares don’t add up to the amount" });
    } else {
      // Everyone, when the "for" cell is empty (or the split is "everyone"); otherwise exactly the people named, and every name must match.
      const listed = map.split === "column" ? splitNames(cell(r, map.forCol)) : [];
      who = listed.length ? listed.map(index) : names.map((_, i) => i);
      if (who.some((i) => i < 0)) return skipped.push({ line, reason: UNMATCHED });
      spreadEqually(Math.abs(amount), who).forEach(([i, a]) => (nets[i] -= a));
    }
    const looksPayment = /payment|settle|transfer|reimburs|paid back/i.test(cell(r, map.type));
    // A payment goes to one person; without a column saying who, it can't be read (never turned into a shared expense).
    if (looksPayment && who.length !== 1) return skipped.push({ line, reason: "it’s a payment, but the file doesn’t say who it went to" });
    const payment = looksPayment && who.length === 1;
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
      // Money back that isn't a payment stays money back: it reduces spending, not adds to it.
      ...(amount < 0 && !payment ? { kind: "refund" as const } : {}),
    });
  });
  return finish(names, rows, skipped, currency, otherCurrencies);
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
