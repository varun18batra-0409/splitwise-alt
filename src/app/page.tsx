import Link from "next/link";
import { InstallButton } from "@/components/InstallButton";
import { getMemberships } from "@/lib/identity";
import { loadMyGroups, loadNotifications } from "@/lib/group-data";
import { buildActivity, dayLabel } from "@/lib/activity";
import { formatMoney } from "@/lib/money";
import { BalanceMeter } from "@/components/BalanceMeter";
import { ActivityRow } from "@/components/ActivityRow";
import { primaryButtonClass } from "@/components/ui";
import { crossSettle } from "@/lib/cross-settle";
import { convertAmount } from "@/lib/conversion";
import { getRate } from "@/lib/rate-cache";
import { settleAcrossGroups } from "@/app/actions";
import { db } from "@/lib/db";
import { canUndo } from "@/lib/undo";
import { UndoBar } from "@/components/UndoBar";
import { BellIcon, GroupIcon, SettleIcon, iconButtonClass } from "@/components/icons";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string; settle?: string; did?: string; g?: string; undone?: string; error?: string }>;
}) {
  const { closed: justClosed, settle: settleNotice, did, g: didGroup, undone, error } = await searchParams;
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

  // Smart Settle across groups, shown in the most used group currency.
  const currencyCount = new Map<string, number>();
  for (const g of open) currencyCount.set(g.group.currency, (currencyCount.get(g.group.currency) ?? 0) + 1);
  const common = [...currencyCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? all[0]?.group.currency ?? "INR";
  const rates = new Map<string, string | null>();
  for (const cur of new Set(all.map((g) => g.group.currency))) {
    if (cur === common) continue;
    const r = await getRate(cur, common);
    rates.set(cur, r.ok ? r.rate : null);
  }
  const { items: settleItems, skippedGroups } = crossSettle(
    all.map((g) => ({
      groupId: g.group.id,
      groupName: g.group.name,
      currency: g.group.currency,
      myId: g.myId,
      members: g.group.members,
      transfers: g.transfers,
    })),
    common,
    (amount, cur) => {
      const rate = rates.get(cur);
      return rate ? convertAmount(amount, cur, common, rate) : null;
    },
  );
  // Undo bar after a change made from the home screen (e.g. closing a group).
  let undoBar: { text: string; groupId: string; eventId: string } | null = null;
  if (did && didGroup && memberships[didGroup]) {
    const events = await db.groupEvent.findMany({ where: { groupId: didGroup } });
    const ev = events.find((e) => e.id === did);
    if (ev && canUndo(ev, events).ok) {
      const grp = all.find((x) => x.group.id === didGroup);
      const actor = ev.actorId === memberships[didGroup] ? "You" : grp?.group.members.find((m) => m.id === ev.actorId)?.name ?? "Someone";
      undoBar = { text: undone ? "Undone." : `${actor} ${ev.text}${grp ? ` · ${grp.group.name}` : ""}`, groupId: didGroup, eventId: ev.id };
    }
  }

  // Groups where other people still need to settle with each other.
  const othersPending = all.filter((g) => g.transfers.some((t) => t.from !== g.myId && t.to !== g.myId));

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
      {undoBar && <UndoBar key={undoBar.eventId} {...undoBar} back="home" redo={undone === "1"} />}
      {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="font-display text-[26px] font-semibold leading-none tracking-tight">split</p>
          <p className="mt-1.5 text-xs text-gray-400">{dayLabel(new Date())}</p>
        </div>
        {all.length > 0 && (
          <Link href="/notifications" aria-label={unread ? `Notifications, ${unread} new` : "Notifications"} className={`relative ${iconButtonClass}`}>
            <BellIcon size={20} />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-fg px-1 text-center text-[10px] font-semibold leading-[18px] text-canvas tabular-nums">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
        )}
      </header>

      {all.length === 0 ? (
        <section className="vault rounded-[24px] px-6 py-10 text-fg">
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight">Split costs with your people.</h1>
          <p className="mt-3 text-fg/60">Make a group for a trip, a flat or a dinner, then add what everyone spent.</p>
          <Link href="/groups/new" className="pop mt-8 block bg-fg px-4 py-3.5 text-center font-semibold text-canvas [--pop-edge:#6e6b63]">
            Create your first group
          </Link>
        </section>
      ) : (
        <>
          {/* The balance panel */}
          <section className="vault rounded-[24px] px-5 pb-6 pt-6 text-fg">
            {owedLines.length === 0 && oweLines.length === 0 ? (
              <>
                <p className="text-sm text-fg/55">Across your groups</p>
                <h1 className="mt-1 font-display text-[40px] font-semibold leading-none tracking-tight">All square</h1>
              </>
            ) : (
              <>
                <p className="text-sm text-fg/55">{owedLines.length > 0 ? "You’re owed" : "You owe"}</p>
                <h1
                  className={`mt-1.5 font-display text-[44px] font-semibold leading-none tracking-tight tabular-nums ${
                    owedLines.length > 0 ? "text-owed" : "text-owe"
                  }`}
                >
                  {(owedLines.length > 0 ? owedLines : oweLines).join(" + ")}
                </h1>
                {owedLines.length > 0 && oweLines.length > 0 && (
                  <p className="mt-3 text-sm text-fg/60">
                    You owe <span className="font-display text-base text-owe tabular-nums">{oweLines.join(" + ")}</span>
                  </p>
                )}
              </>
            )}

            {open.length > 0 && (
              <div className="mt-7 border-t border-fg/10 pt-6">
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
          <nav className="mt-3 grid grid-cols-2 gap-2" aria-label="Shortcuts">
            <Shortcut href="/groups/new" icon={<GroupIcon />} label="New group" />
            <Shortcut
              href="#settle"
              icon={<SettleIcon />}
              label="Smart Settle"
              hint={settleItems.length ? `${settleItems.length} ${settleItems.length === 1 ? "person" : "people"}` : "All settled"}
            />
          </nav>

          {/* Smart Settle across groups */}
          <section id="settle" className="mt-10 scroll-mt-6">
            <h2 className="font-display text-lg font-semibold tracking-tight">Smart Settle</h2>
            <p className="mb-4 text-sm text-gray-500">
              One payment per person, combining everything you owe each other across your groups.
            </p>
            {settleNotice === "done" && <p className="mb-3 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent-dark">Recorded in each group. Balances updated and everyone notified.</p>}
            {settleNotice === "changed" && <p className="mb-3 rounded-xl bg-owe-soft px-4 py-3 text-sm text-owe">Balances changed since you opened this page. Here’s the updated version.</p>}
            {settleNotice === "error" && <p className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Couldn’t record that. Try again.</p>}

            {settleItems.length === 0 ? (
              <p className="rounded-2xl bg-mist px-4 py-6 text-center text-sm text-gray-600">You’re settled up with everyone.</p>
            ) : (
              <ul className="space-y-2">
                {settleItems.map((it) => {
                  const amt = (n: number) => `${it.converted ? "≈ " : ""}${formatMoney(Math.abs(n), common)}`;
                  return (
                    <li key={it.key} className="rounded-2xl border border-gray-100 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="min-w-0 text-sm">
                          {it.net < 0 ? (
                            <>You pay <strong className="font-medium">{it.name}</strong></>
                          ) : it.net > 0 ? (
                            <><strong className="font-medium">{it.name}</strong> pays you</>
                          ) : (
                            <>You and <strong className="font-medium">{it.name}</strong> are even</>
                          )}
                        </p>
                        <p className={`shrink-0 font-display font-semibold tabular-nums ${it.net < 0 ? "text-owe" : it.net > 0 ? "text-owed" : "text-gray-400"}`}>
                          {it.net === 0 ? "—" : amt(it.net)}
                        </p>
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-xs text-gray-500">
                        {it.parts.map((p) => (
                          <li key={`${p.groupId}-${p.fromId}-${p.toId}`}>
                            {p.groupName}: {p.iPay ? `you pay ${formatMoney(p.amount, p.currency)}` : `${it.name} pays you ${formatMoney(p.amount, p.currency)}`}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <span className="text-xs text-gray-400">
                          {it.parts.length > 1 ? `1 payment instead of ${it.parts.length}` : ""}
                        </span>
                        <form action={settleAcrossGroups}>
                          <input
                            type="hidden"
                            name="parts"
                            value={JSON.stringify(it.parts.map((p) => ({ groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount })))}
                          />
                          <button type="submit" className="border border-line px-3 py-1.5 text-sm font-medium text-fg active:bg-mist">
                            Mark as paid
                          </button>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {skippedGroups.length > 0 && (
              <p className="mt-2 text-xs text-gray-400">No exchange rate right now for {skippedGroups.join(", ")}, so settle those inside the group.</p>
            )}
            {othersPending.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-sm text-gray-500">Others still settling up between themselves:</p>
                <ul className="flex flex-wrap gap-2">
                  {othersPending.map((g) => (
                    <li key={g.group.id}>
                      <Link href={`/groups/${g.group.id}?tab=balances`} className="inline-block rounded-full border border-gray-200 px-3 py-1.5 text-sm active:bg-gray-50">
                        {g.group.name} · {g.transfers.length} {g.transfers.length === 1 ? "payment" : "payments"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 text-xs text-gray-400">“Mark as paid” only records it. The app never moves real money.</p>
          </section>

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
        </>
      )}
      <InstallButton />
    </>
  );
}

function Shortcut({ href, icon, label, hint }: { href?: string; icon: React.ReactNode; label: string; hint?: string }) {
  const inner = (
    <>
      <span className="text-gray-700">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block truncate text-xs text-gray-400">{hint}</span>}
      </span>
    </>
  );
  const cls = "flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3.5";
  return href ? (
    <Link href={href} className={`${cls} active:bg-mist`}>
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
            closed ? "bg-gray-50 text-gray-400" : "bg-mist text-fg"
          }`}
          aria-hidden
        >
          {g.group.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${closed ? "text-gray-500" : ""}`}>{g.group.name}</span>
          <span className="block truncate text-sm text-gray-400">
            {g.group.members.filter((m) => !m.leftAt).length} people, {closed ? "closed" : activeText(g.lastActivity)}
          </span>
        </span>
        <span className={`shrink-0 text-right text-sm tabular-nums ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-gray-400"}`}>
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
