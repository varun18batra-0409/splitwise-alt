import { cleanPayLink, cleanUpi } from "./collect-rules";
import { decimalsOf } from "./money";

// Pay buttons: "You pay Asha ₹300" → open the payment app with ₹300 already
// filled in. Loopin only makes the link; the money moves in the payment app.

export type PayWays = { upiId: string; payLink: string };
export type PayButton = { kind: "upi" | "paypal" | "venmo" | "cashapp" | "revolut" | "monzo"; label: string; href: string };

const plain = (minor: number, currency: string) => {
  const d = decimalsOf(currency);
  return (minor / 10 ** d).toFixed(d);
};

// Check what someone typed on their You page.
export function cleanPayWays(input: { upiId: string; payLink: string }): { ok: true; ways: PayWays } | { ok: false; error: string } {
  const upiId = cleanUpi(input.upiId);
  if (upiId === null) return { ok: false, error: "That UPI ID doesn’t look right. It looks like name@bank (e.g. asha@okicici)." };
  const payLink = cleanPayLink(input.payLink);
  if (payLink === null) return { ok: false, error: "Use a PayPal.me, Venmo, Cash App, Revolut or Monzo link." };
  return { ok: true, ways: { upiId, payLink } };
}

export function payLinkLabel(link: string): string {
  try {
    const h = new URL(link).hostname.replace(/^www\.|^account\./, "");
    return h === "paypal.me" ? "PayPal" : h === "venmo.com" ? "Venmo" : h === "cash.app" ? "Cash App" : h === "revolut.me" ? "Revolut" : h === "monzo.me" ? "Monzo" : "Pay link";
  } catch {
    return "Pay link";
  }
}

// The buttons for paying `to` this amount. UPI only works in rupees; links
// get the amount added where the service supports it.
export function payButtons(ways: PayWays | null | undefined, opts: { amount: number; currency: string; toName: string; note: string }): PayButton[] {
  if (!ways) return [];
  const out: PayButton[] = [];
  const amt = plain(opts.amount, opts.currency);
  if (ways.upiId && opts.currency === "INR") {
    const q = [`pa=${encodeURIComponent(ways.upiId)}`, `pn=${encodeURIComponent(opts.toName.slice(0, 40))}`, `am=${amt}`, "cu=INR", `tn=${encodeURIComponent(opts.note.slice(0, 40))}`];
    out.push({ kind: "upi", label: "UPI", href: `upi://pay?${q.join("&")}` });
  }
  if (ways.payLink) {
    try {
      const u = new URL(ways.payLink);
      const host = u.hostname.replace(/^www\./, "");
      const segs = u.pathname.split("/").filter(Boolean);
      if (host === "paypal.me" && segs.length >= 1) {
        out.push({ kind: "paypal", label: "PayPal", href: `https://paypal.me/${segs[0]}/${amt}${opts.currency}` });
      } else if (host === "cash.app" && segs.length >= 1 && segs[0].startsWith("$") && (opts.currency === "USD" || opts.currency === "GBP")) {
        out.push({ kind: "cashapp", label: "Cash App", href: `https://cash.app/${segs[0]}/${amt}` });
      } else if ((host === "venmo.com" || host === "account.venmo.com") && opts.currency === "USD") {
        const user = segs[0] === "u" ? segs[1] : segs[0];
        if (user) out.push({ kind: "venmo", label: "Venmo", href: `https://venmo.com/${encodeURIComponent(user)}?txn=pay&amount=${amt}&note=${encodeURIComponent(opts.note.slice(0, 60))}` });
      } else if (host === "monzo.me" && segs.length >= 1 && opts.currency === "GBP") {
        out.push({ kind: "monzo", label: "Monzo", href: `https://monzo.me/${segs[0]}/${amt}` });
      } else {
        const label = payLinkLabel(ways.payLink);
        const kind = label === "Revolut" ? "revolut" : label === "PayPal" ? "paypal" : label === "Venmo" ? "venmo" : label === "Cash App" ? "cashapp" : "monzo";
        out.push({ kind, label, href: ways.payLink });
      }
    } catch {
      /* a bad link is simply not offered */
    }
  }
  return out;
}
