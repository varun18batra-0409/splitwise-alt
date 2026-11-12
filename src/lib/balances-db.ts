import { Prisma } from "@prisma/client";
import { db } from "./db";
import { netBalances } from "./balances";
import { moneyLines } from "./payers";
import { smartSettle, type Transfer } from "./settle";
import { allocateByWeights } from "./split";

// Balances worked out by the database instead of by loading every expense and share.
//
// The numbers are exactly what netBalances() gives on the full history. Whole sums are added up in SQL
// (integers, so adding in a different order changes nothing):
//   - expenses with ONE payer: the payer goes up by the total, every sharer goes down by their share;
//     money back (a refund) flips both signs;
//   - payments: the payer goes up, the person paid goes down;
//   - deleted expenses and payments never count.
// Expenses with MORE than one payer (`payers` is not empty) are few, so they are fetched and run through
// moneyLines() / payersOf(), the same code the full method uses (it keeps proportions when a saved list
// doesn't add up).
//
// People come in the order of `members` (createdAt, then id): Smart Settle's exact-match step depends on the
// order of the balances. If any money belongs to someone who isn't a member of that group (which should never
// happen), that group is worked out by the current method on its full rows, so the answer is unchanged.
//
// Read-only screens use this. Everything that WRITES (settle actions, pay links, claims) keeps loadGroup's full
// loader and rechecks the plan there.

export type GroupBalances = {
  memberIds: string[]; // in the order of members
  net: Record<string, number>;
  transfers: Transfer[];
  fallback: boolean; // true: worked out by the full method (money belonged to a non-member)
};

type SumRow = { g: string; m: string; v: bigint | number | null };

const CHUNK = 100; // groups per round trip (SQLite limits how many ? marks one query may have)

// `members` (optional): each group's member ids already in createdAt, id order; saves one query.
export async function netBalancesDb(groupIds: string[], opts: { members?: Record<string, string[]> } = {}): Promise<Map<string, GroupBalances>> {
  const ids = [...new Set(groupIds)];
  const out = new Map<string, GroupBalances>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = await netChunk(ids.slice(i, i + CHUNK), opts.members);
    for (const [k, v] of part) out.set(k, v);
  }
  return out;
}

