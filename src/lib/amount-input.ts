import { amountEcho, decimalsOf } from "./money";

// Amount boxes show grouped digits AS YOU TYPE (founder's choice, 16 Nov: 1,23,456.50 for rupees, 123,456.50 for most others).
// This reverses the earlier "plain digits only" rule. What keeps it safe:
//  - the caret is placed by counting digits (not characters), so a comma appearing or going never moves the number under the finger;
//  - deleting a comma also takes the digit next to it, so Backspace never looks stuck;
//  - the value the server receives is the same text, and parseAmount already ignores the commas.
// Everything here is pure (no browser needed), so it is tested directly.

export type Grouping = "lakh" | "thousands";

// Rupees group the Indian way (the same as formatMoney); every other currency in threes.
export const groupingFor = (currency: string): Grouping => (currency === "INR" ? "lakh" : "thousands");

// The most whole-number digits a box takes (the most one expense can be is far smaller; this just keeps one line sane).
export const MAX_INT_DIGITS = 12;

export function groupDigits(digits: string, grouping: Grouping): string {
  if (digits.length <= 3) return digits;
  if (grouping === "thousands") return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const head = digits.slice(0, -3);
  return head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + digits.slice(-3);
}

type Entry = { ch: string; before: boolean }; // a kept character, and whether the caret was after it

// Clean the text, group it, and move the caret by counting digits. `maxFrac` is how many decimals to allow.
function reformat(raw: string, caret: number, grouping: Grouping, maxFrac: number): { value: string; caret: number } {
  const c = Math.max(0, Math.min(caret, raw.length));
  const kept: Entry[] = [];
  let dotAt = -1;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch >= "0" && ch <= "9") kept.push({ ch, before: i < c });
    else if (ch === "." && maxFrac === 0) break; // a currency with no decimals (yen): the point and what follows it are ignored
    else if (ch === "." && dotAt < 0) {
      dotAt = kept.length;
      kept.push({ ch, before: i < c });
    }
    // anything else (commas, spaces, symbols, letters) is dropped
  }
  let int = dotAt < 0 ? kept : kept.slice(0, dotAt);
  let frac = dotAt < 0 ? [] : kept.slice(dotAt + 1);
  const dot = dotAt < 0 ? null : kept[dotAt];
  while (int.length > 1 && int[0].ch === "0") int = int.slice(1); // 007 → 7
  if (int.length === 0 && dot) int = [{ ch: "0", before: dot.before }]; // "." → "0."
  int = int.slice(0, MAX_INT_DIGITS);
  if (Number.isFinite(maxFrac)) frac = frac.slice(0, maxFrac);
  const all = [...int, ...(dot ? [dot] : []), ...frac];
  if (!all.length) return { value: "", caret: 0 };

  const text = groupDigits(int.map((e) => e.ch).join(""), grouping) + (dot ? "." + frac.map((e) => e.ch).join("") : "");
  // The caret goes right after the same number of digits (and the point) as before.
  let want = all.filter((e) => e.before).length;
  if (want === 0) return { value: text, caret: 0 };
  let pos = 0;
  for (; pos < text.length && want > 0; pos++) if (text[pos] !== ",") want--;
  return { value: text, caret: pos };
}

// Typing or deleting: `raw` is the box's text just after the change, `caret` where the cursor is, `prev` the text before.
// The currency sets the grouping and how many decimals are allowed (none for yen).
export function editAmountInput(
  raw: string,
  caret: number,
  currency: string,
  opts: { prev?: string; inputType?: string } = {},
): { value: string; caret: number } {
  const d = decimalsOf(currency);
  const { prev, inputType } = opts;
  let text = raw;
  let c = Math.max(0, Math.min(caret, raw.length));
  if (prev !== undefined) {
    const oneLess = raw.length === prev.length - 1 && raw.slice(0, c) === prev.slice(0, c) && raw.slice(c) === prev.slice(c + 1);
    const oneMore = raw.length === prev.length + 1 && c > 0 && raw.slice(0, c - 1) + raw.slice(c) === prev;
    if (oneLess && prev[c] === ",") {
      // A comma was deleted. Backspace takes the digit before it, Delete the digit after it, so something always goes.
      if (inputType === "deleteContentForward") text = raw.slice(0, c) + raw.slice(c + 1);
      else if (c > 0) {
        text = raw.slice(0, c - 1) + raw.slice(c);
        c -= 1;
      }
    } else if (oneMore && raw[c - 1] === "," && d > 0 && c === raw.length && !prev.includes(".")) {
      // A comma typed after the last digit is a decimal comma ("12,50" on some keyboards).
      text = raw.slice(0, c - 1) + ".";
    }
  }
  // Pasted "12,50" (one comma, one or two digits after it): a decimal comma, exactly as parseAmount reads it.
  const bigChange = prev === undefined || Math.abs(raw.length - prev.length) > 1;
  if (bigChange && d > 0) {
    const t = raw.replace(/[₹$€£¥฿\s]/g, "");
    if (/^\d+,\d{1,2}$/.test(t)) {
      text = t.replace(",", ".");
      c = text.length;
    }
  }
  return reformat(text, c, groupingFor(currency), d);
}

// A value set by the program (a scanned bill, an edit form, a new currency): grouped, with no caret and no cutting of decimals
// (so a value is never silently changed; if it has too many decimals the normal message tells the person).
export function regroupAmount(value: string, currency: string): string {
  const t = value.replace(/[₹$€£¥฿\s]/g, "");
  const v = /^\d+,\d{1,2}$/.test(t) ? t.replace(",", ".") : value;
  return reformat(v, v.length, groupingFor(currency), Infinity).value;
}

// "Read as ₹12.50" line: nothing when the box already shows the amount in its own grouped form.
export function amountEchoFor(value: string, currency: string): string | null {
  return regroupAmount(value, currency) === value ? null : amountEcho(value, currency);
}

// The box's text size steps down with its length, so a very big number always fits on one line and is never cut off.
// "pay" is the big amount on Record a payment; "hero" is the one on Add expense. (Tailwind needs the full class names.)
export function amountSizeClass(text: string, scale: "pay" | "hero"): string {
  const n = text.length;
  if (scale === "pay") {
    return n <= 7 ? "text-[clamp(34px,10vw,40px)]"
      : n <= 9 ? "text-[clamp(28px,8.4vw,34px)]"
      : n <= 11 ? "text-[clamp(24px,7vw,29px)]"
      : n <= 13 ? "text-[clamp(20px,6vw,25px)]"
      : "text-[clamp(16px,4.8vw,20px)]";
  }
  return n <= 6 ? "text-[clamp(52px,17vw,72px)]"
    : n <= 8 ? "text-[clamp(40px,13vw,56px)]"
    : n <= 10 ? "text-[clamp(30px,9.5vw,42px)]"
    : n <= 12 ? "text-[clamp(24px,7.5vw,32px)]"
    : n <= 14 ? "text-[clamp(19px,6vw,26px)]"
    : "text-[clamp(15px,4.8vw,20px)]";
}
