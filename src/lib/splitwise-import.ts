import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { cleanNames } from "./names";
import { newInviteCode } from "./group-setup";
import { logEvent } from "./events";
import { isGroupType } from "./group-types";
import { balanceGapText, balancesOf, mapCategory, planRow } from "./splitwise-csv";
import { parseImport, type ColumnMap } from "./import-formats";
import { formatMoney, MAX_MINOR } from "./money";
import { claimKey, fingerprintOf, isBusy, isDuplicateKey, keyState, STALE_KEY_ERROR, withRetry } from "./once";

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
  input: { text: string; groupName: string; type: string; me: number; map?: ColumnMap; currency?: string; key?: string },
): Promise<ImportResult> {
  const parsed = parseImport(input.text, { map: input.map, currency: input.currency });
  if (!parsed.ok) return parsed;
  const { people, currency, rows } = parsed;
  if (!Number.isInteger(input.me) || input.me < 0 || input.me >= people.length) return { ok: false, error: "Pick which person is you." };
  if (!rows.length) return { ok: false, error: "There’s nothing to bring over in this file." };
  const groupName = input.groupName.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!groupName) return { ok: false, error: "Give the group a name." };

  // The same form sent again (a retry, a double tap) gives back the group the first one made, never a second copy. A form opened afresh has a
  // fresh key, so a copy made on purpose still works. The same key with a different file, name or person (or after 2 minutes) is a stale screen.
  const type = isGroupType(input.type) ? input.type : "other";
  const fp = fingerprintOf("import", account.id, createHash("sha256").update(input.text).digest("hex"), input.me, groupName, type, JSON.stringify(input.map ?? null), input.currency ?? "");
  const earlier = await keyState(input.key, fp);
  if (earlier.state === "stale") return { ok: false, error: STALE_KEY_ERROR };
  if (earlier.state === "done") {
    // The first request may have saved the group and then stopped before naming the account: that is finished here.
    await nameAccountIfEmpty(account.id, cleanNames(people)[input.me]);
    return savedResult(earlier.result);
  }

  const plans = rows.map(planRow);
  const net = balancesOf(plans, people.length);
  // Checked before anything is saved: every expense's payers and shares must each add up to its amount, a payment must be a real amount
  // between two different people, and everyone's balances together must be 0. A file that fails any of these (a name that was matched wrongly,
  // an amount that was read wrongly) would leave the new group's balances not adding up, so it is refused instead of saved.
  const sumOf = (xs: { a: number }[]) => xs.reduce((t, x) => t + x.a, 0);
  // One expense is stored as a whole number up to MAX_MINOR (the database's Int limit is lower than what several payers could add up to).
  if (plans.some((p) => p.type !== "payment" && p.amount > MAX_MINOR)) {
    return { ok: false, error: `A line in this file is more than ${formatMoney(MAX_MINOR, currency)}, the most Loopin can hold for one expense, so nothing was brought over.` };
  }
  const unsafe =
    plans.some((p) => (p.type === "payment" ? !(p.amount > 0) || p.amount > MAX_MINOR || p.from === p.to : !(p.amount > 0) || !p.payers.length || sumOf(p.payers) !== p.amount || sumOf(p.shares) !== p.amount)) ||
    net.reduce((t, x) => t + x, 0) !== 0;
  if (unsafe) return { ok: false, error: "This file couldn’t be read safely, so nothing was brought over. Check the names and amounts in it and try again." };
  const matches = parsed.expected ? parsed.expected.every((x, i) => x === net[i]) : null;
  const gapText = parsed.expected ? balanceGapText(parsed.expected, net, people, currency) : null;
  const names = cleanNames(people);
  if (names.length !== people.length) return { ok: false, error: "Some names in this file couldn’t be used (two people with the same name?). Rename them in the other app and export again." };

  const memberIds = people.map(() => newId());
  const groupId = newId();
  const now = new Date();
  const dayOf = (d: string) => (d ? new Date(`${d}T12:00:00.000Z`) : now);
  const valid = (d: Date) => !Number.isNaN(d.getTime()) && d.getTime() <= now.getTime() + 36 * 3600_000;

  const expenses: Prisma.ExpenseCreateManyInput[] = [];
  const shares: { id: string; expenseId: string; memberId: string; amount: number }[] = [];
  const payments: { id: string; groupId: string; fromId: string; toId: string; amount: number; createdAt: Date; createdById: string }[] = [];
  // Guessing a category is the slow part of a big file; the same words always give the same answer, so each is worked out once.
  const guessed = new Map<string, string>();
  const categoryOf = (category: string, description: string) => {
    const key = `${category}\u0000${description}`;
    let c = guessed.get(key);
    if (c === undefined) guessed.set(key, (c = mapCategory(category, description)));
    return c;
  };
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
      notes: "Brought over from another app",
      amount: p.amount,
      splitType: "exact",
      forMode: "selected",
      category: p.kind === "pot" ? "other" : categoryOf(p.row.category, p.row.description),
      kind: p.kind ?? "expense",
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
  const result: ImportResult = { ok: true, groupId, meMemberId: memberIds[input.me], expenses: expenses.length, payments: payments.length, matches };
  try {
  // Queued within this server like the other same-key saves (bills, expenses): two simultaneous imports never both write at once.
  await withRetry(() => db.$transaction(
    async (tx) => {
      // First, so a second request with this key fails here and nothing is made.
      await claimKey(tx, input.key, JSON.stringify(result), fp);
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
        text: `brought this group over from ${parsed.format === "loopin" ? "a Loopin spreadsheet" : "another app"} (${expenses.length} expenses, ${payments.length} payments)`,
        details: matches === false && gapText ? [gapText] : [],
      });
    },
    { timeout: 60_000, maxWait: 10_000 },
  ));
  } catch (err) {
    // Two requests with the same key at the same moment: the other one won (or the database was busy with it), so this one gives back
    // that group once it is saved.
    const racing = isDuplicateKey(err);
    if (racing || isBusy(err)) {
      // After a busy answer the other request may still be finishing: look a few times, with short waits, before giving up.
      for (let look = 0; look < 4; look++) {
        if (look > 0) await new Promise((r) => setTimeout(r, 100 * look));
        const again = await keyState(input.key, fp);
        if (again.state === "done") {
          await nameAccountIfEmpty(account.id, names[input.me]);
          return savedResult(again.result);
        }
        if (again.state === "stale" || racing) return { ok: false, error: STALE_KEY_ERROR };
        if (!input.key) break;
      }
    }
    throw err;
  }
  if (!account.name) await nameAccountIfEmpty(account.id, names[input.me]);
  return result;
}

// Names the account after the person it picked in the file, only while it has no name (and never over a name set meanwhile).
async function nameAccountIfEmpty(accountId: string, name: string | undefined): Promise<void> {
  if (!name) return;
  await db.account.updateMany({ where: { id: accountId, name: "" }, data: { name } });
}

// What an earlier request with the same key saved (see claimKey in the import's transaction).
function savedResult(json: string): ImportResult {
  try {
    const r = JSON.parse(json);
    if (typeof r?.groupId === "string" && typeof r?.meMemberId === "string") {
      return { ok: true, groupId: r.groupId, meMemberId: r.meMemberId, expenses: Number(r.expenses) || 0, payments: Number(r.payments) || 0, matches: typeof r.matches === "boolean" ? r.matches : null };
    }
  } catch {
    /* fall through */
  }
  return { ok: false, error: STALE_KEY_ERROR };
}

