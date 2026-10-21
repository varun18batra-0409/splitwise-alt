import Link from "@/components/Link";
import { getMemberships } from "@/lib/identity";
import { loadMyGroups } from "@/lib/group-data";
import { buildActivity, byDay, filterActivity } from "@/lib/activity";
import { bucketOf, bucketsEnding, cleanPeriod, inPeriod, monthLabel, periodsOf, recap, type Grain } from "@/lib/search";
import { Insights, type InsightsData } from "./Insights";
import { db } from "@/lib/db";
import { displayRate } from "@/lib/rate-cache";
import { convertAmount } from "@/lib/conversion";
import { after } from "next/server";
import { nextDueDay } from "@/lib/home/bills";
import { niceDate } from "@/lib/format";
import { getTimeZone } from "@/lib/tz";
import { formatMoney } from "@/lib/money";
import { ActivityRow } from "@/components/ActivityRow";
import { itemHref } from "@/lib/paths";
import { PageHeader } from "@/components/ui";
import { SearchIcon } from "@/components/icons";

// Search everything: type words, tap a month or a year, narrow to one group.
// The recap on top sums up whatever the filters picked.
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; g?: string; y?: string; m?: string; w?: string; v?: string; p?: string }>;
}) {
  const sp = await searchParams;
  const tz = await getTimeZone();
  const q = (sp.q ?? "").slice(0, 80);
  const period = cleanPeriod(sp.y, sp.m, sp.w);
  const all = await loadMyGroups(await getMemberships());
  const groupId = all.some((g) => g.group.id === sp.g) ? sp.g : undefined;
  const groups = groupId ? all.filter((g) => g.group.id === groupId) : all;

  const rows = groups.flatMap((g) => {
    const names = new Map(g.group.members.map((m) => [m.id, m.id === g.myId ? "You" : m.name]));
    const nameOf = (id: string) => names.get(id) ?? "Someone";
    const searchName = (id: string) => (id === g.myId ? `${g.group.members.find((m) => m.id === id)?.name ?? ""} you` : nameOf(id));
    const items = filterActivity(buildActivity(g.expenses, g.payments, g.myId), { q }, searchName);
    return items.map((item) => ({ item, g, nameOf }));
  });
  const { months, years } = periodsOf(rows.map((r) => r.item.date), tz);
  const shown = rows.filter((r) => inPeriod(r.item.date, period, tz)).sort((a, b) => b.item.date.getTime() - a.item.date.getTime());

  const sum = recap(
    shown.flatMap(({ item, g }) =>
      item.kind === "expense"
        ? [{
            amount: item.refund ? -item.amount : item.amount,
            category: item.category,
            currency: g.group.currency,
            mine: (item.refund ? -1 : 1) * (g.expenses.find((e) => e.id === item.id)?.shares.find((s) => s.memberId === g.myId)?.amount ?? 0),
          }]
        : [],
    ),
  );

  // Insights settings: what to show, and by week, month or year.
  const view: "share" | "spent" = sp.v === "spent" ? "spent" : "share";
  const grain: Grain = sp.p === "w" || sp.p === "m" || sp.p === "y" ? sp.p : period.week ? "w" : period.year ? "y" : "m";

  const href = (over: { g?: string | null; y?: string | null; m?: string | null; w?: string | null; v?: string; p?: string }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const g = over.g === undefined ? groupId : over.g;
    if (g) p.set("g", g);
    const w = over.w === undefined ? period.week : over.w;
    const m = over.m === undefined ? period.month : over.m;
    const y = over.y === undefined ? period.year : over.y;
    if (w) p.set("w", w);
    else if (m) p.set("m", m);
    else if (y) p.set("y", y);
    const v = over.v ?? view;
    if (v !== "share") p.set("v", v);
    const gr = over.p ?? (sp.p === "w" || sp.p === "m" || sp.p === "y" ? sp.p : undefined);
    if (gr) p.set("p", gr);
    const s = p.toString();
    return `/search${s ? `?${s}` : ""}`;
  };

  // ---------- Insights (the chart on top) ----------
  // One currency for the chart: the one most of these groups use; others at the saved rate.
  const curCount = new Map<string, number>();
  for (const g of groups) curCount.set(g.group.currency, (curCount.get(g.group.currency) ?? 0) + 1);
  const chartCurrency = [...curCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "INR";
  const rates = new Map<string, string | null>(
    await Promise.all(
      [...curCount.keys()]
        .filter((c) => c !== chartCurrency)
        .map(async (c) => {
          const r = await displayRate(c, chartCurrency, after);
          return [c, r.ok ? r.rate : null] as const;
        }),
    ),
  );
  let converted = false;
  const inChart = (amount: number, cur: string): number | null => {
    if (cur === chartCurrency) return amount;
    const rate = rates.get(cur);
    if (!rate) return null;
    converted = true;
    const c = convertAmount(Math.abs(amount), cur, chartCurrency, rate);
    return c === null ? null : Math.sign(amount) * c;
  };
  // Every expense (words and group filters applied, not the period): its value for the chosen view.
  const points = rows.flatMap(({ item, g }) => {
    if (item.kind !== "expense") return [];
    const sign = item.refund ? -1 : 1;
    const raw = view === "share" ? sign * (g.expenses.find((e) => e.id === item.id)?.shares.find((s) => s.memberId === g.myId)?.amount ?? 0) : sign * item.amount;
    if (raw === 0) return [];
    const v = inChart(raw, g.group.currency);
    return v === null ? [] : [{ date: item.date, value: v, category: item.category }];
  });
  const todayKey = bucketOf(new Date(), grain, tz);
  const periodKey = grain === "w" ? period.week : grain === "m" ? period.month : period.year;
  const selected = periodKey ?? todayKey;
  const lastKey = selected > todayKey ? selected : todayKey;
  const keys = bucketsEnding(lastKey, grain);
  const sums = new Map<string, number>();
  const cats = new Map<string, number>();
  for (const pt of points) {
    const k = bucketOf(pt.date, grain, tz);
    sums.set(k, (sums.get(k) ?? 0) + pt.value);
    if (k === selected) cats.set(pt.category, (cats.get(pt.category) ?? 0) + pt.value);
  }
  // Bills that repeat, in these groups (Home and Couple groups have them).
  const billRows = await db.bill.findMany({
    where: { groupId: { in: groups.map((g) => g.group.id) }, deletedAt: null, paused: false },
    orderBy: { createdAt: "asc" },
    take: 12,
  });
  const BILL_EMOJI: Record<string, string> = { rent: "🏠", society: "🏢", electricity: "⚡", wifi: "📶", help: "🧹", cook: "🍳", milk: "🥛", water: "💧", groceries: "🛒", gas: "🔥", streaming: "📺", mobile: "📱" };
  const insights: InsightsData = {
    view,
    grain,
    currency: chartCurrency,
    converted,
    bars: keys.map((k) => ({
      key: k,
      value: sums.get(k) ?? 0,
      href: grain === "w" ? href({ w: k, m: null, y: null, p: "w" }) : grain === "m" ? href({ m: k, w: null, y: null, p: "m" }) : href({ y: k, m: null, w: null, p: "y" }),
    })),
    selected,
    categories: [...cats].map(([id, amount]) => ({ id, amount })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount),
    bills: billRows.map((b) => {
      const g = groups.find((x) => x.group.id === b.groupId)!;
      const money = (n: number) => formatMoney(n, g.group.currency);
      const next = nextDueDay(b, new Date());
      return {
        id: b.id,
        href: `/groups/${b.groupId}/bills/${b.id}`,
        name: b.name,
        group: g.group.name,
        amount: b.nature === "daily" ? `${money(b.amount)}/day` : b.nature === "varies" ? (b.amount ? `~${money(b.amount)}` : "Changes") : `${money(b.amount)}/mo`,
        when: next ? niceDate(next).replace(/ \d{4}$/, "") : "—",
        emoji: BILL_EMOJI[b.icon] ?? "🧾",
      };
    }),
    link: (over) => href({ v: over.v, p: over.p, ...(over.p ? { w: null, m: null, y: null } : {}) }),
  };
  const chip = (on: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm ${on ? "border-fg bg-fg font-medium text-canvas" : "border-line text-gray-600 active:bg-mist"}`;
  const periodName = period.month ? monthLabel(period.month) : period.year ?? "All time";
  const monthLabelShort = (week: string) => new Date(`${week}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const back = groupId ? `/groups/${groupId}` : "/";

  return (
    <>
      <PageHeader title="Insights" back={back} />
      {all.length > 0 && <Insights d={insights} />}

      <h2 className="mb-3 mt-2 font-display text-lg font-semibold tracking-tight">
        Find anything
        {(period.week || period.month || period.year) && (
          <span className="ml-2 font-sans text-sm font-normal text-gray-500">
            in {period.week ? `the week of ${monthLabelShort(period.week)}` : periodName}
            {" · "}
            <Link href={href({ w: null, m: null, y: null })} className="underline underline-offset-4">
              all time
            </Link>
          </span>
        )}
      </h2>
      {sum.count > 0 && (
        <p className="mb-4 text-sm text-gray-500">
          {sum.count} {sum.count === 1 ? "expense" : "expenses"} · {sum.totals.map((t) => formatMoney(t.spent, t.currency)).join(" + ")} spent · your share{" "}
          {sum.totals.map((t) => formatMoney(t.mine, t.currency)).join(" + ")}
        </p>
      )}

      <form method="get" action="/search" role="search" data-allow-repeat="1" className="relative mb-4">
        {groupId && <input type="hidden" name="g" value={groupId} />}
        {period.week && <input type="hidden" name="w" value={period.week} />}
        {period.month && <input type="hidden" name="m" value={period.month} />}
        {period.year && <input type="hidden" name="y" value={period.year} />}
        {view !== "share" && <input type="hidden" name="v" value={view} />}
        {(sp.p === "w" || sp.p === "m" || sp.p === "y") && <input type="hidden" name="p" value={sp.p} />}
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
          <SearchIcon size={18} />
        </span>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Dinner, Goa, Asha, taxi…"
          aria-label="Search"
          enterKeyHint="search"
          className="w-full rounded-full border border-line bg-mist py-3 pl-11 pr-4 text-base text-fg outline-none placeholder:text-gray-400 focus:border-accent"
        />
      </form>

      {/* Group, month and year chips: one tap each, scroll sideways for more. */}
      {all.length > 1 && (
        <div className="-mx-5 mb-2 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          <Link href={href({ g: null })} className={chip(!groupId)}>
            All groups
          </Link>
          {/* The chosen group comes first, so it's in view without scrolling. */}
          {[...all].sort((a, b) => Number(b.group.id === groupId) - Number(a.group.id === groupId)).map((g) => (
            <Link key={g.group.id} href={href({ g: g.group.id })} className={chip(groupId === g.group.id)}>
              {g.group.name}
            </Link>
          ))}
        </div>
      )}
      <div className="-mx-5 mb-2 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
        <Link href={href({ w: null, m: null, y: null })} className={chip(!period.week && !period.month && !period.year)}>
          All time
        </Link>
        {months.map((m) => (
          <Link key={m} href={href({ m, y: null, w: null })} className={chip(period.month === m)}>
            {monthLabel(m)}
          </Link>
        ))}
      </div>
      {years.length > 1 && (
        <div className="-mx-5 mb-2 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          {years.map((y) => (
            <Link key={y} href={href({ y, m: null, w: null })} className={chip(period.year === y)}>
              {y}
            </Link>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-8 text-center text-sm text-gray-500">
          {all.length === 0 ? "Join or create a group first." : "No matches. Try other words or another month."}
        </p>
      ) : (
        <div className="space-y-6">
          {byDay(shown.slice(0, 100).map((r) => ({ ...r, date: r.item.date })), new Date(), tz).map((day) => (
            <section key={day.day}>
              <h2 className="mb-1 text-sm font-medium text-gray-500">{day.day}</h2>
              <ul className="divide-y divide-line">
                {day.items.map(({ item, g, nameOf }) => (
                  <li key={item.id}>
                    <Link href={itemHref(g.group.id, item)} className="block active:bg-mist">
                      <ActivityRow item={item} currency={g.group.currency} nameOf={nameOf} groupName={groupId ? undefined : g.group.name} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {shown.length > 100 && (
            <p className="text-center text-xs text-gray-400">Showing the latest 100 of {shown.length}. Add words or pick a month to narrow it down.</p>
          )}
        </div>
      )}
    </>
  );
}
