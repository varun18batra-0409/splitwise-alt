import { Prisma } from "@prisma/client";
import { db } from "./db";
import { explainAll, type ExpenseLike, type WhySummary } from "./explain";
import { moneyLines } from "./payers";

// What the Balances tab needs, worked out by the database instead of by loading every expense and every share.
//
// ONE statement (one moment in time, like balances-db.ts) returns, for one group:
//   - the balance sums (the same four branches netBalancesDb reads);
//   - the "Why?" totals for expenses with ONE payer: what each person paid, their share, the card fee inside it and how many
//     lines they have, with money back counted negative (exactly explainAll's rules; the fee rounds half up, which is what
//     Math.round does for the positive numbers it sees: (2*markup*share + amount) / (2*amount) in whole numbers);
//   - payments sent and received, and how many lines they make;
//   - what was spent, how many expenses there are, whether any has a card fee, and the biggest amount;
//   - the rows (with their shares) of expenses with several payers, and of every expense in another currency.
// The several-payers rows go through moneyLines() / explainAll(), the same code the full method uses, and are added on top.
//
// Nothing here is kept between requests: every open of the tab reads the database again.
//
// Safety nets: anything odd makes this return null, and the caller uses the full method (today's code) instead, with a warning in the log:
//   - money held by someone who isn't a member of the group;
//   - a person listed twice in one expense (the full method reads only the first entry for "Why?");
//   - a person's "Why?" total that doesn't equal their balance;
//   - an amount so big that the whole-number fee maths could differ from JavaScript's.

type Num = bigint | number | null;
type Row = { k: string; m: string | null; a: Num; b: Num; c: Num; d: Num; x: string | null; p: string | null; q: string | null; r: string | null; t: string | null };

export type ForeignExpense = {
  id: string;
  amount: number;
  originalAmount: number;
  originalCurrency: string;
  paidById: string;
  payers: string;
  kind: string;
  shares: { memberId: string; amount: number }[];
};

export type BalancesStatement = {
  net: Record<string, number>; // in the order of the members (Smart Settle depends on that order)
  why: Record<string, WhySummary>;
  spent: number; // group currency, incl. card fees; money back takes away, card-game results count 0
  count: number; // expenses that count (not deleted)
  hasMarkup: boolean;
  foreign: ForeignExpense[]; // every counted expense paid in another currency, with its shares
};

// The biggest amount (in paise) the whole-number fee maths is used for. Above it the full method is used.
export const MAX_SUMMARY_AMOUNT = 100_000_000;

