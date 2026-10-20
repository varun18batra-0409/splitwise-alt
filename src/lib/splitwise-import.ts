import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { cleanNames } from "./names";
import { newInviteCode } from "./group-setup";
import { logEvent } from "./events";
import { isGroupType } from "./group-types";
import { balancesOf, mapCategory, planRow } from "./splitwise-csv";
import { parseImport, type ColumnMap } from "./import-formats";

// Saving a Splitwise export as a new Loopin group (the reading is in splitwise-csv.ts).

const newId = () => `imp${randomBytes(10).toString("base64url")}`;

export type ImportResult =
  | { ok: true; groupId: string; meMemberId: string; expenses: number; payments: number; matches: boolean | null }
  | { ok: false; error: string };

// Makes a new Loopin group from another app's spreadsheet (Splitwise, a Loopin
// download, or any file with its columns picked; see import-formats.ts). `me` is which person in
// the file is the one importing (their column is linked to their account);
// everyone else is added by name, and can be invited by email later to take
// over their name.
export async function importSplitwise(
  account: { id: string; name?: string | null },
  input: { text: string; groupName: string; type: string; me: number; map?: ColumnMap; currency?: string },
): Promise<ImportResult> {
  const parsed = parseImport(input.text, { map: input.map, currency: input.currency });
  if (!parsed.ok) return parsed;
  const { people, currency, rows } = parsed;
  if (!Number.isInteger(input.me) || input.me < 0 || input.me >= people.length) return { ok: false, error: "Pick which person is you." };
  if (!rows.length) return { ok: false, error: "There’s nothing to bring over in this file." };
  const groupName = input.groupName.trim().slice(0, 60);
  if (!groupName) return { ok: false, error: "Give the group a name." };

  const plans = rows.map(planRow);
  const net = balancesOf(plans, people.length);
  const matches = parsed.expected ? parsed.expected.every((x, i) => x === net[i]) : null;
  const names = cleanNames(people);
  if (names.length !== people.length) return { ok: false, error: "Some names in this file couldn’t be used (two people with the same name?). Rename them in the other app and export again." };

  const memberIds = people.map(() => newId());
  const groupId = newId();
  const type = isGroupType(input.type) ? input.type : "other";
  const now = new Date();
  const dayOf = (d: string) => (d ? new Date(`${d}T12:00:00.000Z`) : now);
  const valid = (d: Date) => !Number.isNaN(d.getTime()) && d.getTime() <= now.getTime() + 36 * 3600_000;

  const expenses: Prisma.ExpenseCreateManyInput[] = [];
  const shares: { id: string; expenseId: string; memberId: string; amount: number }[] = [];
  const payments: { id: string; groupId: string; fromId: string; toId: string; amount: number; createdAt: Date; createdById: string }[] = [];
  for (const p of plans) {
    const when = valid(dayOf(p.row.date)) ? dayOf(p.row.date) : now;
    if (p.type === "payment") {
      payments.push({ id: newId(), groupId, fromId: memberIds[p.from], toId: memberIds[p.to], amount: p.amount, createdAt: when, createdById: memberIds[input.me] });
      continue;
    }
    const id = newId();
    const mainPayer = p.payers.reduce((a, b) => (b.a > a.a ? b : a));
    expenses.push({
      id,
      groupId,
      description: p.row.description,
      notes: parsed.format === "splitwise" ? "Brought over from Splitwise" : "Brought over from another app",
      amount: p.amount,
      splitType: "exact",
      forMode: "selected",
      category: mapCategory(p.row.category, p.row.description),
      originalAmount: p.amount,
      originalCurrency: currency,
      baseCurrency: currency,
      exchangeRate: "1",
      rateSource: "same",
      convertedAmount: p.amount,
      paidById: memberIds[mainPayer.i],
      payers: p.payers.length > 1 ? JSON.stringify(p.payers.map((x) => ({ m: memberIds[x.i], a: x.a }))) : "",
      createdAt: when,
      spentAt: when,
      createdById: memberIds[input.me],
    });
    for (const s of p.shares) shares.push({ id: newId(), expenseId: id, memberId: memberIds[s.i], amount: s.a });
  }

  const chunks = <T,>(list: T[], n = 400) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
  await db.$transaction(
    async (tx) => {
      await tx.group.create({
        data: {
          id: groupId,
          name: groupName,
          type,
          currency,
          inviteCode: newInviteCode(),
          members: {
            create: names.map((name, i) => ({
              id: memberIds[i],
              name,
              ...(i === input.me ? { accountId: account.id, claimedAt: now } : {}),
            })),
          },
        },
      });
      for (const part of chunks(expenses)) await tx.expense.createMany({ data: part });
      for (const part of chunks(shares)) await tx.expenseShare.createMany({ data: part });
      for (const part of chunks(payments)) await tx.payment.createMany({ data: part });
      await logEvent(tx, {
        groupId,
        actorId: memberIds[input.me],
        kind: "group_imported",
        text: `brought this group over from ${parsed.format === "splitwise" ? "Splitwise" : parsed.format === "loopin" ? "a Loopin spreadsheet" : "another app"} (${expenses.length} expenses, ${payments.length} payments)`,
        details: matches === false ? ["Balances differ slightly from the file’s own total"] : [],
      });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  if (!account.name) await db.account.update({ where: { id: account.id }, data: { name: names[input.me] } });
  return { ok: true, groupId, meMemberId: memberIds[input.me], expenses: expenses.length, payments: payments.length, matches };
}

