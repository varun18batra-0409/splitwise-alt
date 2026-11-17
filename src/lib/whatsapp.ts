// WhatsApp with a message typed in (straight to one chat when we have their
// number). Always api.whatsapp.com/send: the short wa.me address redirects
// there and garbles emoji on the way ("🌴" arrived as "�").
export function whatsappLink(text: string, phoneDigits = ""): string {
  return `https://api.whatsapp.com/send?${phoneDigits ? `phone=${phoneDigits}&` : ""}text=${encodeURIComponent(text)}`;
}

// A phone number as WhatsApp wants it: digits only, with the country code, or "" when we can't tell (then WhatsApp opens with no chat picked).
// "+" or "00" in front means the number already has its country code (8 to 15 digits). Without one, only in rupee groups (`india`) do we
// guess India: drop a leading 0 from 11 digits, add 91 to 10 digits, keep 11 to 15 digits as they are.
export function waPhone(raw: string, india = true): string {
  const t = raw.trim();
  const digits = t.replace(/\D/g, "");
  if (t.startsWith("+") || digits.startsWith("00")) {
    const d = t.startsWith("+") ? digits : digits.slice(2);
    return d.length >= 8 && d.length <= 15 ? d : "";
  }
  if (!india) return "";
  let d = digits;
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : "";
}
