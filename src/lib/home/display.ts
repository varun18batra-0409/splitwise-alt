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

// A collection's money goes to its UPI ID (INR) or pay link, and the organiser may have put someone else's there
// (a treasurer). It is the viewer's own only when it matches what is saved on the viewer's account.
type PayTo = { currency: string; upiId: string; payLink: string };
export function paidToViewer(c: PayTo, mine: { upiId: string; payLink: string } | null): boolean {
  if (!mine) return false;
  const same = (a: string, b: string) => a.trim() !== "" && a.trim().toLowerCase() === b.trim().toLowerCase();
  if (c.currency === "INR" && c.upiId.trim()) return same(c.upiId, mine.upiId);
  if (c.payLink.trim()) return same(c.payLink, mine.payLink);
  return false; // nothing says where the money went, so don't say it came to you
}

// "Meera says they paid you ₹300" only when the viewer is the one paid; otherwise neutral and naming the
// collection: "Meera says they paid ₹300 for Teacher's Day gift". "they" because we don't know anyone's pronoun.
// (Always starts "<name> says they paid": the Activity list matches on that to hide the duplicate.)
export function collectSentence(payer: string, amount: string, title: string, youArePaid: boolean): string {
  return youArePaid ? `${payer} says they paid you ${amount}` : `${payer} says they paid ${amount} for ${title}`;
}

// "Confirm" when you are the one who was paid, "View" for money that went to someone else.
export function paidAction(youArePaid: boolean): "Confirm" | "View" {
  return youArePaid ? "Confirm" : "View";
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
