import { db } from "../db";
import { parseAmount, formatMoney } from "../money";
import { typedZero } from "../zero-amount";
import { getCategory } from "../categories";
import { logEvent } from "../events";
import { claimJob, finishJob, sendPushTo } from "../push";
import { DEFAULT_TIME_ZONE } from "../dates";
import { coveredByOldGroupRecord, markSentByOldPath, splitByZone, zonesOf } from "../nudge-zones";
import { BUDGET_CATEGORIES, budgetLevelsCrossed, budgetStatus } from "./budgets";
import { monthSummary } from "./summary";
import { monthKey } from "./month";
import { monthWindow, onDate } from "./home-data";
import { FORM_OUT_OF_DATE } from "../form-currency";
import { GroupChanged, groupChangedText, guardGroup } from "../money-guard";

type Result = { ok: true } | { ok: false; error: string };

// Save the budget amounts (blank = no budget for that category).
// `was` (the form's hidden was_<category>, the amount in minor units the box showed, or "") makes the save only change the boxes the person
// changed, and only if that category is still exactly as shown: an old form never clears or overwrites someone else's newer limit.
// `currency` is the one the page was drawn in, checked again inside the write. Without `was` (older callers) every box is written as typed.
export async function saveBudgetsFor(
  groupId: string,
  actorId: string,
  amounts: Record<string, string>,
  opts: { was?: Record<string, string>; currency?: string; afterRead?: () => Promise<void> } = {},
): Promise<Result> {
  const group = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
  if (!group || group.deletedAt) return { ok: false, error: "This group no longer exists." };
  if (group.type === "direct") return { ok: false, error: "This is just between two people, so it has none of these extras." };
  if (!group.members.some((m) => m.id === actorId && !m.leftAt)) return { ok: false, error: "Only people in this group can change budgets." };
  const set: { category: string; amount: number; was: number | null }[] = [];
  const clear: { category: string; was: number | null }[] = [];
  for (const [category, raw] of Object.entries(amounts)) {
    if (!BUDGET_CATEGORIES.includes(category)) continue;
    let was: number | null = null;
    if (opts.was) {
      const w = opts.was[category];
      if (w === undefined || !/^\d{0,12}$/.test(w)) return { ok: false, error: FORM_OUT_OF_DATE }; // a form from before this check: look again
      was = w === "" ? null : Number(w);
    }
    let amount: number | null = null;
    if (raw.trim() && !typedZero(raw)) {
      amount = parseAmount(raw, group.currency);
      if (amount === null || amount <= 0) return { ok: false, error: `Enter ${getCategory(category).label} as a number, like 5000.` };
    }
    if (opts.was && amount === was) continue; // the box still says what it showed: not a change
    if (amount === null) clear.push({ category, was });
    else set.push({ category, amount, was });
  }
  if (opts.was && !set.length && !clear.length) return { ok: true }; // nothing changed: nothing written, no line in Activity
  await opts.afterRead?.(); // tests only: runs after the reads, before the write begins
  try {
    await db.$transaction(async (tx) => {
      // First: the group is still in the currency the page showed (and this person still in it).
      await guardGroup(tx, groupId, { currency: opts.currency ?? group.currency, actorId, allowClosed: true });
      for (const c of [...clear.map((x) => ({ ...x, amount: null as number | null })), ...set]) {
        const now = await tx.budget.findUnique({ where: { groupId_category: { groupId, category: c.category } } });
        if (opts.was && (now?.amount ?? null) !== c.was) throw new BudgetMoved(c.category, now?.amount ?? null);
        if (c.amount === null) {
          if (now) await tx.budget.deleteMany({ where: { id: now.id, amount: now.amount } });
        } else if (!now) {
          await tx.budget.create({ data: { groupId, category: c.category, amount: c.amount } });
        } else {
          const done = await tx.budget.updateMany({ where: { id: now.id, amount: now.amount }, data: { amount: c.amount } });
          if (done.count !== 1) throw new BudgetMoved(c.category, now.amount);
        }
      }
      await logEvent(tx, {
        groupId,
        actorId,
        kind: "bill_changed",
        text: "updated the monthly budgets",
        details: set.map((b) => `${getCategory(b.category).label}: ${formatMoney(b.amount, group.currency)}`),
      });
    });
  } catch (err) {
    if (err instanceof GroupChanged) return { ok: false, error: groupChangedText(err) };
    if (err instanceof BudgetMoved) {
      return { ok: false, error: `${getCategory(err.category).label} ${err.now === null ? "was cleared" : `changed to ${formatMoney(err.now, group.currency)}`} since you opened this page, so nothing was saved.` };
    }
    throw err;
  }
  return { ok: true };
}
class BudgetMoved extends Error {
  constructor(public category: string, public now: number | null) {
    super("BUDGET_MOVED");
  }
}

