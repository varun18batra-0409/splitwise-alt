import { roundToWhole } from "@/lib/round-whole";
import Link from "@/components/Link";
import { getCategory } from "@/lib/categories";
import { daysLeft, monthKey } from "@/lib/home/month";
import { aheadBehind, monthSummary } from "@/lib/home/summary";
import type { GroupView } from "./view";
import { Amt } from "@/components/Amt";
import { overviewMoney } from "@/lib/money-display";
import { BillsIcon, CartIcon, ChevronRight, DepositIcon, PieIcon, PlusIcon } from "@/components/icons";
import { ExpenseGlyph } from "@/components/ExpenseGlyph";

// Extra parts of This month that come from bills, budgets, goals, the deposit
// and insights (each section is hidden when it has nothing to show).
export type MonthExtras = {
  upcoming?: { id: string; name: string; icon: string; when: string; who: string; amount: string; status: "added" | "due" | "enter"; href?: string }[];
  insights?: { id: string; text: string; tone: "warn" | "info"; href?: string }[];
  budgets?: { category: string; spent: number; amount: number; level: "ok" | "near" | "over" }[];
  forecast?: { total: number; mine: number } | null;
  deposit?: { total: number; mine: number } | null;
  goals?: { id: string; name: string; saved: number; target: number }[];
  shopping?: { items: { id: string; text: string }[]; total: number };
};

const card = "rounded-2xl border border-line bg-white";
const h2 = "font-display text-[19px] font-semibold";