// The one statement, built but not yet run (a Prisma query only starts when awaited, so the caller can run it beside other reads).
export function readBalancesRows(groupId: string): Prisma.PrismaPromise<Row[]> {
  return db.$queryRaw<Row[]>(Prisma.sql`
    WITH ep AS (
      SELECT e."id" AS xid, e."paidById" AS m, e."amount" AS paid, 0 AS share, 0 AS n, e."kind" AS kind, e."amount" AS total, e."markupAmount" AS mk
        FROM "Expense" e
       WHERE e."groupId" = ${groupId} AND e."deletedAt" IS NULL AND e."payers" = ''
      UNION ALL
      SELECT e."id", s."memberId", 0, s."amount", 1, e."kind", e."amount", e."markupAmount"
        FROM "ExpenseShare" s JOIN "Expense" e ON e."id" = s."expenseId"
       WHERE e."groupId" = ${groupId} AND e."deletedAt" IS NULL AND e."payers" = ''
    ), pe AS (
      SELECT xid, m, SUM(paid) AS paid, SUM(share) AS share, SUM(n) AS n, MAX(kind) AS kind, MAX(total) AS total, MAX(mk) AS mk
        FROM ep GROUP BY xid, m
    )
    SELECT 'S' AS k, e."paidById" AS m, SUM(CASE WHEN e."kind" = 'refund' THEN -e."amount" ELSE e."amount" END) AS a, NULL AS b, NULL AS c, NULL AS d, NULL AS x, NULL AS p, NULL AS q, NULL AS r, NULL AS t
      FROM "Expense" e
     WHERE e."groupId" = ${groupId} AND e."deletedAt" IS NULL AND e."payers" = ''
     GROUP BY e."paidById"
    UNION ALL
    SELECT 'S', s."memberId", SUM(CASE WHEN e."kind" = 'refund' THEN s."amount" ELSE -s."amount" END), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM "ExpenseShare" s JOIN "Expense" e ON e."id" = s."expenseId"
     WHERE e."groupId" = ${groupId} AND e."deletedAt" IS NULL AND e."payers" = ''
     GROUP BY s."memberId"
    UNION ALL
    SELECT 'S', p."fromId", SUM(p."amount"), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM "Payment" p
     WHERE p."groupId" = ${groupId} AND p."deletedAt" IS NULL
     GROUP BY p."fromId"
    UNION ALL
    SELECT 'S', p."toId", -SUM(p."amount"), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM "Payment" p
     WHERE p."groupId" = ${groupId} AND p."deletedAt" IS NULL
     GROUP BY p."toId"
    UNION ALL
    SELECT 'W', m,
           SUM(CASE WHEN kind = 'refund' THEN -paid ELSE paid END),
           SUM(CASE WHEN kind = 'refund' THEN -share ELSE share END),
           SUM(CASE WHEN kind = 'refund' THEN -1 ELSE 1 END * (CASE WHEN mk > 0 AND share > 0 AND total > 0 THEN (2 * mk * share + total) / (2 * total) ELSE 0 END)),
           COUNT(*), NULL, NULL, NULL, NULL, NULL
      FROM pe
     WHERE paid <> 0 OR share <> 0
     GROUP BY m
    UNION ALL
    SELECT 'Ps', p."fromId", SUM(p."amount"), COUNT(*), NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM "Payment" p
     WHERE p."groupId" = ${groupId} AND p."deletedAt" IS NULL
     GROUP BY p."fromId"
    UNION ALL
    SELECT 'Pr', p."toId", SUM(p."amount"), COUNT(*), NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM "Payment" p
     WHERE p."groupId" = ${groupId} AND p."deletedAt" IS NULL AND p."toId" <> p."fromId"
     GROUP BY p."toId"
    UNION ALL
    SELECT 'T', NULL,
           SUM(CASE WHEN e."kind" = 'pot' THEN 0 WHEN e."kind" = 'refund' THEN -e."amount" ELSE e."amount" END),
           COUNT(*), MAX(CASE WHEN e."markupAmount" > 0 THEN 1 ELSE 0 END), MAX(e."amount"), NULL, NULL, NULL, NULL, NULL
      FROM "Expense" e
     WHERE e."groupId" = ${groupId} AND e."deletedAt" IS NULL
    UNION ALL
    SELECT 'D', NULL, COUNT(*), NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
      FROM pe
     WHERE n > 1
    UNION ALL
    SELECT 'X', s."memberId", s."amount", e."amount", e."markupAmount", e."originalAmount", e."id", e."payers", e."paidById", e."originalCurrency", e."kind"
      FROM "Expense" e LEFT JOIN "ExpenseShare" s ON s."expenseId" = e."id"
     WHERE e."groupId" = ${groupId} AND e."deletedAt" IS NULL
       AND (e."payers" <> '' OR e."originalCurrency" <> (SELECT g."currency" FROM "Group" g WHERE g."id" = ${groupId}))
  `);
}

const n = (v: Num) => Number(v ?? 0);

