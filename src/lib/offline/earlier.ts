import { db } from "../db";
import { cleanKey, previousResult } from "../once";
import { parseAmount } from "../money";
import { normaliseName } from "../duplicates";
import { OFFLINE_KEY_PREFIX } from "./words";
import type { DuplicateOf } from "../save-expense";

// "Save on this phone" after an online save whose reply was lost keeps the draft as `off-` + K, K being the key that online save used.
// If the server did commit it, the expense is already there. These helpers find it, and say whether it is the SAME expense as the
// draft (same amount, currency and name) or one the person has since changed (then the sheet asks, it never drops the draft).
export const originalKeyOf = (key: string): string | undefined => (key.startsWith(OFFLINE_KEY_PREFIX) ? cleanKey(key.slice(OFFLINE_KEY_PREFIX.length)) : undefined);

export type Earlier = { id: string; groupId: string; description: string; amount: number; originalAmount: number; originalCurrency: string; createdById: string | null; paidById: string; createdAt: Date; spentAt: Date | null };

// `taken`: the original key K has been used by some save. `expense`: what that save made, if it still exists.
export async function earlierSave(key: string): Promise<{ taken: boolean; expense: Earlier | null }> {
  const original = originalKeyOf(key);
  if (!original) return { taken: false, expense: null };
  const id = await previousResult(original);
  if (id === null) return { taken: false, expense: null };
  const expense = id ? await db.expense.findUnique({ where: { id }, select: { id: true, groupId: true, description: true, amount: true, originalAmount: true, originalCurrency: true, createdById: true, paidById: true, createdAt: true, spentAt: true } }) : null;
  return { taken: true, expense };
}

// The same thing as typed? (amount in the typed currency, and the name; "" is saved as "Expense".)
export function sameAsTyped(e: Pick<Earlier, "description" | "originalAmount" | "originalCurrency">, t: { amount: string; currency: string; name: string }): boolean {
  const typed = parseAmount(t.amount, t.currency);
  const name = t.name.trim().replace(/\s+/g, " ").slice(0, 80) || "Expense";
  return typed !== null && typed === e.originalAmount && e.originalCurrency === t.currency && normaliseName(e.description) === normaliseName(name);
}

export async function asDuplicate(e: Earlier): Promise<DuplicateOf> {
  const byId = e.createdById || e.paidById;
  const by = (await db.member.findUnique({ where: { id: byId }, select: { name: true } }))?.name ?? "someone";
  return { id: e.id, description: e.description, amount: e.amount, by, when: (e.spentAt ?? e.createdAt).toISOString(), addedAt: e.createdAt.toISOString(), byId };
}
