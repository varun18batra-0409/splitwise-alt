import { db } from "./db";
import { CLEARING_MARK } from "./left-view";

// Which of these payments were recorded by "Clear both" (payments across groups that cancel out): their history line carries the clearing mark.
// Used by the spreadsheet downloads, so those payments are typed "Cleared across groups" and not "Payment".
export async function clearingPaymentIds(paymentIds: string[]): Promise<Set<string>> {
  if (!paymentIds.length) return new Set();
  const rows = await db.groupEvent.findMany({
    where: { kind: "payment_recorded", paymentId: { in: paymentIds }, details: { contains: JSON.stringify(CLEARING_MARK) } },
    select: { paymentId: true },
  });
  return new Set(rows.flatMap((r) => (r.paymentId ? [r.paymentId] : [])));
}

// The same payments with `clearing` set where it applies.
export async function withClearing<T extends { id: string }>(payments: T[]): Promise<(T & { clearing: boolean })[]> {
  const ids = await clearingPaymentIds(payments.map((p) => p.id));
  return payments.map((p) => ({ ...p, clearing: ids.has(p.id) }));
}
