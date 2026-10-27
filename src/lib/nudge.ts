import { whatsappLink } from "./whatsapp";
import { payLinkLabel, type PayWays } from "./pay-links";
// A friendly WhatsApp reminder: opens WhatsApp with the message ready to send
// (straight to their chat if we have their number). Nothing is sent by the app.
// With the asker's UPI ID / pay link and a link to settle, it's a payment request.
export function nudgeMessage(name: string, amountText: string, groupName: string, extra?: { ways?: PayWays | null; link?: string }): string {
  const lines = [`Hey ${name}! 👋 Quick one from Loopin: you owe me ${amountText} for “${groupName}”. Settle whenever you can, thanks!`];
  if (extra?.ways?.upiId) lines.push(`UPI: ${extra.ways.upiId}`);
  if (extra?.ways?.payLink) lines.push(`${payLinkLabel(extra.ways.payLink)}: ${extra.ways.payLink}`);
  if (extra?.link) lines.push(`Paid? Tap “I’ve paid” here, no sign-in needed:\n${extra.link}`);
  return lines.join("\n");
}

export function nudgeLink(phone: string, name: string, amountText: string, groupName: string, extra?: { ways?: PayWays | null; link?: string }): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`; // Indian mobile without country code
  return whatsappLink(nudgeMessage(name, amountText, groupName, extra), digits.length >= 11 && digits.length <= 15 ? digits : "");
}