async function netChunk(ids: string[], given?: Record<string, string[]>): Promise<Map<string, GroupBalances>> {
  const list = Prisma.join(ids);
  const haveMembers = Boolean(given) && ids.every((id) => Array.isArray(given![id]));
  const [memberRows, sums, many] = await Promise.all([
    haveMembers ? Promise.resolve(null) : db.member.findMany({ where: { groupId: { in: ids } }, select: { id: true, groupId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    db.$queryRaw<SumRow[]>(Prisma.sql`
      SELECT e."groupId" AS g, e."paidById" AS m, SUM(CASE WHEN e."kind" = 'refund' THEN -e."amount" ELSE e."amount" END) AS v
        FROM "Expense" e
       WHERE e."groupId" IN (${list}) AND e."deletedAt" IS NULL AND e."payers" = ''
       GROUP BY e."groupId", e."paidById"
      UNION ALL
      SELECT e."groupId", s."memberId", SUM(CASE WHEN e."kind" = 'refund' THEN s."amount" ELSE -s."amount" END)
        FROM "ExpenseShare" s JOIN "Expense" e ON e."id" = s."expenseId"
       WHERE e."groupId" IN (${list}) AND e."deletedAt" IS NULL AND e."payers" = ''
       GROUP BY e."groupId", s."memberId"
      UNION ALL
      SELECT p."groupId", p."fromId", SUM(p."amount")
        FROM "Payment" p
       WHERE p."groupId" IN (${list}) AND p."deletedAt" IS NULL
       GROUP BY p."groupId", p."fromId"
      UNION ALL
      SELECT p."groupId", p."toId", -SUM(p."amount")
        FROM "Payment" p
       WHERE p."groupId" IN (${list}) AND p."deletedAt" IS NULL
       GROUP BY p."groupId", p."toId"
    `),
    db.expense.findMany({
      where: { groupId: { in: ids }, deletedAt: null, payers: { not: "" } },
      select: { groupId: true, paidById: true, amount: true, payers: true, kind: true, shares: { select: { memberId: true, amount: true } } },
    }),
  ]);

  const order = new Map<string, string[]>(ids.map((id) => [id, []]));
  if (memberRows) for (const m of memberRows) order.get(m.groupId)?.push(m.id);
  else for (const id of ids) order.set(id, given![id]);

  const sumsBy = new Map<string, SumRow[]>();
  for (const r of sums) (sumsBy.get(r.g) ?? sumsBy.set(r.g, []).get(r.g)!).push(r);
  const manyBy = new Map<string, typeof many>();
  for (const e of many) (manyBy.get(e.groupId) ?? manyBy.set(e.groupId, []).get(e.groupId)!).push(e);

  const out = new Map<string, GroupBalances>();
  const strangers: string[] = [];
  for (const gid of ids) {
    const memberIds = order.get(gid) ?? [];
    const isMember = new Set(memberIds);
    const net: Record<string, number> = Object.fromEntries(memberIds.map((id) => [id, 0]));
    let stranger = false;
    const bump = (who: string, by: number) => {
      if (!isMember.has(who)) stranger = true;
      else net[who] += by;
    };
    for (const r of sumsBy.get(gid) ?? []) bump(r.m, Number(r.v ?? 0));
    for (const e of manyBy.get(gid) ?? []) {
      const { credits, debits } = moneyLines(e);
      for (const c of credits) bump(c.memberId, c.amount);
      for (const d of debits) bump(d.memberId, -d.amount);
    }
    if (stranger) strangers.push(gid);
    else out.set(gid, { memberIds, net, transfers: smartSettle(net), fallback: false });
  }

  // The current method, on the full rows, for any group with money that belongs to a non-member.
  await Promise.all(
    strangers.map(async (gid) => {
      const memberIds = order.get(gid) ?? [];
      const [expenses, payments] = await Promise.all([
        db.expense.findMany({
          where: { groupId: gid, deletedAt: null },
          orderBy: { createdAt: "desc" },
          select: { paidById: true, amount: true, payers: true, kind: true, shares: { select: { memberId: true, amount: true } } },
        }),
        db.payment.findMany({ where: { groupId: gid, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { fromId: true, toId: true, amount: true } }),
      ]);
      const net = netBalances(memberIds, expenses, payments);
      out.set(gid, { memberIds, net, transfers: smartSettle(net), fallback: true });
    }),
  );
  return out;
}

// What the group Settle page shows besides the plan: how many expenses and payments there are, how much has
// been paid back, and how many separate "X owes Y" debts there would be without Smart Settle (the same number
// pairwiseDebtCount gives on the full history). Debts are added per pair, so adding them in groups changes nothing.
export async function settleFactsDb(groupId: string): Promise<{ expenseCount: number; paymentCount: number; paidSoFar: number; before: number }> {
  const [simple, many, pays, expenseCount] = await Promise.all([
    // One payer, not money back: each sharer owes the payer their share.
    db.$queryRaw<{ c: string; d: string; v: bigint | number | null }[]>(Prisma.sql`
      SELECT e."paidById" AS c, s."memberId" AS d, SUM(s."amount") AS v
        FROM "ExpenseShare" s JOIN "Expense" e ON e."id" = s."expenseId"
       WHERE e."groupId" = ${groupId} AND e."deletedAt" IS NULL AND e."payers" = '' AND e."kind" <> 'refund'
       GROUP BY e."paidById", s."memberId"
    `),
    // Several payers, or money back: split between the people on the other side, as pairwiseDebtCount does.
    db.expense.findMany({
      where: { groupId, deletedAt: null, OR: [{ payers: { not: "" } }, { kind: "refund" }] },
      select: { paidById: true, amount: true, payers: true, kind: true, shares: { select: { memberId: true, amount: true } } },
    }),
    db.payment.groupBy({ by: ["fromId", "toId"], where: { groupId, deletedAt: null }, _sum: { amount: true }, _count: { _all: true } }),
    db.expense.count({ where: { groupId, deletedAt: null } }),
  ]);

  const pair = new Map<string, number>(); // key "a|b" with a < b; positive = a owes b
  const add = (debtor: string, creditor: string, amount: number) => {
    if (debtor === creditor) return;
    const [a, b, sign]: [string, string, number] = debtor < creditor ? [debtor, creditor, 1] : [creditor, debtor, -1];
    const key = `${a}|${b}`;
    pair.set(key, (pair.get(key) ?? 0) + sign * amount);
  };
  for (const r of simple) add(r.d, r.c, Number(r.v ?? 0));
  for (const e of many) {
    const { credits, debits } = moneyLines(e);
    for (const d of debits) {
      if (credits.length === 1) add(d.memberId, credits[0].memberId, d.amount);
      else for (const part of allocateByWeights(d.amount, credits.map((c) => ({ memberId: c.memberId, weight: c.amount })))) add(d.memberId, part.memberId, part.amount);
    }
  }
  let paymentCount = 0;
  let paidSoFar = 0;
  for (const p of pays) {
    const amount = p._sum.amount ?? 0;
    paymentCount += p._count._all;
    paidSoFar += amount;
    add(p.toId, p.fromId, amount); // a payment reduces what `from` owes `to`
  }
  return { expenseCount, paymentCount, paidSoFar, before: [...pair.values()].filter((v) => v !== 0).length };
}
