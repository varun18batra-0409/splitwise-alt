import Link from "@/components/Link";
import { GetAppButton } from "@/components/GetApp";
import { Notice } from "@/components/Notice";
import { IntroTour } from "@/components/IntroTour";
import { JoinByLink } from "@/components/JoinByLink";
import { cookies } from "next/headers";
import { getTimeZone } from "@/lib/tz";
import { getAccount, getMemberships } from "@/lib/identity";
import { loadDeletedGroups, loadNotifications } from "@/lib/group-data";
import { loadOverview } from "@/lib/overview";
import { buildActivity, dayLabel } from "@/lib/activity";
import { formatMoney } from "@/lib/money";
import { BalanceMeter } from "@/components/BalanceMeter";
import { ActivityRow } from "@/components/ActivityRow";
import { itemHref } from "@/lib/paths";
import { restoreGroup } from "@/app/actions";
import { db } from "@/lib/db";
import { canUndo } from "@/lib/undo";
import { UndoBar } from "@/components/UndoBar";
import { PersonIcon, iconButtonClass } from "@/components/icons";

// Home: your net balance, what needs your attention, your groups, and the
// latest changes. Search, Settle and Alerts live in the bottom bar.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    closed?: string;
    did?: string;
    g?: string;
    undone?: string;
    error?: string;
    deleted?: string;
    signedin?: string;
    moved?: string;
  }>;
}) {
  const { closed: justClosed, did, g: didGroup, undone, error, deleted, signedin, moved } = await searchParams;
  const tz = await getTimeZone();
  const memberships = await getMemberships();
  const { all, open, closed, owedLines, oweLines, common, netCommon, netLines, netValue, settleItems } = await loadOverview(memberships);
  const { unread } = await loadNotifications(memberships, 1);
  const deletedGroups = await loadDeletedGroups(memberships);
  const account = await getAccount();

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

  // Needs attention: money waiting on you or for you, new changes, and groups
  // that are all square and quiet (ready to close). At most four lines.
  const amt = (n: number, converted: boolean) => `${converted ? "≈ " : ""}${formatMoney(Math.abs(n), common)}`;
  const quietSince = Date.now() - 7 * 86_400_000;
  const attention: { key: string; text: React.ReactNode; href: string; tone?: "owed" | "owe" }[] = [
    ...settleItems
      .filter((it) => it.net < 0)
      .map((it) => ({ key: `owe-${it.key}`, text: <>You owe <strong className="font-medium">{it.name}</strong> {amt(it.net, it.converted)}</>, href: "/settle", tone: "owe" as const })),
    ...settleItems
      .filter((it) => it.net > 0)
      .map((it) => ({ key: `owed-${it.key}`, text: <><strong className="font-medium">{it.name}</strong> owes you {amt(it.net, it.converted)}</>, href: "/settle", tone: "owed" as const })),
    ...(unread > 0 ? [{ key: "unread", text: <>{unread > 9 ? "9+" : unread} new {unread === 1 ? "change" : "changes"} in your groups</>, href: "/notifications" }] : []),
    ...open
      .filter((g) => g.expenses.length > 0 && g.transfers.length === 0 && g.lastActivity.getTime() < quietSince)
      .map((g) => ({ key: `close-${g.group.id}`, text: <>Everyone’s square in <strong className="font-medium">{g.group.name}</strong>. Close it?</>, href: `/groups/${g.group.id}/settings#close` })),
  ].slice(0, 4);

  // The latest changes across open groups.
  const recent = open
    .flatMap((g) => {
      const names = new Map(g.group.members.map((m) => [m.id, m.id === g.myId ? "You" : m.name]));
      return buildActivity(g.expenses, g.payments, g.myId).map((item) => ({
        item,
        groupId: g.group.id,
        currency: g.group.currency,
        groupName: g.group.name,
        nameOf: (id: string) => names.get(id) ?? "Someone",
      }));
    })
    .sort((a, b) => b.item.date.getTime() - a.item.date.getTime())
    .slice(0, 5);

  const notice =
    deleted === "account"
      ? "Your email and sign-in were deleted. Your groups on this phone are still here."
      : deleted === "group"
        ? "Group deleted. Anyone in it can restore it below for 30 days."
        : moved === "1"
          ? "Loopin has a new address: loopinapps.com. Everything came with you. Using the app icon on your home screen? It keeps working; to update it, add Loopin to your home screen again from this page."
          : signedin === "1"
          ? `Signed in${account ? ` as ${account.email}` : ""}. Your groups are saved to your email.`
          : null;

  // First visit: show what Loopin does instead of an empty screen.
  const tourSeen = (await cookies()).get("lp_tour")?.value === "1";
  if (all.length === 0 && deletedGroups.length === 0 && !error && !notice && !tourSeen) return <IntroTour signInHref="/signin" />;

  return (
    <>
      {undoBar && <UndoBar key={undoBar.eventId} {...undoBar} back="home" redo={undone === "1"} />}
      {error && <Notice tone="error" params={["error"]} className="mb-4">{error}</Notice>}
      {notice && (
        <Notice params={["signedin", "moved", "deleted"]} className="mb-4">
          {notice}
        </Notice>
      )}
      {justClosed === "1" && !undone && (
        <Notice params={["closed"]} className="mb-4">
          <span aria-hidden>🎉</span> Group closed. Find it under “Closed groups”.
        </Notice>
      )}

      <header className="mb-8 flex items-center justify-between">
        <div>
          <p className="font-display text-[26px] font-semibold leading-none tracking-tight">loopin</p>
          <p className="mt-1.5 text-xs text-gray-400">Everyone’s in. Everything adds up.</p>
        </div>
        <div className="flex items-center gap-2">
          <GetAppButton variant="icon" />
          <Link href="/how-it-works" aria-label="How Loopin works" className={`${iconButtonClass} text-[17px] font-semibold`}>
            ?
          </Link>
          <Link href="/account" aria-label={account ? `Account: ${account.email}` : "Sign in or account"} className={`relative ${iconButtonClass}`}>
          <PersonIcon size={20} />
          {account && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-owed" aria-hidden />}
          </Link>
        </div>
      </header>

      {/* New here (one group or none, no expenses yet): a gentle pointer to the 1-minute tour. */}
      {open.length <= 1 && open.every((g) => g.expenses.length === 0) && (
        <Link href="/how-it-works" className="mb-6 flex items-center gap-3 rounded-2xl bg-mist px-4 py-3 text-sm active:bg-line">
          <span aria-hidden>👋</span>
          <span className="min-w-0 flex-1">
            New to Loopin? <span className="font-medium text-fg">See how it works</span> <span className="text-gray-400">· 1 min</span>
          </span>
          <span className="text-gray-400" aria-hidden>›</span>
        </Link>
      )}

      {all.length === 0 ? (
        <>
          {/* Start screen: nothing here yet. */}
          <section className="vault rounded-[24px] px-6 pb-6 pt-8 text-fg">
            <h1 className="font-display text-[30px] font-semibold leading-tight tracking-tight">Let’s get you started</h1>
            <p className="mt-2 text-fg/60">Split costs with friends, flatmates or your partner. No ads, no limits.</p>
            <div className="mt-7 space-y-3">
              <Link href="/groups/new" className="pop block bg-fg px-4 py-3.5 text-center font-semibold text-canvas [--pop-edge:#6e6b63]">
                Create a group
              </Link>
              <JoinByLink />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">Quick start</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["✈️", "Trip", "Goa trip"],
                ["🏠", "Flatmates", "Flat expenses"],
              ].map(([emoji, label, name]) => (
                <Link
                  key={label}
                  href={`/groups/new?name=${encodeURIComponent(name)}`}
                  className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 active:bg-mist"
                >
                  <span className="text-xl" aria-hidden>
                    {emoji}
                  </span>
                  <span className="text-sm font-medium">{label}</span>
                </Link>
              ))}
            </div>
            <Link href="/add" className="mt-2 flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 active:bg-mist">
              <span className="text-xl" aria-hidden>
                ＋
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Add an expense</span>
                <span className="block text-xs text-gray-400">We’ll make a group for it first</span>
              </span>
              <span className="text-gray-400" aria-hidden>
                ›
              </span>
            </Link>
            <Link href="/switching" className="mt-2 flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 active:bg-mist">
              <span className="text-xl" aria-hidden>
                📥
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Coming from Splitwise?</span>
                <span className="block text-xs text-gray-400">Bring your groups over, balances and all</span>
              </span>
              <span className="text-gray-400" aria-hidden>
                ›
              </span>
            </Link>
          </section>

          {!account && (
            <section className="mt-8 rounded-2xl border border-line px-4 py-4">
              <p className="text-sm font-medium">Already use Loopin, or want your groups on every phone?</p>
              <Link href="/signin" className="mt-3 block border border-line py-2.5 text-center text-sm font-semibold text-fg active:bg-mist">
                Sign in or sign up
              </Link>
              <p className="mt-2 text-xs text-gray-400">Optional. One step for both: Google or your email, no password.</p>
            </section>
          )}
        </>
      ) : (
        <>
          {/* The balance panel */}
          <section className="vault rounded-[24px] px-5 pb-6 pt-6 text-fg">
            {owedLines.length === 0 && oweLines.length === 0 ? (
              <>
                <p className="text-sm text-fg/55">Across your groups</p>
                <h1 className="mt-1 font-display text-[40px] font-semibold leading-none tracking-tight">All square 🎉</h1>
              </>
            ) : (
              <>
                <p className="text-sm text-fg/55">Net balance{netCommon && netCommon.converted ? ` · in ${common}` : ""}</p>
                <h1
                  className={`mt-1.5 font-display text-[44px] font-semibold leading-none tracking-tight tabular-nums ${
                    netValue > 0 ? "text-owed" : netValue < 0 ? "text-owe" : ""
                  }`}
                >
                  {netCommon ? (
                    <>
                      {netCommon.converted ? "≈ " : ""}
                      {netCommon.value > 0 ? "+" : netCommon.value < 0 ? "−" : ""}
                      {formatMoney(Math.abs(netCommon.value), common)}
                    </>
                  ) : (
                    netLines.join(" · ")
                  )}
                </h1>
                <p className="mt-1.5 text-sm text-fg/55">
                  {netValue > 0 ? "Overall, you get money back." : netValue < 0 ? "Overall, you need to pay." : "It all evens out."}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-fg/[0.04] px-3 py-2.5">
                    <p className="text-[11px] text-fg/45">You’re owed</p>
                    <p className="mt-0.5 font-display text-lg leading-tight text-owed tabular-nums">{owedLines.length ? owedLines.join(" + ") : "—"}</p>
                  </div>
                  <div className="rounded-xl bg-fg/[0.04] px-3 py-2.5">
                    <p className="text-[11px] text-fg/45">You owe</p>
                    <p className="mt-0.5 font-display text-lg leading-tight text-owe tabular-nums">{oweLines.length ? oweLines.join(" + ") : "—"}</p>
                  </div>
                </div>
              </>
            )}

            {open.length > 1 && (
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

          {/* Needs attention */}
          {attention.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">Needs attention</h2>
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {attention.map((a) => (
                  <li key={a.key}>
                    <Link href={a.href} className="flex items-center gap-3 px-4 py-3 text-sm active:bg-mist">
                      <span
                        aria-hidden
                        className={`h-2 w-2 shrink-0 rounded-full ${a.tone === "owe" ? "bg-owe" : a.tone === "owed" ? "bg-owed" : "bg-gray-400"}`}
                      />
                      <span className="min-w-0 flex-1">{a.text}</span>
                      <span className="text-gray-400" aria-hidden>
                        ›
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Groups */}
          <section className="mt-8">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold tracking-tight">Groups</h2>
              <Link href="/groups/new" className="pop flex items-center gap-1.5 bg-fg px-4 py-2 text-sm font-semibold text-canvas [--pop-edge:#6e6b63]">
                <span className="text-base leading-none" aria-hidden>
                  ＋
                </span>
                New group
              </Link>
            </div>
            {open.length === 0 ? (
              <p className="py-6 text-sm text-gray-500">No open groups. Create one, or reopen a closed one.</p>
            ) : (
              <ul className="divide-y divide-line">
                {open.map((g) => (
                  <GroupRow key={g.group.id} g={g} tz={tz} />
                ))}
              </ul>
            )}

            {closed.length > 0 && (
              <details className="group/closed mt-3" open={justClosed === "1"}>
                <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-gray-600 active:bg-mist [&::-webkit-details-marker]:hidden">
                  <span className="group-open/closed:hidden">Closed groups ({closed.length})</span>
                  <span className="hidden group-open/closed:inline">Hide closed groups</span>
                </summary>
                <ul className="mt-2 divide-y divide-line">
                  {closed.map((g) => (
                    <GroupRow key={g.group.id} g={g} closed tz={tz} />
                  ))}
                </ul>
              </details>
            )}
          </section>

          {/* Latest */}
          {recent.length > 0 && (
            <section className="mt-8">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold tracking-tight">Latest</h2>
                <Link href="/search" className="text-sm text-gray-500">
                  See all ›
                </Link>
              </div>
              <ul className="divide-y divide-line">
                {recent.map((r) => (
                  <li key={r.item.id}>
                    {/* Tap: opens it in its group, already expanded (details, Edit, Delete). */}
                    <Link href={itemHref(r.groupId, r.item)} className="block active:bg-mist">
                      <ActivityRow item={r.item} currency={r.currency} nameOf={r.nameOf} groupName={`${r.groupName}, ${dayLabel(r.item.date, new Date(), tz)}`} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* Recently deleted groups: anyone in them can bring them back for 30 days. */}
      {deletedGroups.length > 0 && (
        <Notice tone="plain" remember={`deleted:${deletedGroups.map((d) => d.id).join(",")}`} className="mt-8">
          <h2 className="mb-1 font-display text-lg font-semibold tracking-tight">Recently deleted</h2>
          <ul className="divide-y divide-line">
            {deletedGroups.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-500">{d.name}</span>
                  <span className="block truncate text-xs text-gray-400">
                    Deleted by {d.deletedBy} · gone in {d.daysLeft} {d.daysLeft === 1 ? "day" : "days"}
                  </span>
                </span>
                <form action={restoreGroup}>
                  <input type="hidden" name="groupId" value={d.id} />
                  <button type="submit" className="rounded-full border border-line px-3.5 py-1.5 text-sm font-medium text-fg active:bg-mist">
                    Restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      {/* Save groups to an email, so a new phone or the installed app can get them back. */}
      {!account && all.length > 0 && (
        <Link href="/signin" className="mt-8 flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 active:bg-mist">
          <PersonIcon size={20} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Sign up to save your groups</span>
            <span className="block text-xs text-gray-400">Get them back on a new phone.</span>
          </span>
          <span className="text-gray-400" aria-hidden>
            ›
          </span>
        </Link>
      )}

      <GetAppButton variant="card" className="mt-8" />
      <p className="mt-8 text-center text-xs text-gray-400">
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>
      </p>
    </>
  );
}

function GroupRow({ g, closed, tz }: { g: Awaited<ReturnType<typeof loadOverview>>["all"][number]; closed?: boolean; tz: string }) {
  const b = g.myBalance;
  return (
    <li>
      <Link href={`/groups/${g.group.id}`} className="flex items-center gap-3 py-3.5 active:bg-mist">
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
            {g.group.members.filter((m) => !m.leftAt).length} people, {closed ? "closed" : activeText(g.lastActivity, tz)}
          </span>
        </span>
        <span className={`shrink-0 text-right text-sm tabular-nums ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-gray-400"}`}>
          {b > 0 ? `owed ${formatMoney(b, g.group.currency)}` : b < 0 ? `owe ${formatMoney(-b, g.group.currency)}` : "settled"}
        </span>
      </Link>
    </li>
  );
}

function activeText(d: Date, tz: string): string {
  const day = dayLabel(d, new Date(), tz);
  return day === "Today" || day === "Yesterday" ? `active ${day.toLowerCase()}` : `active ${day}`;
}