// This month's budgets for a group, with what's been spent.
export async function budgetsNow(groupId: string, expenses: Parameters<typeof monthSummary>[0], myId: string, tz: string, now = new Date()) {
  const budgets = await db.budget.findMany({ where: { groupId } });
  if (!budgets.length) return [];
  const s = monthSummary(expenses, myId, monthKey(now, tz), tz);
  return budgetStatus(
    BUDGET_CATEGORIES.flatMap((c) => budgets.filter((b) => b.category === c)),
    s.byCategory,
  );
}

// Tell everyone when a budget reaches 80% and when it goes over — once per month each.
// Returns what was sent ("groceries:80").
// Like the trip countdowns: people whose phone has told us its time zone are told in their own daytime (06:00-22:00), once each
// (key ...:m:<member id>); people with no zone yet keep the group's one record and India's daytime.
// `legacy: false` = it is night in India: the people with no zone are left for a later run. `held.deferred` is set when anyone was
// left for a later run because it was night where they are (the daily job then asks for the evening run).
export async function checkBudgets(groupId: string, now = new Date(), opts: { legacy?: boolean; held?: { deferred: boolean } } = {}): Promise<string[]> {
  const legacyOk = opts.legacy !== false;
  const budgets = await db.budget.findMany({ where: { groupId } });
  if (!budgets.length) return [];
  const month = monthKey(now, DEFAULT_TIME_ZONE);
  // Only this month's expenses are read (the month widened by 14 hours each way, so no time zone can miss one); monthSummary
  // below still keeps exactly the ones that fall in the month in India time. Older history is not needed for the budget numbers.
  const win = monthWindow(month);
  const group = await db.group.findUnique({
    where: { id: groupId },
    include: { members: { where: { leftAt: null }, select: { id: true } }, expenses: { where: { deletedAt: null, ...onDate(win.from, win.to) }, include: { shares: true } } },
  });
  if (!group || group.deletedAt) return [];
  const s = monthSummary(group.expenses, "", month, DEFAULT_TIME_ZONE);
  const sent: string[] = [];
  const crossed = budgetStatus(budgets, s.byCategory).flatMap((b) => budgetLevelsCrossed(b.spent, b.amount).map((level) => ({ b, level })));
  if (!crossed.length) return sent;
  const { legacy, zoned } = splitByZone(group.members.map((m) => m.id), await zonesOf(group.members.map((m) => m.id), now), now);
  for (const { b, level } of crossed) {
    const oldKey = `budget:${groupId}:${b.category}:${month}:${level}`;
    const label = getCategory(b.category).label;
    const money = (n: number) => formatMoney(n, group.currency);
    const payload = {
      title: `📊 ${group.name}`,
      body: level === "100" ? `${label} is over budget: ${money(b.spent)} of ${money(b.amount)} this month.` : `${label} is at ${Math.round((b.spent * 100) / b.amount)}% of this month’s budget (${money(b.spent)} of ${money(b.amount)}).`,
      url: `/groups/${groupId}`,
      tag: `budget-${groupId}-${b.category}`,
    };
    let did = false;
    if (legacy.length) {
      if (!legacyOk) {
        if (opts.held) opts.held.deferred = true;
      } else if (await claimJob(oldKey, now)) {
        await sendPushTo(legacy, payload, "reminders.budgets");
        await markSentByOldPath(oldKey, legacy, now);
        await finishJob(oldKey);
        did = true;
      }
    }
    for (const p of zoned) {
      if (!p.daytime) {
        if (opts.held) opts.held.deferred = true;
        continue;
      }
      // The live code before this change sent this alert to the whole group at once and wrote no per-person marks, whenever
      // it ran (before or after the zones switch-over), so its finished record covers zoned people too (see coveredByOldGroupRecord).
      if (await coveredByOldGroupRecord(oldKey, now, p.id)) continue;
      const key = `${oldKey}:m:${p.id}`;
      if (!(await claimJob(key, now))) continue;
      await sendPushTo([p.id], payload, "reminders.budgets");
      await finishJob(key);
      did = true;
    }
    if (did) sent.push(`${b.category}:${level}`);
  }
  return sent;
}
