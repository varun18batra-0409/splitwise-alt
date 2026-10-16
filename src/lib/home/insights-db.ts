import { db } from "../db";
import { getCategory } from "../categories";
import { formatMoney } from "../money";
import { dayKey, DEFAULT_TIME_ZONE } from "../dates";
import { claimOnce, sendPushTo } from "../push";
import { loadGroup } from "../group-data";
import { addMonths, daysInMonth, monthKey } from "./month";
import { monthSummary } from "./summary";
import { categoryJumps, forecast, monthlySummaryText, sameDayDuplicates, utilityJumps } from "./insights";

type Expenses = (Parameters<typeof monthSummary>[0][number] & { id: string; description: string })[];

// What the varying bills came to, month by month (for "usual" and jumps).
async function varyingHistory(groupId: string) {
  const runs = await db.billRun.findMany({ where: { status: "added", bill: { groupId, nature: "varies", deletedAt: null } }, include: { bill: { select: { name: true } } }, orderBy: { period: "desc" }, take: 48 });
  const amounts = new Map((await db.expense.findMany({ where: { id: { in: runs.map((r) => r.expenseId) }, deletedAt: null }, select: { id: true, amount: true } })).map((e) => [e.id, e.amount]));
  return runs.filter((r) => amounts.has(r.expenseId)).map((r) => ({ name: r.bill.name, period: r.period, amount: amounts.get(r.expenseId)! }));
}

// "Heads up" lines and next month's estimate for This month.
export async function monthInsights(groupId: string, expenses: Expenses, myId: string, weights: Record<string, number>, currency: string, tz: string, now = new Date()) {
  const month = monthKey(now, tz);
  const money = (n: number) => formatMoney(n, currency);
  const insights: { id: string; text: string; tone: "warn" | "info"; href?: string }[] = [];

  const history = await varyingHistory(groupId);
  // Compare last month's bills too: this month's may not be in yet.
  for (const m of [month, addMonths(month, -1)]) {
    for (const j of utilityJumps(history, m)) {
      if (insights.some((i) => i.id === `u-${j.name}`)) continue;
      insights.push({ id: `u-${j.name}`, tone: "warn", text: `${j.name} was ${money(j.amount)}${m === month ? " this month" : " last month"}, ${j.pct}% more than usual (${money(j.usual)}).` });
    }
  }
  const now1 = monthSummary(expenses, myId, month, tz);
  const prev = monthSummary(expenses, myId, addMonths(month, -1), tz);
  for (const c of categoryJumps(now1.byCategory, prev.byCategory)) {
    insights.push({ id: `c-${c.id}`, tone: "info", text: `${getCategory(c.id).label} is ${c.pct}% higher than last month (${money(c.amount)} vs ${money(c.prev)}).` });
  }
  const thisMonth = expenses.filter((e) => dayKey(e.spentAt ?? e.createdAt, tz).startsWith(month));
  for (const d of sameDayDuplicates(thisMonth, tz)) {
    insights.push({ id: `d-${d.ids.join("")}`, tone: "warn", text: `${d.name} ${money(d.amount)} was added ${d.ids.length} times on the same day.`, href: `/groups/${groupId}?tab=activity&q=${encodeURIComponent(d.name)}` });
  }

  // Next month, about.
  const bills = await db.bill.findMany({ where: { groupId, deletedAt: null, paused: false } });
  let estimate = 0;
  if (bills.length) {
    const next = addMonths(month, 1);
    const billExpenseIds = new Set((await db.billRun.findMany({ where: { bill: { groupId } }, select: { expenseId: true } })).map((r) => r.expenseId));
    const groceries = [1, 2, 3].map((n) => {
      const k = addMonths(month, -n);
      return expenses
        .filter((e) => !billExpenseIds.has(e.id) && getCategory(e.category).id === "groceries" && dayKey(e.spentAt ?? e.createdAt, tz).startsWith(k))
        .reduce((s, e) => s + (e.kind === "refund" ? -e.amount : e.amount), 0);
    }).filter((x) => x > 0);
    estimate = forecast({
      fixed: bills.filter((b) => b.nature === "fixed").map((b) => Math.round(b.amount / Math.max(1, b.every))),
      varies: bills.filter((b) => b.nature === "varies").map((b) => {
        const past = history.filter((h) => h.name === b.name).slice(0, 3).map((h) => h.amount);
        return past.length ? past : b.amount ? [b.amount] : [];
      }),
      daily: bills.filter((b) => b.nature === "daily").map((b) => ({ rate: b.amount, days: daysInMonth(next) })),
      groceries,
    });
  }
  const totalW = Object.values(weights).reduce((s, w) => s + w, 0);
  const mine = totalW ? Math.round((estimate * (weights[myId] ?? 0)) / totalW) : 0;
  return { insights: insights.slice(0, 4), forecast: estimate > 0 ? { total: estimate, mine } : null };
}

// On the 1st: last month in one message, to everyone in Home and Couple groups.
export async function sendMonthlySummaries(now = new Date()) {
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  if (today.slice(8, 10) !== "01") return { sent: 0 };
  const last = addMonths(today.slice(0, 7), -1);
  const groups = await db.group.findMany({ where: { type: { in: ["home", "couple"] }, deletedAt: null }, select: { id: true } });
  let sent = 0;
  for (const { id } of groups) {
    if (!(await claimOnce(`summary:${id}:${last}`))) continue;
    const data = await loadGroup(id);
    if (!data) continue;
    const history = await varyingHistory(id);
    const jump = utilityJumps(history, last)[0];
    const money = (n: number) => formatMoney(n, data.group.currency);
    for (const m of data.group.members.filter((x) => !x.leftAt)) {
      const s = monthSummary(data.expenses, m.id, last, DEFAULT_TIME_ZONE);
      if (s.total <= 0) break;
      const text = monthlySummaryText(
        {
          month: last,
          group: data.group.name,
          total: s.total,
          mine: s.mine,
          top: s.byCategory[0] ? getCategory(s.byCategory[0].id).label : "",
          unusual: jump ? `${jump.name} was ${jump.pct}% more than usual` : "",
          couple: data.group.type === "couple",
        },
        money,
      );
      sent += await sendPushTo([m.id], { ...text, url: `/groups/${id}`, tag: `summary-${id}-${last}` });
    }
  }
  return { sent };
}
