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

// All the reads for a set of groups, built but not yet run. Prisma queries only start when awaited, so they can be
// handed to one db.$transaction([...]) and answer from ONE snapshot: the sums and the several-payers rows can't
// come from two different moments (a payment landing between them would otherwise be counted in one and not the other).
type Query<T> = Prisma.PrismaPromise<T>;
type MemberRow = { id: string; groupId: string };
type ManyRow = Awaited<ReturnType<typeof manyQuery>>[number];
const manyQuery = (ids: string[]) =>
  db.expense.findMany({
    where: { groupId: { in: ids }, deletedAt: null, payers: { not: "" } },
    select: { groupId: true, paidById: true, amount: true, payers: true, kind: true, shares: { select: { memberId: true, amount: true } } },
  });

function readChunk(ids: string[], given?: Record<string, string[]>) {
  const list = Prisma.join(ids);
  const haveMembers = Boolean(given) && ids.every((id) => Array.isArray(given![id]));
  const members: Query<MemberRow[]> | null = haveMembers ? null : db.member.findMany({ where: { groupId: { in: ids } }, select: { id: true, groupId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const sums = db.$queryRaw<SumRow[]>(Prisma.sql`
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
    `);
  return { ids, given, members, sums, many: manyQuery(ids) };
}

// The balance reads for these groups (every chunk of 100), and how to turn what they return into the answer.
// `given` (optional): each group's member ids already in createdAt, id order; saves one query.
function balancePlan(groupIds: string[], given?: Record<string, string[]>) {
  const ids = [...new Set(groupIds)];
  const chunks: ReturnType<typeof readChunk>[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(readChunk(ids.slice(i, i + CHUNK), given));
  const queries: Query<unknown>[] = chunks.flatMap((c) => (c.members ? [c.sums, c.many, c.members] : [c.sums, c.many]));
  const finish = async (results: unknown[]): Promise<Map<string, GroupBalances>> => {
    const out = new Map<string, GroupBalances>();
    let k = 0;
    for (const c of chunks) {
      const sums = results[k++] as SumRow[];
      const many = results[k++] as ManyRow[];
      const memberRows = c.members ? (results[k++] as MemberRow[]) : null;
      for (const [id, v] of await balancesFrom(c.ids, c.given, sums, many, memberRows)) out.set(id, v);
    }
    return out;
  };
  return { queries, finish };
}

// `members` (optional): each group's member ids already in createdAt, id order; saves one query.
// All the reads run in one transaction, so every group's numbers come from the same moment.
export async function netBalancesDb(groupIds: string[], opts: { members?: Record<string, string[]> } = {}): Promise<Map<string, GroupBalances>> {
  const plan = balancePlan(groupIds, opts.members);
  if (plan.queries.length === 0) return new Map();
  return plan.finish(await db.$transaction(plan.queries));
}

async function balancesFrom(ids: string[], given: Record<string, string[]> | undefined, sums: SumRow[], many: ManyRow[], memberRows: MemberRow[] | null): Promise<Map<string, GroupBalances>> {
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
export async function settleFactsDb(groupId: string): Promise<SettleFacts> {
  const plan = factsPlan(groupId);
  return plan.finish(await db.$transaction(plan.queries));
}

type SettleFacts = { expenseCount: number; paymentCount: number; paidSoFar: number; before: number };
type SimpleRow = { c: string; d: string; v: bigint | number | null };
type PaidRow = { fromId: string; toId: string; _sum: { amount: number | null }; _count: { _all: number } };
// Several payers, or money back: split between the people on the other side, as pairwiseDebtCount does.
const factsManyQuery = (groupId: string) =>
  db.expense.findMany({
    where: { groupId, deletedAt: null, OR: [{ payers: { not: "" } }, { kind: "refund" }] },
    select: { paidById: true, amount: true, payers: true, kind: true, shares: { select: { memberId: true, amount: true } } },
  });
type FactsMany = Awaited<ReturnType<typeof factsManyQuery>>;

// The four reads, in this order: simple rows, several-payer/refund rows, payments by pair, expense count.
function factsPlan(groupId: string) {
  const queries: Query<unknown>[] = [
    // One payer, not money back: each sharer owes the payer their share.
    db.$queryRaw<SimpleRow[]>(Prisma.sql`
      SELECT e."paidById" AS c, s."memberId" AS d, SUM(s."amount") AS v
        FROM "ExpenseShare" s JOIN "Expense" e ON e."id" = s."expenseId"
       WHERE e."groupId" = ${groupId} AND e."deletedAt" IS NULL AND e."payers" = '' AND e."kind" <> 'refund'
       GROUP BY e."paidById", s."memberId"
    `),
    factsManyQuery(groupId),
    db.payment.groupBy({ by: ["fromId", "toId"], where: { groupId, deletedAt: null }, _sum: { amount: true }, _count: { _all: true } }),
    db.expense.count({ where: { groupId, deletedAt: null } }),
  ];
  return { queries, finish: (r: unknown[]) => factsFrom(r[0] as SimpleRow[], r[1] as FactsMany, r[2] as PaidRow[], r[3] as number) };
}

// What the group Settle page needs, read together: the balances and the facts from one snapshot.
export async function settleDataDb(groupId: string, memberIds: string[]): Promise<{ balances: GroupBalances; facts: SettleFacts }> {
  const bal = balancePlan([groupId], { [groupId]: memberIds });
  const facts = factsPlan(groupId);
  const results = await db.$transaction([...bal.queries, ...facts.queries]);
  return { balances: (await bal.finish(results.slice(0, bal.queries.length))).get(groupId)!, facts: facts.finish(results.slice(bal.queries.length)) };
}

function factsFrom(simple: SimpleRow[], many: FactsMany, pays: PaidRow[], expenseCount: number): SettleFacts {
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
