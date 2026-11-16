import { expect } from "vitest";
import { db } from "@/lib/db";
import { netBalances } from "@/lib/balances";
import { parsePayers } from "@/lib/payers";

// Test helper for the money batch: after every step, the books must add up.
//   1. everyone's balance adds up to exactly 0;
//   2. every live expense: the shares add up to the amount (and the payers too, when there are several);
//   3. everyone who has left or been removed is at exactly 0 (except `legacy`: ids of old rows that are known to be out).
// Returns each member's balance (member id -> paise) so a test can also assert the hand-worked numbers.
export async function checkBooks(groupId: string, opts: { legacy?: string[] } = {}): Promise<Record<string, number>> {
  const g = await db.group.findUniqueOrThrow({
    where: { id: groupId },
    include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } },
  });
  for (const e of g.expenses) {
    expect(e.shares.reduce((s, x) => s + x.amount, 0), `the shares of ${e.description} add up to its amount`).toBe(e.amount);
    const payers = parsePayers(e.payers);
    if (payers.length) expect(payers.reduce((s, p) => s + p.amount, 0), `the payers of ${e.description} add up to its amount`).toBe(e.amount);
  }
  const net = netBalances(g.members.map((m) => m.id), g.expenses, g.payments);
  expect(Object.values(net).reduce((a, b) => a + b, 0), "balances add up to 0").toBe(0);
  for (const m of g.members) {
    if ((m.leftAt || m.removedAt) && !(opts.legacy ?? []).includes(m.id)) expect(net[m.id] ?? 0, `${m.name} has left, so is at exactly 0`).toBe(0);
  }
  return net;
}
