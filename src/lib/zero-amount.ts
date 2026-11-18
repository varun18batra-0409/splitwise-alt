// Someone typed a zero ("0", "0.00", "₹0", "0,00") where an amount goes. That means "nothing", the same as leaving the box blank:
// it must never become a 0 row, and it isn't an error. parseAmount (money.ts) still refuses 0 as an amount, so this is checked first.
export function typedZero(raw: string): boolean {
  const t = raw.replace(/[₹$€£¥฿\s,]/g, "");
  return /^(0+(\.0*)?|\.0+)$/.test(t);
}
