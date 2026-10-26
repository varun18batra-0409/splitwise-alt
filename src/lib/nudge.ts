import { whatsappLink } from "./whatsapp";
// A friendly WhatsApp reminder: opens WhatsApp with the message ready to send
// (straight to their chat if we have their number). Nothing is sent by the app.
export function nudgeMessage(name: string, amountText: string, groupName: string): string {
  return `Hey ${name}! 👋 Quick one from Loopin: you owe me ${amountText} for “${groupName}”. Settle whenever you can, thanks!`;
}

export function nudgeLink(phone: string, name: string, amountText: string, groupName: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`; // Indian mobile without country code
  return whatsappLink(nudgeMessage(name, amountText, groupName), digits.length >= 11 && digits.length <= 15 ? digits : "");
}
