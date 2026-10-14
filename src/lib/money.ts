// All money in this app is whole paise (₹12.50 = 1250). Never decimals.

const MAX_PAISE = 1_000_000_000_00; // ₹1,000 crore — far more than anyone needs

// "1,250.5" / "₹ 99" / "12.50" → paise. Returns null if it isn't a valid amount.
export function parseAmount(input: string): number | null {
  const s = input.replace(/[₹,\s]/g, "");
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === "" && !m[2])) return null;
  const rupees = m[1] === "" ? 0 : Number(m[1]);
  const paise = Number((m[2] ?? "").padEnd(2, "0"));
  const total = rupees * 100 + paise;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_PAISE) return null;
  return total;
}

// "33.33" → 3333 "basis points" (hundredths of a percent). 100% = 10000.
export function parsePercent(input: string): number | null {
  const s = input.replace(/[%\s]/g, "");
  if (s === "") return 0;
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === "" && !m[2])) return null;
  const bp = Number(m[1] || "0") * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bp > 10000 ? null : bp;
}

export function formatMoney(paise: number, currency = "INR"): string {
  const whole = paise % 100 === 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

export function formatPercent(bp: number): string {
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;
}
