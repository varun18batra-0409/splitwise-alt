// A friendly WhatsApp reminder: opens WhatsApp with the message ready to send
// (straight to their chat if we have their number). Nothing is sent by the app.
export function nudgeMessage(name: string, amountText: string, groupName: string): string {
  return `Hey ${name}! 👋 Quick one from Barabar: you owe me ${amountText} for “${groupName}”. Settle whenever you can, thanks!`;
}

export function nudgeLink(phone: string, name: string, amountText: string, groupName: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`; // Indian mobile without country code
  const text = encodeURIComponent(nudgeMessage(name, amountText, groupName));
  return digits.length >= 11 && digits.length <= 15 ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`;
}
