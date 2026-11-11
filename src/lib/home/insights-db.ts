import { db } from "../db";
import { getCategory } from "../categories";
import { formatMoney } from "../money";
import { dayKey, DEFAULT_TIME_ZONE } from "../dates";
import { claimJob, finishJob, sendPushTo } from "../push";
import { isPending } from "../membership";
import { loadGroup } from "../group-data";
import { addMonths, daysInMonth, monthKey } from "./month";
import { addDays } from "../local-time";
import { coveredByOldRecord, splitByZone, zonesOf } from "../nudge-zones";
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
// People whose phone has told us its time zone get it on their own 1st, in their daytime, once per person
// per month; everyone else keeps the group's India-time claim. `legacy: false` = it is night in India.
export async function sendMonthlySummaries(now = new Date(), stop: () => boolean = () => false, opts: { legacy?: boolean } = {}) {
  const legacyOk = opts.legacy !== false;
  const today = dayKey(now, DEFAULT_TIME_ZONE);
  const isFirst = (d: string) => d.slice(8, 10) === "01";
  // Someone a few hours ahead of or behind India can be on the 1st while India is not.
  if (![addDays(today, -1), today, addDays(today, 1)].some(isFirst)) return { sent: 0, deferred: false };
  const legacyToday = isFirst(today);
  const groups = await db.group.findMany({ where: { type: { in: ["home", "couple"] }, deletedAt: null }, select: { id: true, members: { select: { id: true } } } });
  const zones = await zonesOf(groups.flatMap((g) => g.members.map((m) => m.id)), now);
  let sent = 0;
  let deferred = false;
  for (const { id, members } of groups) {
    if (stop()) { deferred = true; break; }
    const { legacy, zoned } = splitByZone(members.map((m) => m.id), zones, now);
    const last = addMonths(today.slice(0, 7), -1);
    const key = `summary:${id}:${last}`;
    const runLegacy = legacyToday && legacyOk && legacy.length > 0 && (await claimJob(key, now));
    const dayOf = (p: { daytime: boolean; today: string; ahead: string }) => (p.daytime ? p.today : p.ahead); // at night: the day of their next daytime
    const zonedFirst = zoned.filter((p) => isFirst(dayOf(p)));
    if (!runLegacy && !zonedFirst.length) continue;
    const data = await loadGroup(id, { events: false });
    if (!data) {
      if (runLegacy) await finishJob(key);
      continue;
    }
    const history = await varyingHistory(id);
    const money = (n: number) => formatMoney(n, data.group.currency);
    const text = (memberId: string, month: string) => {
      const jump = utilityJumps(history, month)[0];
      const s = monthSummary(data.expenses, memberId, month, DEFAULT_TIME_ZONE);
      if (s.total <= 0) return null;
      return monthlySummaryText(
        {
          month,
          group: data.group.name,
          total: s.total,
          mine: s.mine,
          top: s.byCategory[0] ? getCategory(s.byCategory[0].id).label : "",
          unusual: jump ? `${jump.name} was ${jump.pct}% more than usual` : "",
          couple: data.group.type === "couple",
        },
        money,
      );
    };
    const around = data.group.members.filter((x) => !x.leftAt && !isPending(x));
    if (runLegacy) {
      const mine = new Set(legacy);
      for (const m of around.filter((x) => mine.has(x.id))) {
        const t = text(m.id, last);
        if (!t) break;
        sent += await sendPushTo([m.id], { ...t, url: `/groups/${id}`, tag: `summary-${id}-${last}` });
      }
    }
    for (const p of zonedFirst) {
      if (!around.some((x) => x.id === p.id)) continue;
      const month = addMonths(dayOf(p).slice(0, 7), -1);
      const t = text(p.id, month);
      if (!t) continue;
      if (!p.daytime) { deferred = true; continue; }
      const oldKey = `summary:${id}:${month}`;
      const personKey = `${oldKey}:m:${p.id}`;
      if (await coveredByOldRecord(oldKey, now, p.id)) continue;
      if (!(await claimJob(personKey, now))) continue;
      sent += await sendPushTo([p.id], { ...t, url: `/groups/${id}`, tag: `summary-${id}-${month}` });
      await finishJob(personKey);
    }
    if (runLegacy) await finishJob(key);
  }
  return { sent, deferred };
}
