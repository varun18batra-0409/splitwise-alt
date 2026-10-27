import Link from "@/components/Link";
import { getCategory } from "@/lib/categories";
import { daysLeft, monthKey } from "@/lib/home/month";
import { aheadBehind, monthSummary } from "@/lib/home/summary";
import type { GroupView } from "./view";

// Extra parts of This month that come from bills, budgets, goals, the deposit
// and insights (each section is hidden when it has nothing to show).
export type MonthExtras = {
  upcoming?: { id: string; name: string; icon: string; when: string; who: string; amount: string; status: "added" | "due" | "enter"; href?: string }[];
  insights?: { id: string; text: string; tone: "warn" | "info"; href?: string }[];
  budgets?: { category: string; spent: number; amount: number; level: "ok" | "near" | "over" }[];
  forecast?: { total: number; mine: number } | null;
  deposit?: { total: number; mine: number } | null;
  goals?: { id: string; name: string; saved: number; target: number }[];
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

  return (
    <div className="space-y-8">
      <section className="vault rounded-[24px] px-5 py-5">
        {couple ? (
          <>
            <p className="text-sm text-gray-500">{monthName} together</p>
            <p className="mt-1 money text-[40px] font-semibold leading-none tracking-tight tabular-nums">{money(s.total)}</p>
            {s.lastTotal > 0 && (
              <p className="mt-1.5 text-sm text-gray-500">
                {change <= 0 ? `${money(-change)} less than last month` : `${money(change)} more than last month`}
              </p>
            )}
            <div className="my-4 h-px bg-line" />
            <p className={`money text-[22px] font-semibold tabular-nums ${mine > 0 ? "text-owed" : mine < 0 ? "text-owe" : ""}`}>
              {aheadBehind(mine) === "ahead" ? `Overall you’re ${money(mine)} ahead` : aheadBehind(mine) === "behind" ? `Overall you’re ${money(-mine)} behind` : "You’re even"}
            </p>
            {s.total > 0 && (
              <>
                <p className="mt-1 text-xs text-gray-500">
                  This month you put in {money(s.paidByMe)}; your {agreed}% share is {money(s.mine)}
                  {s.paidByMe !== s.mine ? ` (${money(Math.abs(s.paidByMe - s.mine))} ${s.paidByMe > s.mine ? "ahead" : "behind"})` : ""}.
                </p>
                <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-mist" aria-hidden>
                  <div className="bg-fg" style={{ width: `${myPart}%` }} />
                  <div className="w-[2px] bg-canvas" />
                  <div className="flex-1 bg-[#6e6b63]" />
                </div>
                <div className="mt-1.5 flex justify-between text-xs text-gray-500">
                  <span>You {myPart}%</span>
                  <span>
                    Agreed {agreed} / {100 - agreed}
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
            <p className="mt-1 money text-[40px] font-semibold leading-none tracking-tight tabular-nums">{money(s.mine)}</p>
            <p className="mt-1.5 text-sm text-gray-500">of {money(s.total)} for the {group.type === "home" ? "home" : "group"} so far</p>
            <div className="my-4 h-px bg-line" />
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className={`money text-[22px] font-semibold tabular-nums ${mine > 0 ? "text-owed" : mine < 0 ? "text-owe" : ""}`}>
                  {mine > 0 ? `You’re owed ${money(mine)}` : mine < 0 ? `You owe ${money(-mine)}` : "All square"}
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

      {extras.upcoming && extras.upcoming.length > 0 && (
        <section>
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className={h2}>Coming up</h2>
            <Link href={`/groups/${group.id}?tab=bills`} className="text-sm text-gray-500">
              All bills
            </Link>
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {extras.upcoming.map((b) => (
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
                <span className="truncate">{getCategory(c.id).short}</span>
                <span className="h-2 overflow-hidden rounded-full bg-mist">
                  <span className="block h-full rounded-full bg-gray-600" style={{ width: `${Math.max(2, Math.round((Math.max(0, c.amount) * 100) / Math.max(1, s.byCategory[0].amount)))}%` }} />
                </span>
                <span className="text-right money tabular-nums">{money(c.amount)}</span>
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
                    <span className={`money tabular-nums ${b.level === "over" ? "text-owe" : ""}`}>{money(b.spent)}</span>{" "}
                    <span className="text-gray-500">of {money(b.amount)}</span>
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-mist">
                  <div
                    className={`h-full rounded-full ${b.level === "over" ? "bg-meter-down" : b.level === "near" ? "bg-[#d9a441]" : "bg-meter-up"}`}
                    style={{ width: `${Math.min(100, Math.round((Math.max(0, b.spent) * 100) / Math.max(1, b.amount)))}%` }}
                  />
                </div>
                {b.level === "over" && (
                  <p className="mt-1.5 text-xs text-owe">
                    {money(b.spent - b.amount)} over{left > 0 ? `, with ${left} ${left === 1 ? "day" : "days"} to go` : ""}
                  </p>
                )}
                {b.level === "near" && <p className="mt-1.5 text-xs text-gray-500">{money(b.amount - b.spent)} left for the month</p>}
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
              <p className="mt-1 money text-[22px] font-semibold tabular-nums">{money(Math.round(extras.forecast.total / 100) * 100)}</p>
              <p className="mt-0.5 text-xs text-gray-500">Your share {money(Math.round(extras.forecast.mine / 100) * 100)}</p>
            </div>
          )}
          {extras.deposit && (
            <Link href={`/groups/${group.id}/deposit`} className={`${card} p-3.5 text-fg`}>
              <p className="text-xs text-gray-500">Deposit</p>
              <p className="mt-1 money text-[22px] font-semibold tabular-nums">{money(extras.deposit.total)}</p>
              <p className="mt-0.5 text-xs text-gray-500">Yours {money(extras.deposit.mine)}</p>
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
                <span className="money tabular-nums">{money(g.saved)}</span> <span className="text-gray-500">of {money(g.target)} set aside</span>
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
