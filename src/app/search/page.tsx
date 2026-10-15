import Link from "next/link";
import { getMemberships } from "@/lib/identity";
import { loadMyGroups } from "@/lib/group-data";
import { buildActivity, byDay, filterActivity } from "@/lib/activity";
import { cleanPeriod, inPeriod, monthLabel, periodsOf, recap } from "@/lib/search";
import { getTimeZone } from "@/lib/tz";
import { formatMoney } from "@/lib/money";
import { ActivityRow } from "@/components/ActivityRow";
import { PageHeader } from "@/components/ui";
import { SearchIcon } from "@/components/icons";

// Search everything: type words, tap a month or a year, narrow to one group.
// The recap on top sums up whatever the filters picked.
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; g?: string; y?: string; m?: string }>;
}) {
  const sp = await searchParams;
  const tz = await getTimeZone();
  const q = (sp.q ?? "").slice(0, 80);
  const period = cleanPeriod(sp.y, sp.m);
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
        ? [{ amount: item.amount, category: item.category, currency: g.group.currency, mine: g.expenses.find((e) => e.id === item.id)?.shares.find((s) => s.memberId === g.myId)?.amount ?? 0 }]
        : [],
    ),
  );

  const href = (over: { g?: string | null; y?: string | null; m?: string | null }) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    const g = over.g === undefined ? groupId : over.g;
    if (g) p.set("g", g);
    const m = over.m === undefined ? period.month : over.m;
    const y = over.y === undefined ? period.year : over.y;
    if (m) p.set("m", m);
    else if (y) p.set("y", y);
    const s = p.toString();
    return `/search${s ? `?${s}` : ""}`;
  };
  const chip = (on: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm ${on ? "border-fg bg-fg font-medium text-canvas" : "border-line text-gray-600 active:bg-mist"}`;
  const periodName = period.month ? monthLabel(period.month) : period.year ?? "All time";
  const back = groupId ? `/groups/${groupId}` : "/";

  return (
    <>
      <PageHeader title="Search" back={back} />

      <form method="get" action="/search" role="search" data-allow-repeat="1" className="relative mb-4">
        {groupId && <input type="hidden" name="g" value={groupId} />}
        {period.month && <input type="hidden" name="m" value={period.month} />}
        {period.year && <input type="hidden" name="y" value={period.year} />}
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
          {all.map((g) => (
            <Link key={g.group.id} href={href({ g: g.group.id })} className={chip(groupId === g.group.id)}>
              {g.group.name}
            </Link>
          ))}
        </div>
      )}
      <div className="-mx-5 mb-2 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
        <Link href={href({ m: null, y: null })} className={chip(!period.month && !period.year)}>
          All time
        </Link>
        {months.map((m) => (
          <Link key={m} href={href({ m, y: null })} className={chip(period.month === m)}>
            {monthLabel(m)}
          </Link>
        ))}
      </div>
      {years.length > 1 && (
        <div className="-mx-5 mb-2 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          {years.map((y) => (
            <Link key={y} href={href({ y, m: null })} className={chip(period.year === y)}>
              {y}
            </Link>
          ))}
        </div>
      )}

      {/* Recap */}
      <section className="vault mb-8 mt-4 rounded-[20px] px-5 py-5 text-fg">
        <p className="text-sm text-fg/55">
          {periodName}
          {groupId ? ` · ${groups[0]?.group.name}` : ""}
          {q ? ` · “${q}”` : ""}
        </p>
        {sum.count === 0 ? (
          <p className="mt-1 font-display text-2xl font-semibold">Nothing here</p>
        ) : (
          <>
            {sum.totals.map((t) => (
              <p key={t.currency} className="mt-1 font-display text-3xl font-semibold leading-tight tabular-nums">
                {formatMoney(t.spent, t.currency)}
                <span className="ml-2 font-sans text-sm font-normal text-fg/55">spent</span>
              </p>
            ))}
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-fg/45">Your share</p>
                <p className="mt-0.5 tabular-nums">{sum.totals.map((t) => formatMoney(t.mine, t.currency)).join(" + ")}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-fg/45">Expenses</p>
                <p className="mt-0.5 tabular-nums">{sum.count}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-fg/45">Top</p>
                <p className="mt-0.5 truncate">
                  {sum.topCategory ? `${sum.topCategory.emoji} ${sum.topCategory.short}` : "—"}
                </p>
              </div>
            </div>
          </>
        )}
      </section>

      {shown.length === 0 ? (
        <p className="rounded-2xl bg-mist px-4 py-8 text-center text-sm text-gray-500">
          {all.length === 0 ? "Join or create a group first." : "No matches. Try other words or another month."}
        </p>
      ) : (
        <div className="space-y-6">
          {byDay(shown.map((r) => ({ ...r, date: r.item.date })), new Date(), tz).map((day) => (
            <section key={day.day}>
              <h2 className="mb-1 text-sm font-medium text-gray-500">{day.day}</h2>
              <ul className="divide-y divide-line">
                {day.items.map(({ item, g, nameOf }) => (
                  <li key={item.id}>
                    <Link href={`/groups/${g.group.id}?tab=activity`} className="block active:bg-mist">
                      <ActivityRow item={item} currency={g.group.currency} nameOf={nameOf} groupName={groupId ? undefined : g.group.name} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
