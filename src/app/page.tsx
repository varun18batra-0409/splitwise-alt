import Link from "next/link";
import { getMemberships } from "@/lib/identity";
import { loadMyGroups, loadNotifications } from "@/lib/group-data";
import { buildActivity, dayLabel } from "@/lib/activity";
import { formatMoney } from "@/lib/money";
import { BalanceMeter } from "@/components/BalanceMeter";
import { ActivityRow } from "@/components/ActivityRow";
import { primaryButtonClass } from "@/components/ui";

export default async function Home({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const { closed: justClosed } = await searchParams;
  const memberships = await getMemberships();
  const all = await loadMyGroups(memberships);
  const { unread } = await loadNotifications(memberships, 1);
  const open = all.filter((g) => !g.group.closed);
  const closed = all.filter((g) => g.group.closed);

  // Totals per currency across open groups (groups can use different currencies).
  const totals = new Map<string, { owed: number; owe: number }>();
  for (const g of open) {
    const t = totals.get(g.group.currency) ?? { owed: 0, owe: 0 };
    if (g.myBalance > 0) t.owed += g.myBalance;
    if (g.myBalance < 0) t.owe += -g.myBalance;
    totals.set(g.group.currency, t);
  }
  const owedLines = [...totals].filter(([, t]) => t.owed > 0).map(([c, t]) => formatMoney(t.owed, c));
  const oweLines = [...totals].filter(([, t]) => t.owe > 0).map(([c, t]) => formatMoney(t.owe, c));

  // The group where settling up matters most.
  const settleTarget = [...open].sort((a, b) => Math.abs(b.myBalance) - Math.abs(a.myBalance))[0];
  const hasDues = settleTarget && settleTarget.myBalance !== 0;

  // Recent activity across open groups.
  const recent = open
    .flatMap((g) => {
      const names = new Map(g.group.members.map((m) => [m.id, m.id === g.myId ? "You" : m.name]));
      return buildActivity(g.expenses, g.payments, g.myId).map((item) => ({
        item,
        currency: g.group.currency,
        groupName: g.group.name,
        nameOf: (id: string) => names.get(id) ?? "Someone",
      }));
    })
    .sort((a, b) => b.item.date.getTime() - a.item.date.getTime())
    .slice(0, 8);

  return (
    <>
      <header className="mb-6 flex items-center justify-between">
        <p className="font-display text-xl font-semibold tracking-tight">Split</p>
        <span className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{dayLabel(new Date())}</span>
          {all.length > 0 && (
            <Link
              href="/notifications"
              aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
              className="relative -mr-2 flex h-10 w-10 items-center justify-center rounded-full text-xl active:bg-gray-100"
            >
              <span aria-hidden>🔔</span>
              {unread > 0 && (
                <span className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-owe px-1 text-center text-[11px] font-semibold leading-[18px] text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          )}
        </span>
      </header>

      {all.length === 0 ? (
        <section className="lagoon-grid rounded-[28px] px-6 py-10 text-white">
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight">Split costs with your people.</h1>
          <p className="mt-3 text-white/60">Make a group for a trip, a flat or a dinner, then add what everyone spent.</p>
          <Link href="/groups/new" className="mt-8 block rounded-xl bg-white px-4 py-3.5 text-center font-semibold text-lagoon active:bg-white/90">
            Create your first group
          </Link>
        </section>
      ) : (
        <>
          {/* The balance panel */}
          <section className="lagoon-grid rounded-[28px] px-5 pb-6 pt-6 text-white">
            {owedLines.length === 0 && oweLines.length === 0 ? (
              <h1 className="font-display text-3xl font-semibold tracking-tight">You’re all square.</h1>
            ) : (
              <div className="space-y-1">
                {owedLines.length > 0 && (
                  <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight tabular-nums">
                    You’re owed <span className="text-[#5fd6ad]">{owedLines.join(" + ")}</span>
                  </h1>
                )}
                {oweLines.length > 0 && (
                  <p className={`font-display tabular-nums ${owedLines.length ? "text-lg text-white/80" : "text-[28px] font-semibold leading-tight tracking-tight"}`}>
                    You owe <span className="text-[#f0b768]">{oweLines.join(" + ")}</span>
                  </p>
                )}
              </div>
            )}

            {open.length > 0 && (
              <div className="mt-7">
                <BalanceMeter
                  tone="dark"
                  rows={open.map((g) => ({
                    key: g.group.id,
                    label: g.group.name,
                    value: g.myBalance,
                    currency: g.group.currency,
                    href: `/groups/${g.group.id}?tab=balances`,
                  }))}
                />
              </div>
            )}
          </section>

          {/* Shortcuts */}
          <nav className="mt-4 grid grid-cols-3 gap-2" aria-label="Shortcuts">
            <Shortcut href="/groups/new" icon="⊕" label="New group" />
            <Shortcut href="/add" icon="+" label="Add expense" />
            <Shortcut
              href={hasDues ? `/groups/${settleTarget.group.id}?tab=balances` : undefined}
              icon="⇄"
              label="Smart Settle"
              hint={hasDues ? settleTarget.group.name : "Nothing due"}
            />
          </nav>

          {/* Open groups */}
          <section className="mt-10">
            <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">Open groups</h2>
            {open.length === 0 ? (
              <p className="py-6 text-sm text-gray-500">No open groups. Create one, or reopen a closed group below.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {open.map((g) => (
                  <GroupRow key={g.group.id} g={g} />
                ))}
              </ul>
            )}

            {closed.length > 0 && (
              <details className="mt-3 group/closed" open={justClosed === "1"}>
                <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-gray-200 px-4 py-2 text-sm text-gray-600 active:bg-gray-50 [&::-webkit-details-marker]:hidden">
                  <span className="group-open/closed:hidden">Show closed groups ({closed.length})</span>
                  <span className="hidden group-open/closed:inline">Hide closed groups</span>
                </summary>
                <ul className="mt-2 divide-y divide-gray-100">
                  {closed.map((g) => (
                    <GroupRow key={g.group.id} g={g} closed />
                  ))}
                </ul>
              </details>
            )}
          </section>

          {/* Recent activity */}
          {recent.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-1 font-display text-lg font-semibold tracking-tight">Recent activity</h2>
              <ul className="divide-y divide-gray-100">
                {recent.map((r) => (
                  <li key={r.item.id}>
                    <ActivityRow item={r.item} currency={r.currency} nameOf={r.nameOf} groupName={`${r.groupName}, ${dayLabel(r.item.date)}`} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Link href="/groups/new" className={`mt-10 block ${primaryButtonClass}`}>
            Create a group
          </Link>
        </>
      )}
    </>
  );
}

function Shortcut({ href, icon, label, hint }: { href?: string; icon: string; label: string; hint?: string }) {
  const inner = (
    <>
      <span className="font-display text-xl leading-none text-accent-dark" aria-hidden>
        {icon}
      </span>
      <span className="mt-2 block text-sm font-medium">{label}</span>
      {hint && <span className="block truncate text-xs text-gray-400">{hint}</span>}
    </>
  );
  const cls = "block rounded-2xl border border-gray-100 bg-mist px-3 py-3.5";
  return href ? (
    <Link href={href} className={`${cls} active:bg-accent-soft`}>
      {inner}
    </Link>
  ) : (
    <span className={`${cls} opacity-60`} aria-disabled>
      {inner}
    </span>
  );
}

function GroupRow({
  g,
  closed,
}: {
  g: Awaited<ReturnType<typeof loadMyGroups>>[number];
  closed?: boolean;
}) {
  const b = g.myBalance;
  return (
    <li>
      <Link href={`/groups/${g.group.id}`} className="flex items-center gap-3 py-3.5 active:bg-gray-50">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display text-base font-semibold ${
            closed ? "bg-gray-100 text-gray-400" : "bg-accent-soft text-accent-dark"
          }`}
          aria-hidden
        >
          {g.group.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${closed ? "text-gray-500" : ""}`}>{g.group.name}</span>
          <span className="block truncate text-sm text-gray-400">
            {g.group.members.length} people, {closed ? "closed" : activeText(g.lastActivity)}
          </span>
        </span>
        <span className={`shrink-0 text-right text-sm tabular-nums ${b > 0 ? "text-accent-dark" : b < 0 ? "text-owe" : "text-gray-400"}`}>
          {b > 0 ? `owed ${formatMoney(b, g.group.currency)}` : b < 0 ? `owe ${formatMoney(-b, g.group.currency)}` : "settled"}
        </span>
      </Link>
    </li>
  );
}

function activeText(d: Date): string {
  const day = dayLabel(d);
  return day === "Today" || day === "Yesterday" ? `active ${day.toLowerCase()}` : `active ${day}`;
}
