// The words and counts on the payment screens, kept apart from the screens so they can be tested with plain numbers.
// Nothing here moves or changes money: it only says what the screens already know.
import { formatMoney, parseAmount } from "./money";

// The label on Record a payment's button: it follows the amount and who paid ("Record ₹17,618.19 from Meera").
// Nothing typed yet, or a typed amount that would be refused: just "Record payment".
export function recordButtonLabel(amountText: string, currency: string, payer: { name: string; me: boolean } | null): string {
  const minor = parseAmount(amountText, currency);
  if (minor === null || !payer) return "Record payment";
  return `Record ${formatMoney(minor, currency)} from ${payer.me ? "you" : payer.name}`;
}

type Move = { from: string; to: string; amount: number };

// What the "Payment recorded" view says. `payment` is the one just recorded; `left` is the group's payments still suggested afterwards.
// `name` gives a person's own name (never "You"); `me` is the viewer. Money is exact (the group's currency, via `money`).
export function recordedWords(i: { payment: Move; left: Move[]; me: string; name: (id: string) => string; money: (n: number) => string; groupName: string }) {
  const { payment: p, left, me, name, money } = i;
  const pair = left.find((x) => x.from === p.from && x.to === p.to);
  // Paid more than was owed: the payee now owes the payer, and the screen says so instead of "square".
  const back = pair ? undefined : left.find((x) => x.from === p.to && x.to === p.from);
  const payerBusy = left.some((x) => x.from === p.from || x.to === p.from);
  const fromMe = p.from === me;
  const toL = p.to === me ? "you" : name(p.to);
  const owesLine = back
    ? `${p.to === me ? "You" : name(p.to)} now ${p.to === me ? "owe" : "owes"} ${fromMe ? "you" : name(p.from)} ${money(back.amount)}`
    : "";
  const headline = pair
    ? `${money(p.amount)} recorded, ${money(pair.amount)} left`
    : back
      ? `${money(p.amount)} recorded`
      : !payerBusy
      ? fromMe
        ? "You’re all square"
        : `${name(p.from)}’s all square`
      : fromMe
        ? `You and ${toL} are square`
        : `${name(p.from)} and ${toL} are square`;
  const n = left.length;
  const sub = n === 0 ? `Nothing left to pay in ${i.groupName}` : `${n} ${n === 1 ? "payment" : "payments"} left in ${i.groupName}`;
  const stubLine = pair ? `${money(pair.amount)} still to pay` : back ? `${money(back.amount)} owed back` : `is square with ${toL}`;
  return { headline, sub, stubLine, note: owesLine };
}

// The masked way to pay shown on Pay Nupur: "nupur@okicici" becomes "nu•••@okicici"; a pay link shows only its site.
export function maskPayWay(w: { upiId?: string; payLink?: string } | null | undefined): string {
  if (!w) return "";
  if (w.upiId) {
    const [user, host] = w.upiId.split("@");
    return host ? `${user.slice(0, 2)}•••@${host}` : `${user.slice(0, 2)}•••`;
  }
  if (w.payLink) {
    try {
      return new URL(w.payLink).hostname.replace(/^www\./, "");
    } catch {
      return "Saved pay link";
    }
  }
  return "";
}
