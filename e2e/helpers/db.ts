// The test database (staging, or the throwaway copy on GitHub). Used only to
// read sign-in codes for ".test" addresses and to tidy up test data.
import { db } from "../../src/lib/db";
import { TEST_DOMAIN } from "../env";

export { db };

// The newest sign-in code emailed to a test address since `since`.
// Never printed or returned in an error message.
export async function latestCode(email: string, since: Date, timeoutMs = 20_000): Promise<string> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const row = await db.outbox.findFirst({ where: { to: email, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
    const code = row ? /\b(\d{6})\b/.exec(row.subject)?.[1] : undefined;
    if (code) return code;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No sign-in code arrived for the test user within ${timeoutMs / 1000}s (is the test copy keeping emails for .test addresses?).`);
}

// Removes test people and the groups they made. Only ever touches accounts on
// the test domain, and only groups whose signed-in members are ALL test
// accounts, so a real person's group can never be deleted.
export async function cleanUp(match: { runId?: string } = {}): Promise<{ groups: number; accounts: number }> {
  const prefix = match.runId ? `e2e-${match.runId.toLowerCase()}-` : "e2e-";
  const accounts = await db.account.findMany({
    where: { email: { startsWith: prefix, endsWith: `@${TEST_DOMAIN}` } },
    select: { id: true, email: true },
  });
  if (!accounts.length) return { groups: 0, accounts: 0 };
  const ids = accounts.map((a) => a.id);
  const touched = await db.group.findMany({
    where: { members: { some: { accountId: { in: ids } } } },
    select: { id: true, members: { select: { accountId: true } } },
  });
  const safe = touched.filter((g) => g.members.every((m) => !m.accountId || ids.includes(m.accountId)));
  if (safe.length) await deleteGroups(safe.map((g) => g.id));
  const emails = accounts.map((a) => a.email);
  await db.outbox.deleteMany({ where: { to: { in: emails } } });
  await db.loginCode.deleteMany({ where: { email: { in: emails } } });
  await db.member.updateMany({ where: { accountId: { in: ids } }, data: { accountId: null } }); // any left in a kept group
  await db.passkey.deleteMany({ where: { accountId: { in: ids } } });
  await db.account.deleteMany({ where: { id: { in: ids } } });
  return { groups: safe.length, accounts: accounts.length };
}

// Everything that belongs to these groups, children first (doesn't rely on the
// database cascading deletes for us).
async function deleteGroups(G: string[]) {
  const inG = { groupId: { in: G } };
  await db.$transaction([
    db.expenseShare.deleteMany({ where: { expense: inG } }),
    db.expense.deleteMany({ where: inG }),
    db.payment.deleteMany({ where: inG }),
    db.groupEvent.deleteMany({ where: inG }),
    db.pushSubscription.deleteMany({ where: { member: inG } }),
    db.invite.deleteMany({ where: inG }),
    db.billRun.deleteMany({ where: { bill: inG } }),
    db.bill.deleteMany({ where: inG }),
    db.listItem.deleteMany({ where: inG }),
    db.budget.deleteMany({ where: inG }),
    db.goalEntry.deleteMany({ where: { goal: inG } }),
    db.goal.deleteMany({ where: inG }),
    db.depositShare.deleteMany({ where: { deposit: inG } }),
    db.deposit.deleteMany({ where: inG }),
    db.member.deleteMany({ where: inG }),
    db.group.deleteMany({ where: { id: { in: G } } }),
  ]);
}
