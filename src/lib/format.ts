// Small display helpers shared by the server pages and the Add expense screen.

// "1 THB = ₹2.8367" → the "₹2.8367" part.
export function rateText(rate: string, baseCurrency: string): string {
  return baseCurrency === "INR" ? `₹${rate}` : `${baseCurrency} ${rate}`;
}

// "2026-10-14" → "14 Oct 2026"
export function niceDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}
