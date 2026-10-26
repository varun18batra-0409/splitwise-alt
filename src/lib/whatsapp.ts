// WhatsApp with a message typed in (straight to one chat when we have their
// number). Always api.whatsapp.com/send: the short wa.me address redirects
// there and garbles emoji on the way ("🌴" arrived as "�").
export function whatsappLink(text: string, phoneDigits = ""): string {
  return `https://api.whatsapp.com/send?${phoneDigits ? `phone=${phoneDigits}&` : ""}text=${encodeURIComponent(text)}`;
}
