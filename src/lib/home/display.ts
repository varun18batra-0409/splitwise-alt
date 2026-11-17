import { decimalsOf, formatMoney } from "../money";

// Display-only helpers for Home. Nothing here changes a stored value or any other screen's numbers.

// Overview amounts show whole rupees/dollars (₹68,263, not ₹68,263.10; ₹393, not ₹393.34), at every size (founder's choice, 17 Nov).
// Currencies without decimals are already whole. `minor` is in the currency's smallest unit; the exact amount is
// still what is stored, and callers put it in a tooltip / spoken label.
// The whole-unit value an overview shows for an amount (display arithmetic only: ₹393.34 -> 39300).
export function roundedMinor(minor: number, currency = "INR"): number {
  const d = decimalsOf(currency);
  if (d === 0) return minor;
  const unit = 10 ** d;
  return (Math.sign(minor) * Math.round(Math.abs(minor) / unit) * unit) || 0;
}

// The recap's third number, from what the screen shows for the other two: rounded(paid) − rounded(share), so the three agree.
// If that comes out as 0 or the other way round while the real difference is not 0, the exact difference is shown (never a false "even").
export function recapShownDiff(paid: number, share: number, currency = "INR"): number {
  const net = paid - share;
  const diff = roundedMinor(paid, currency) - roundedMinor(share, currency);
  return net !== 0 && Math.sign(diff) !== Math.sign(net) ? net : diff;
}

export function homeMoney(minor: number, currency = "INR"): string {
  const d = decimalsOf(currency);
  if (d === 0) return formatMoney(minor, currency);
  const unit = 10 ** d;
  const whole = roundedMinor(minor, currency); // never "-₹0"
  // The one exception to "round everything": a real amount that would round to nothing (₹0.40) is shown exactly, so it never reads as a misleading ₹0.
  return formatMoney(whole === 0 && minor !== 0 ? minor : whole, currency);
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