// The first screen of a Home or Couple group: this month at a glance.
export function ThisMonthTab({ v, extras = {} }: { v: GroupView; extras?: MonthExtras }) {
  const { group, myId, net, money, transfers } = v;
  const key = monthKey(new Date(), v.tz);
  const s = monthSummary(group.expenses.filter((e) => !e.deletedAt), myId, key, v.tz);
  const couple = group.type === "couple";
  const mine = net[myId] ?? 0;
  const monthName = new Date(`${key}-15T12:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
  const left = daysLeft(new Date(), v.tz);
  const settle = !group.closed && transfers.length > 0;
  const settleDayText = group.settleDay ? `Settle-up day is the ${group.settleDay === 31 ? "last day" : ordinal(group.settleDay)}` : "";

  // Couples: who has put in what this month vs the agreed split.
  const partner = group.members.find((m) => m.id !== myId && !m.leftAt);
  const meW = group.members.find((m) => m.id === myId)?.splitWeight ?? 100;
  const theirW = partner?.splitWeight ?? 100;
  const agreed = Math.round((meW * 100) / (meW + theirW));
  const myPart = s.total > 0 ? Math.min(100, Math.max(0, Math.round((s.paidByMe * 100) / s.total))) : agreed;
  const change = s.total - s.lastTotal;

  // The flat's own row of ways in: only the ones this group has (Deposit is for flats; couples have Bills, Shopping and Budget).
  const tiles = [
    { label: "Bills", href: `/groups/${group.id}?tab=bills`, icon: <BillsIcon size={24} /> },
    { label: "Shopping", href: `/groups/${group.id}?tab=list`, icon: <CartIcon size={24} /> },
    { label: "Budget", href: `/groups/${group.id}/budgets`, icon: <PieIcon size={24} /> },
    ...(group.type === "home" ? [{ label: "Deposit", href: `/groups/${group.id}/deposit`, icon: <DepositIcon size={24} /> }] : []),
  ];
  const next = extras.upcoming?.[0];
  const rest = extras.upcoming?.slice(1) ?? [];
  const shop = extras.shopping;

  return (
    <div className="space-y-8">
      <nav aria-label="Your flat" data-flat-tiles className={`grid grid-cols-2 gap-2.5 ${tiles.length === 4 ? "min-[340px]:grid-cols-4" : "min-[340px]:grid-cols-3"}`}>
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="flex flex-col items-center gap-2 rounded-[20px] border border-line bg-white px-2 py-4 text-fg/75 active:bg-fg/10">
            {t.icon}
            <span className="text-[13px] text-fg">{t.label}</span>
          </Link>
        ))}
      </nav>

      {next && (
        <section aria-label="Next bill" data-next-bill className="rounded-[20px] border border-line bg-white p-4">
          <div className="flex items-center gap-3.5">
            <ExpenseGlyph title={next.name} category="bills" size={44} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-fg/60">Next bill</p>
              <p className="break-words font-display text-[18px] font-semibold leading-tight tracking-tight">
                {next.name}
                {next.amount ? <> · <span className="money tabular-nums">{next.amount}</span></> : null}
              </p>
              <p className="text-[13px] text-fg/60">{next.when} · {next.who}</p>
            </div>
          </div>
          <div className="mt-3.5 flex flex-wrap gap-2.5">
            <Link href={`/groups/${group.id}/bills/${next.id}`} className="inline-flex min-h-11 items-center rounded-full border border-fg/25 px-4 text-sm font-semibold text-fg active:bg-fg/10">
              View bill
            </Link>
            {next.status === "enter" && next.href && (
              <Link href={next.href} className="inline-flex min-h-11 items-center rounded-full border border-fg/25 px-4 text-sm font-semibold text-fg active:bg-fg/10">
                Enter amount
              </Link>
            )}
          </div>
        </section>
      )}

      {shop && (
        <section aria-label="Shopping list" data-shopping-card className="rounded-[20px] border border-line bg-white p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={h2}>Shopping list</h2>
            <Link href={`/groups/${group.id}?tab=list`} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-fg">
              <PlusIcon size={16} />
              Add item
            </Link>
          </div>
          {shop.items.length === 0 ? (
            <p className="text-sm text-fg/60">Nothing on the list. Add what’s running low.</p>
          ) : (
            <ul>
              {shop.items.map((i) => (
                <li key={i.id} className="border-b border-line last:border-0">
                  <Link href={`/groups/${group.id}?tab=list`} className="flex items-center gap-3 py-3">
                    <span aria-hidden className="h-5 w-5 shrink-0 rounded-[6px] border-[1.5px] border-fg/40" />
                    <span className="min-w-0 flex-1 truncate text-[15px]">{i.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {shop.total > shop.items.length && (
            <Link href={`/groups/${group.id}?tab=list`} className="mt-1 inline-flex min-h-11 items-center gap-1 text-sm text-fg/75">
              See all {shop.total}
              <ChevronRight size={14} />
            </Link>
          )}
        </section>
      )}

      <section className="vault rounded-[24px] px-5 py-5">
        {couple ? (
          <>
            <p className="text-sm text-gray-500">{monthName} together</p>
            <p className="mt-1 money text-[40px] font-semibold leading-none tracking-tight tabular-nums"><Amt minor={s.total} currency={group.currency} /></p>
            {s.lastTotal > 0 && (
              <p className="mt-1.5 text-sm text-gray-500">
                {change <= 0 ? <><Amt minor={-change} currency={group.currency} /> less than last month</> : <><Amt minor={change} currency={group.currency} /> more than last month</>}
              </p>
            )}
            <div className="my-4 h-px bg-line" />
            <p className="money text-[22px] font-semibold tabular-nums">
              {aheadBehind(mine) === "ahead" ? <>Overall you’re <Amt minor={mine} currency={group.currency} className="text-owed" /> ahead</> : aheadBehind(mine) === "behind" ? <>Overall you’re <Amt minor={-mine} currency={group.currency} className="text-owe" /> behind</> : "You’re even"}
            </p>
            {s.total > 0 && (
              <>
                <p className="mt-1 text-xs text-gray-500">
                  This month you put in <Amt minor={s.paidByMe} currency={group.currency} />; your {agreed}% share is <Amt minor={s.mine} currency={group.currency} />
                  {s.paidByMe !== s.mine ? <> (<Amt minor={Math.abs(s.paidByMe - s.mine)} currency={group.currency} /> {s.paidByMe > s.mine ? "ahead" : "behind"})</> : ""}.
                </p>
                <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-mist" aria-hidden>
                  <div className="bg-fg" style={{ width: `${myPart}%` }} />
                  <div className="w-[2px] bg-canvas" />
                  <div className="flex-1 bg-[#6e6b63]" />
                </div>
                <div className="mt-1.5 flex justify-between text-xs text-gray-500">
                  <span>You paid {myPart}%</span>
                  <span>
                    Your split: {agreed}% / {100 - agreed}%
                  </span>
                  <span>
                    {partner?.name ?? "Partner"} {100 - myPart}%
                  </span>
                </div>
              </>
            )}
            {settle && (
              <Link href={`/groups/${group.id}/settle`} className="mt-4 inline-block border border-gray-300 px-4 py-2.5 text-sm font-semibold text-fg active:bg-mist rounded-full">
                Even out
              </Link>
            )}
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-gray-500">{monthName} · your share</p>
              <p className="text-xs text-gray-500">{left === 0 ? "Last day" : left === 1 ? "1 day left" : `${left} days left`}</p>
            </div>
            <p className="mt-1 money text-[40px] font-semibold leading-none tracking-tight tabular-nums"><Amt minor={s.mine} currency={group.currency} /></p>
            <p className="mt-1.5 text-sm text-gray-500">of <Amt minor={s.total} currency={group.currency} /> for the {group.type === "home" ? "home" : "group"} so far</p>
            <div className="my-4 h-px bg-line" />
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="money text-[22px] font-semibold tabular-nums">
                  {mine > 0 ? <>Overall you’re owed <Amt minor={mine} currency={group.currency} className="text-owed" /></> : mine < 0 ? <>Overall you owe <Amt minor={-mine} currency={group.currency} className="text-owe" /></> : "Overall you’re all square"}
                </p>
                {settleDayText && <p className="mt-0.5 text-xs text-gray-500">{settleDayText}</p>}
              </div>
              {settle && (
                <Link href={`/groups/${group.id}/settle`} className="pop shrink-0 bg-fg px-4 py-2.5 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
                  Settle up
                </Link>
              )}
            </div>
          </>
        )}
      </section>

      {rest.length > 0 && (
        <section>
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className={h2}>Coming up</h2>
            <Link href={`/groups/${group.id}?tab=bills`} className="hit text-sm text-gray-500">
              All bills
            </Link>
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {rest.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{b.name}</span>
                  <span className="block truncate text-xs text-gray-500">
                    {b.when} · {b.who}
                  </span>
                </span>
                {b.status === "enter" && b.href ? (
                  <Link href={b.href} className="shrink-0 border border-gray-300 px-3 py-2 text-sm font-semibold text-fg active:bg-mist rounded-full">
                    Enter amount
                  </Link>
                ) : b.status === "added" ? (
                  <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-gray-500">Added</span>
                ) : (
                  <span className="shrink-0 money tabular-nums">{b.amount}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {extras.insights && extras.insights.length > 0 && (
        <section>
          <h2 className={`${h2} mb-2.5`}>Heads up</h2>
          <ul className="space-y-2">
            {extras.insights.map((i) => (
              <li key={i.id} className={`${card} px-4 py-3.5 text-sm leading-relaxed`}>
                {i.text}
                {i.href && (
                  <Link href={i.href} className="ml-2 font-semibold text-fg underline underline-offset-4">
                    Review
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {couple && s.byCategory.length > 0 && (
        <section>
          <h2 className={`${h2} mb-3`}>Where it went</h2>
          <ul className="space-y-3 text-sm">
            {s.byCategory.slice(0, 6).map((c) => (
              <li key={c.id} className="grid grid-cols-[96px_1fr_84px] items-center gap-2.5">
                <span className="line-clamp-2 break-words leading-tight" data-category-name>{getCategory(c.id).short}</span>
                <span className="h-2 overflow-hidden rounded-full bg-mist">
                  <span className="block h-full rounded-full bg-gray-600" style={{ width: `${Math.max(2, Math.round((Math.max(0, c.amount) * 100) / Math.max(1, s.byCategory[0].amount)))}%` }} />
                </span>
                <span className="text-right money tabular-nums"><Amt minor={c.amount} currency={group.currency} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {extras.budgets && extras.budgets.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className={h2}>Budgets</h2>
            <Link href={`/groups/${group.id}/budgets`} className="text-sm text-gray-500">
              Edit
            </Link>
          </div>
          <ul className="space-y-4">
            {extras.budgets.map((b) => (
              <li key={b.category}>
                <div className="flex justify-between text-sm">
                  <span>{getCategory(b.category).label}</span>
                  <span>
                    <span className={`money tabular-nums ${b.level === "over" ? "text-owe" : ""}`}><span title={money(b.spent)} data-exact={money(b.spent)}>{overviewMoney(b.spent, group.currency)}</span></span>{" "}
                    <span className="text-gray-500">of {money(b.amount)}</span>
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist">
                  <div
                    className="h-full rounded-full bg-fg"
                    style={{ width: `${Math.min(100, Math.round((Math.max(0, b.spent) * 100) / Math.max(1, b.amount)))}%` }}
                  />
                </div>
                {b.level === "over" && (
                  <p className="mt-1.5 text-xs text-owe">
                    {overviewMoney(b.spent - b.amount, group.currency)} over{left > 0 ? `, with ${left} ${left === 1 ? "day" : "days"} to go` : ""}
                  </p>
                )}
                {b.level === "near" && <p className="mt-1.5 text-xs text-gray-500">{overviewMoney(b.amount - b.spent, group.currency)} left for the month</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(extras.forecast || extras.deposit) && (
        <div className="grid grid-cols-2 gap-2.5">
          {extras.forecast && (
            <div className={`${card} p-3.5`}>
              <p className="text-xs text-gray-500">Next month, about</p>
              <p className="mt-1 money text-[22px] font-semibold tabular-nums">{money(roundToWhole(extras.forecast.total, group.currency))}</p>
              <p className="mt-0.5 text-xs text-gray-500">Your share {money(roundToWhole(extras.forecast.mine, group.currency))}</p>
            </div>
          )}
          {extras.deposit && (
            <Link href={`/groups/${group.id}/deposit`} className={`${card} p-3.5 text-fg`}>
              <p className="text-xs text-gray-500">Deposit</p>
              <p className="mt-1 money text-[22px] font-semibold tabular-nums" title={money(extras.deposit.total)} data-exact={money(extras.deposit.total)}>{overviewMoney(extras.deposit.total, group.currency)}</p>
              <p className="mt-0.5 text-xs text-gray-500">Yours {overviewMoney(extras.deposit.mine, group.currency)}</p>
            </Link>
          )}
        </div>
      )}

      {extras.goals && extras.goals.length > 0 && (
        <section className="space-y-2.5">
          {extras.goals.map((g) => (
            <Link key={g.id} href={`/groups/${group.id}/goals/${g.id}`} className={`${card} block p-4 text-fg`}>
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">{g.name}</span>
                <span className="text-sm text-gray-500">{Math.min(100, Math.round((g.saved * 100) / Math.max(1, g.target)))}%</span>
              </div>
              <p className="mt-1 text-sm">
                <span className="money tabular-nums" title={money(g.saved)} data-exact={money(g.saved)}>{overviewMoney(g.saved, group.currency)}</span> <span className="text-gray-500">of {money(g.target)} set aside</span>
              </p>
              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-mist">
                <div className="h-full rounded-full bg-fg" style={{ width: `${Math.min(100, Math.round((g.saved * 100) / Math.max(1, g.target)))}%` }} />
              </div>
            </Link>
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <Link href={`/groups/${group.id}?tab=balances`} className="underline underline-offset-4">
          See who owes whom
        </Link>
        <Link href={`/groups/${group.id}?tab=charts`} className="underline underline-offset-4">
          Where the money went
        </Link>
        {(!extras.goals || extras.goals.length === 0) && (
          <Link href={`/groups/${group.id}/goals/new`} className="underline underline-offset-4">
            Start a savings goal
          </Link>
        )}
        {(!extras.budgets || extras.budgets.length === 0) && (
          <Link href={`/groups/${group.id}/budgets`} className="underline underline-offset-4">
            Set a budget
          </Link>
        )}
        {group.type === "home" && !extras.deposit && (
          <Link href={`/groups/${group.id}/deposit`} className="underline underline-offset-4">
            Add the deposit
          </Link>
        )}
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}
