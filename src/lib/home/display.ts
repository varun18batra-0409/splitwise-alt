import { decimalsOf, formatMoney } from "../money";

// Display-only helpers for Home. Nothing here changes a stored value or any other screen's numbers.

// Big amounts on Home show whole rupees/dollars (₹68,263, not ₹68,263.10). Under 1,000 whole units, and in currencies
// without decimals, the exact amount is shown. `minor` is in the currency's smallest unit; the exact amount is
// still what is stored, and callers put it in a tooltip / spoken label.
export function homeMoney(minor: number, currency = "INR"): string {
  const d = decimalsOf(currency);
  if (d === 0) return formatMoney(minor, currency);
  const unit = 10 ** d;
  if (Math.abs(minor) < 1000 * unit) return formatMoney(minor, currency);
  const whole = Math.sign(minor) * Math.round(Math.abs(minor) / unit) * unit;
  return formatMoney(whole, currency);
}

// "Meera says they paid you ₹300" / "Meera says they paid Asha ₹300": always says who was paid.
// `payee` is null when the person looking is the one paid. "they" because we don't know anyone's pronoun.
export function paidSentence(payer: string, payee: string | null, amount: string): string {
  return `${payer} says they paid ${payee ?? "you"} ${amount}`;
}

// One action word for the same action: "Confirm" when you are the one who was paid, "View" for someone else's claim.
export function paidAction(youArePaid: boolean): "Confirm" | "View" {
  return youArePaid ? "Confirm" : "View";
}

// Home's Needs-you line for a "says they paid" item: the person looking is always the one paid there, so
// "Zoya says they paid ₹200" (a collection) reads "Zoya says they paid you ₹200". Other lines are unchanged.
export function needText(kind: "claim" | "payment" | "bill" | "collect", text: string): string {
  if (kind === "bill") return text;
  return text.replace(/ says they paid (?!you\b)/, " says they paid you ");
}

// A story's label under its circle: one line, the same on every phone. Longer than `max` characters is cut with an
// ellipsis (the full name stays in the button's title and spoken label).
export const STORY_LABEL_MAX = 10;
export function storyShort(label: string, max = STORY_LABEL_MAX): string {
  const t = label.trim();
  const chars = [...t];
  if (chars.length <= max) return t;
  return `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}
