import { db } from "@/lib/db";

// Throwaway fixtures for the expenses-with-a-person tests: accounts, an ordinary group the people share, and a clean-up that removes
// everything those accounts touched (the hidden pair groups too).

export const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const mail = (n: string) => `${n}-${stamp}@example.com`;

export async function mkAccount(tag: string, name: string) {
  return db.account.create({ data: { email: mail(tag), name } });
}

// An ordinary trip group with these accounts all in it (really joined), so they "share an open group".
export async function mkSharedGroup(tag: string, people: { id: string; name: string }[]) {
  const g = await db.group.create({
    data: { name: `Shared ${tag} ${stamp}`, type: "trip", currency: "INR", inviteCode: `sh-${tag}-${stamp}`, members: { create: people.map((p) => ({ name: p.name, accountId: p.id, claimedAt: new Date() })) } },
    include: { members: true },
  });
  return { id: g.id, memberOf: (accountId: string) => g.members.find((m) => m.accountId === accountId)!.id };
}

// An expense written straight into the database (paid by `paidBy`, shares given), for tests that are about screens, not saving.
export async function addExpense(groupId: string, o: { paidBy: string; amount: number; shares: Record<string, number>; currency?: string; kind?: string; createdBy?: string }) {
  const cur = o.currency ?? "INR";
  return db.expense.create({
    data: {
      groupId, description: "Dinner", splitType: "equal", amount: o.amount, originalAmount: o.amount, convertedAmount: o.amount,
      originalCurrency: cur, baseCurrency: cur, paidById: o.paidBy, createdById: o.createdBy ?? o.paidBy, kind: o.kind ?? "expense",
      shares: { create: Object.entries(o.shares).map(([memberId, amount]) => ({ memberId, amount })) },
    },
  });
}

export async function wipe(accountIds: string[], extraGroupIds: string[] = []) {
  const rows = await db.group.findMany({ where: { OR: [{ members: { some: { accountId: { in: accountIds } } } }, { id: { in: extraGroupIds } }] }, select: { id: true } });
  const ids = rows.map((g) => g.id);
  await db.groupEvent.deleteMany({ where: { groupId: { in: ids } } });
  await db.payment.deleteMany({ where: { groupId: { in: ids } } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId: { in: ids } } } });
  await db.expense.deleteMany({ where: { groupId: { in: ids } } });
  await db.invite.deleteMany({ where: { groupId: { in: ids } } });
  await db.member.deleteMany({ where: { groupId: { in: ids } } });
  await db.group.deleteMany({ where: { id: { in: ids } } });
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await db.rateLimit.deleteMany({ where: { OR: accountIds.map((id) => ({ key: { contains: id } })) } });
  await db.accountNote.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
  await db.outbox.deleteMany({ where: { to: { contains: stamp } } });
}