// The rows of the statement, turned into the answer; null when the full method must be used (the reason is logged).
// `memberIds`: the group's people in createdAt, id order.
export function finishBalances(groupId: string, rows: Row[], memberIds: string[], groupCurrency: string): BalancesStatement | null {
  const isMember = new Set(memberIds);
  const net: Record<string, number> = Object.fromEntries(memberIds.map((id) => [id, 0]));
  const why: Record<string, WhySummary> = Object.fromEntries(memberIds.map((id) => [id, { paidTotal: 0, shareTotal: 0, feeTotal: 0, sent: 0, received: 0, balance: 0, count: 0 }]));
  let stranger = false;
  const bump = (who: string | null, by: number) => {
    if (who === null || !isMember.has(who)) stranger = true;
    else net[who] += by;
  };
  let spent = 0, count = 0, hasMarkup = false, biggest = 0, twice = 0;
  const xs = new Map<string, ForeignExpense & { markupAmount: number }>();

  for (const r of rows) {
    if (r.k === "S") bump(r.m, n(r.a));
    else if (r.k === "W") {
      const w = r.m !== null ? why[r.m] : undefined;
      if (!w) stranger = true;
      else {
        w.paidTotal += n(r.a);
        w.shareTotal += n(r.b);
        w.feeTotal += n(r.c);
        w.count += n(r.d);
      }
    } else if (r.k === "Ps" || r.k === "Pr") {
      const w = r.m !== null ? why[r.m] : undefined;
      if (!w) stranger = true;
      else {
        if (r.k === "Ps") w.sent += n(r.a);
        else w.received += n(r.a);
        w.count += n(r.b);
      }
    } else if (r.k === "T") {
      spent = n(r.a);
      count = n(r.b);
      hasMarkup = n(r.c) === 1;
      biggest = n(r.d);
    } else if (r.k === "D") twice = n(r.a);
    else if (r.k === "X" && r.x) {
      let e = xs.get(r.x);
      if (!e) xs.set(r.x, (e = { id: r.x, amount: n(r.b), markupAmount: n(r.c), originalAmount: n(r.d), payers: r.p ?? "", paidById: r.q ?? "", originalCurrency: r.r ?? "", kind: r.t ?? "expense", shares: [] }));
      if (r.m !== null) e.shares.push({ memberId: r.m, amount: n(r.a) });
    }
  }

  // Expenses with several payers: the same code as the full method, added on top.
  const several = [...xs.values()].filter((e) => e.payers !== "");
  for (const e of several) {
    const { credits, debits } = moneyLines(e);
    for (const c of credits) bump(c.memberId, c.amount);
    for (const d of debits) bump(d.memberId, -d.amount);
  }
  const extra = explainAll(
    memberIds,
    several.map((e) => ({ ...e, description: "", category: "", createdAt: new Date(0) }) satisfies ExpenseLike),
    [],
  );
  for (const id of memberIds) {
    why[id].paidTotal += extra[id].paidTotal;
    why[id].shareTotal += extra[id].shareTotal;
    why[id].feeTotal += extra[id].feeTotal;
    why[id].count += extra[id].count;
    why[id].balance = why[id].paidTotal - why[id].shareTotal + why[id].sent - why[id].received;
  }

  const fallback = (why_: string) => {
    console.warn(`LOOPIN balances summary: group ${groupId} uses the full method (${why_})`);
    return null;
  };
  if (stranger) return fallback("money belongs to someone who is not a member");
  if (twice > 0) return fallback("a person is listed twice in one expense");
  if (biggest > MAX_SUMMARY_AMOUNT) return fallback("an amount is too big for the whole-number fee maths");
  const off = memberIds.find((id) => why[id].balance !== net[id]);
  if (off) return fallback("a Why? total does not equal the balance");

  return {
    net,
    why,
    spent,
    count,
    hasMarkup,
    foreign: [...xs.values()].filter((e) => e.originalCurrency !== groupCurrency).map((e) => ({ id: e.id, amount: e.amount, originalAmount: e.originalAmount, originalCurrency: e.originalCurrency, paidById: e.paidById, payers: e.payers, kind: e.kind, shares: e.shares })),
  };
}
