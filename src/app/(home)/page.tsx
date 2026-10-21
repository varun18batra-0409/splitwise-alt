import Link from "@/components/Link";
import { InviteFriends } from "@/components/InviteFriends";
import { GetAppButton } from "@/components/GetApp";
import { Notice } from "@/components/Notice";
import { IntroTour } from "@/components/IntroTour";
import { JoinByLink } from "@/components/JoinByLink";
import { cookies, headers } from "next/headers";
import { visitorRegion } from "@/lib/region";
import { getTimeZone } from "@/lib/tz";
import { getAccount, getMemberships } from "@/lib/identity";
import { PasskeyOffer } from "@/components/Passkeys";

import { loadDeletedGroups, loadNotifications } from "@/lib/group-data";
import { loadOverview } from "@/lib/overview";
import { buildActivity, dayLabel } from "@/lib/activity";
import { formatMoney } from "@/lib/money";
import { HomeBanner } from "@/components/HomeBanner";
import { GroupCover } from "@/components/GroupCover";
import { coverFor, coverOf } from "@/lib/covers";
import { monthNumbers, seasonNow } from "@/lib/home/banner";
import { ActivityRow } from "@/components/ActivityRow";
import { itemHref } from "@/lib/paths";
import { restoreGroup } from "@/app/actions";
import { db } from "@/lib/db";
import { canUndo } from "@/lib/undo";
import { UndoBar } from "@/components/UndoBar";
import { PersonIcon, iconButtonClass } from "@/components/icons";

const countPasskeys = (accountId: string) => db.passkey.count({ where: { accountId } });

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
  const { all, open, closed, owedLines, oweLines, common, netCommon, netLines, netValue, settleItems, toCommon } = await loadOverview(memberships);
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

  // The sliding cards at the top: your month so far, and a seasonal nudge.
  const month = monthNumbers(
    open.map((g) => ({ currency: g.group.currency, myId: g.myId, expenses: g.expenses })),
    toCommon,
    common,
    new Date(),
    tz,
  );
  const region = visitorRegion(await headers());
  const season = seasonNow(new Date(), tz, region.country);
  const byActivity = [...open].sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  // With one or two groups, shorter cards, so "Needs attention" shows without scrolling.
  const short = byActivity.length <= 2;

  // First visit: show what Loopin does instead of an empty screen.
  const tourSeen = (await cookies()).get("lp_tour")?.value === "1";
  if (all.length === 0 && deletedGroups.length === 0 && !error && !notice && !tourSeen) return <IntroTour signInHref="/signin" currency={region.currency} india={region.india} />;

  return (
    <>
      {undoBar && <UndoBar key={undoBar.eventId} {...undoBar} back="home" redo={undone === "1"} />}
      {error && <Notice tone="error" params={["error"]} className="mb-4">{error}</Notice>}
      {notice && (
        <Notice params={["signedin", "moved", "deleted"]} className="mb-4">
          {notice}
        </Notice>
      )}
      {account && signedin === "1" && (await countPasskeys(account.id)) === 0 && <PasskeyOffer />}
      {justClosed === "1" && !undone && (
        <Notice params={["closed"]} className="mb-4">
          <span aria-hidden>🎉</span> Group closed. Find it under “Closed groups”.
          {closed.some((c) => c.group.id === didGroup && c.group.type === "trip") && (
            <>
              {" "}
              <Link href={`/groups/${didGroup}/report`} className="font-medium underline underline-offset-4">
                See the trip report
              </Link>
            </>
          )}
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
          <section className="overflow-hidden rounded-[24px] border border-line bg-white text-fg">
            <div className="relative h-[210px] overflow-hidden">
              <GroupCover kind={coverOf({ cover: "photo-friends", type: "other" })} uid="start" sizes="(max-width: 448px) 100vw, 448px" priority drift />
              <div aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(22,22,26,0)_35%,#16161a_100%)]" />
            </div>
            <div className="relative -mt-12 px-6 pb-6">
            <h1 className="font-display text-[30px] font-semibold leading-tight tracking-tight">Let’s get you started</h1>
            <p className="mt-2 text-fg/60">Split costs with friends, flatmates or your partner. Free, no ads.</p>
            <div className="mt-7 space-y-3">
              <Link href="/groups/new" className="pop block bg-fg px-4 py-3.5 text-center font-semibold text-canvas [--pop-edge:#6e6b63]">
                Create a group
              </Link>
              <JoinByLink />
            </div>
            </div>
          </section>

          <section className="mt-8">
            <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">Quick start</h2>
            <div className="lp-rise grid grid-cols-2 gap-3">
              {[
                ["trip", "Trip", "Goa trip"],
                ["home", "Flatmates", "Flat expenses"],
              ].map(([type, label, name]) => (
                <Link
                  key={label}
                  href={`/groups/new?name=${encodeURIComponent(name)}&type=${type}`}
                  className="lp-press relative block h-[124px] overflow-hidden rounded-[20px] border border-line"
                >
                  <GroupCover kind={coverOf({ type })} uid={`quick-${type}`} />
                  <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(13,13,15,0)_30%,rgba(13,13,15,0.85)_100%)]" />
                  <span className="absolute bottom-3 left-3.5 text-[15px] font-semibold">{label}</span>
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
                <span className="block text-sm font-medium">Coming from another app?</span>
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
          {/* The sliding cards: your balance, your month, a seasonal idea, bringing a group over. */}
          <HomeBanner>
            <div className="vault flex h-[268px] flex-col px-5 pb-12 pt-5 text-fg">
              <div aria-hidden className="absolute right-3 top-3 h-[64px] w-[96px]">
                {open.slice(0, 3).map((g, i) => (
                  <span
                    key={g.group.id}
                    className={`absolute h-[52px] w-[40px] overflow-hidden rounded-[3px] border-[2.5px] border-fg shadow-lg shadow-black/60 ${
                      ["right-[46px] top-1.5 -rotate-[9deg]", "right-[23px] top-0 rotate-[4deg]", "right-0 top-2 rotate-[13deg]"][i]
                    }`}
                  >
                    <GroupCover {...coverFor(g.group)} uid={`stack-${g.group.id}`} letter={g.group.name} small />
                  </span>
                ))}
              </div>
              {owedLines.length === 0 && oweLines.length === 0 ? (
                <>
                  <p className="text-sm text-fg/55">Across your groups</p>
                  <h1 className="mt-auto font-display text-[40px] font-semibold leading-none tracking-tight">All square 🎉</h1>
                  <p className="mt-2 text-sm text-fg/55">Nobody owes anybody. Nice.</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-fg/55">Net balance{netCommon && netCommon.converted ? ` · in ${common}` : ""}</p>
                  <h1
                    className={`mt-auto break-words font-display text-[clamp(26px,9vw,36px)] font-semibold leading-none tracking-tight tabular-nums ${
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
                  <p className="mt-1.5 text-sm text-fg/60">
                    {netValue > 0 ? "Overall, you get money back." : netValue < 0 ? "Overall, you need to pay." : "It all evens out."}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-fg/45">
                    You’re owed <span className="text-owed">{owedLines.length ? owedLines.join(" + ") : "—"}</span> · You owe{" "}
                    <span className="text-owe">{oweLines.length ? oweLines.join(" + ") : "—"}</span>
                  </p>
                </>
              )}
              {settleItems.length > 0 && (
                <Link href="/settle" className={`mt-3 ${bannerButton}`}>
                  Settle up
                </Link>
              )}
            </div>

            {month && (
              <div className="relative flex h-[268px] flex-col overflow-hidden bg-[radial-gradient(90%_90%_at_90%_10%,#4a2c16_0%,transparent_60%),linear-gradient(160deg,#24170f_0%,#121014_75%)] px-5 pb-12 pt-5">
                <p aria-hidden className="absolute -right-3 -top-6 font-display text-[150px] font-semibold leading-none text-fg/[0.06]">
                  {month.name.slice(0, 3)}
                </p>
                <p className="relative text-sm text-[#d9b38c]">{month.wrapped ? "Your month, wrapped" : "Your month so far"}</p>
                <p className="relative mt-1 font-display text-[27px] font-semibold leading-[1.1]">{month.name} in numbers</p>
                <div className="relative mt-auto flex gap-5">
                  <p>
                    <span className="block font-display text-[19px] font-semibold tabular-nums">
                      {month.converted ? "≈ " : ""}
                      {formatMoney(month.share, month.currency)}
                    </span>
                    <span className="block text-xs text-gray-600">your share</span>
                  </p>
                  <p>
                    <span className="block font-display text-[19px] font-semibold tabular-nums">{month.count}</span>
                    <span className="block text-xs text-gray-600">{month.count === 1 ? "expense" : "expenses"}</span>
                  </p>
                  {month.top && (
                    <p className="min-w-0">
                      <span className="block truncate font-display text-[19px] font-semibold">{month.top}</span>
                      <span className="block text-xs text-gray-600">most spent on</span>
                    </p>
                  )}
                </div>
                <Link href={`/search?m=${month.month}`} className={`relative mt-3 ${bannerButton}`}>
                  See {month.name}
                </Link>
              </div>
            )}

            {season && (
              <div className="relative flex h-[268px] flex-col overflow-hidden bg-[#120a10] px-5 pb-12 pt-5">
                <div className="absolute inset-y-0 left-[38%] w-[75%]">
                  <GroupCover kind={coverOf({ cover: season.cover })} uid={`season-${season.id}`} />
                </div>
                <div aria-hidden className="absolute inset-0 bg-[linear-gradient(90deg,#120a10_32%,rgba(18,10,16,0)_78%)]" />
                <p className="relative text-sm text-[#ffc93c]">{season.eyebrow}</p>
                <p className="relative mt-1 max-w-[62%] font-display text-[26px] font-semibold leading-[1.1]">{season.title}</p>
                <p className="relative mt-auto max-w-[58%] text-[13px] leading-snug text-gray-700">{season.text}</p>
                <Link href={season.href} className={`relative mt-3 ${bannerButton}`}>
                  {season.button}
                </Link>
              </div>
            )}

            {open.length <= 3 && (
              <div className="relative flex h-[268px] flex-col overflow-hidden bg-[radial-gradient(80%_90%_at_100%_100%,#17403a_0%,transparent_65%),linear-gradient(160deg,#10201f_0%,#0e1213_75%)] px-5 pb-12 pt-5">
                <div aria-hidden className="absolute right-7 top-7 flex h-[92px] w-[72px] -rotate-[10deg] flex-col gap-[7px] rounded-md bg-[#e9e5da] px-2.5 py-3 shadow-xl shadow-black/50">
                  <span className="h-1 rounded bg-[#b9b3a5]" />
                  <span className="h-1 w-2/3 rounded bg-[#b9b3a5]" />
                  <span className="h-1 rounded bg-[#b9b3a5]" />
                  <span className="h-1 w-1/2 rounded bg-[#b9b3a5]" />
                </div>
                <div aria-hidden className="absolute right-3 top-12 flex h-[92px] w-[72px] rotate-[8deg] flex-col gap-[7px] rounded-md bg-fg px-2.5 py-3 shadow-xl shadow-black/50">
                  <span className="h-1 rounded bg-[#c9c3b5]" />
                  <span className="h-1 w-3/5 rounded bg-[#c9c3b5]" />
                  <span className="h-1 rounded bg-[#c9c3b5]" />
                  <span className="mt-auto flex h-5 w-5 items-center justify-center self-end rounded-full bg-meter-up">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                </div>
                <p className="relative text-sm text-[#8fd9c4]">Switching to Loopin?</p>
                <p className="relative mt-1 max-w-[62%] font-display text-[26px] font-semibold leading-[1.1]">Coming from another app?</p>
                <p className="relative mt-auto max-w-[60%] text-[13px] leading-snug text-gray-700">Bring a group over in about a minute. Same balances.</p>
                <Link href="/switching" className={`relative mt-3 ${bannerButton}`}>
                  Bring a group over
                </Link>
              </div>
            )}
          </HomeBanner>

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
              <>
                {/* Up to 4 groups (most recently active first); the rest open with a tap, in the same grid. */}
                <ul className="lp-rise mt-3 grid grid-cols-2 gap-x-3 gap-y-5">
                  {byActivity.slice(0, 4).map((g) => (
                    <GroupCard key={g.group.id} g={g} tz={tz} short={short} />
                  ))}
                  {byActivity.length < 4 && byActivity.length % 2 === 1 && <StartTile short={short} />}
                </ul>
                {byActivity.length > 4 && (
                  <details className="group/more mt-5">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-gray-600 active:bg-mist [&::-webkit-details-marker]:hidden">
                      <span className="group-open/more:hidden">Show all {byActivity.length} groups</span>
                      <span className="hidden group-open/more:inline">Show fewer</span>
                    </summary>
                    <ul className="lp-rise mt-4 grid grid-cols-2 gap-x-3 gap-y-5">
                      {byActivity.slice(4).map((g) => (
                        <GroupCard key={g.group.id} g={g} tz={tz} short={short} />
                      ))}
                      {byActivity.length % 2 === 1 && <StartTile short={short} />}
                    </ul>
                  </details>
                )}
              </>
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

          {/* Needs attention */}
          {attention.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">Needs attention</h2>
              <ul className="lp-rise divide-y divide-line rounded-2xl border border-line">
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

      {/* Recently deleted groups: tucked away (like Closed groups) and opened with a tap;
          open on its own right after a delete. Anyone in them can bring them back for 30 days. */}
      {deletedGroups.length > 0 && (
        <details className="group/deleted mt-4" open={deleted === "group"}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-gray-600 active:bg-mist [&::-webkit-details-marker]:hidden">
            <span className="group-open/deleted:hidden">Recently deleted ({deletedGroups.length})</span>
            <span className="hidden group-open/deleted:inline">Hide recently deleted</span>
          </summary>
          <p className="mt-2 text-xs text-gray-400">Anyone in these groups can bring them back for 30 days.</p>
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
        </details>
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

      {all.length > 0 && <InviteFriends name={account?.name} className="mt-8" />}
      <GetAppButton variant="card" className="mt-3" />
      <p className="mt-8 text-center text-xs text-gray-400">
        <Link href="/faq" className="underline underline-offset-4">
          FAQ
        </Link>
        <span aria-hidden> · </span>
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy
        </Link>
        <span aria-hidden> · </span>
        <Link href="/terms" className="underline underline-offset-4">
          Terms
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
        <span className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-xl ${closed ? "opacity-50 grayscale" : ""}`} aria-hidden>
          <GroupCover {...coverFor(g.group)} uid={`row-${g.group.id}`} letter={g.group.name} letterClass="text-lg" sizes="44px" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${closed ? "text-gray-500" : ""}`}>{g.group.name}</span>
          <span className="block truncate text-sm text-gray-400">
            {peopleCount(g.group.members.filter((m) => !m.leftAt).length)}, {closed ? "closed" : activeText(g.lastActivity, tz)}
          </span>
        </span>
        <span className={`shrink-0 text-right text-sm tabular-nums ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-gray-400"}`}>
          {b > 0 ? `owed ${formatMoney(b, g.group.currency)}` : b < 0 ? `owe ${formatMoney(-b, g.group.currency)}` : "settled"}
        </span>
      </Link>
    </li>
  );
}

// An open group on Home: its picture (with who's in it), name and your balance.
function GroupCard({ g, tz, short }: { g: Awaited<ReturnType<typeof loadOverview>>["all"][number]; tz: string; short?: boolean }) {
  const b = g.myBalance;
  const people = g.group.members.filter((m) => !m.leftAt);
  const type = TYPE_LABEL[g.group.type];
  return (
    <li className="min-w-0">
      <Link href={`/groups/${g.group.id}`} className="lp-press block">
        <span className={`relative block overflow-hidden rounded-[20px] border border-line ${short ? "h-[140px]" : "h-[188px]"}`}>
          <GroupCover {...coverFor(g.group)} uid={g.group.id} letter={g.group.name} />
          {type && (
            <span className="absolute left-2.5 top-2.5 rounded-full bg-canvas/55 px-2.5 py-1 text-[11px] font-semibold backdrop-blur" aria-hidden>
              {type}
            </span>
          )}
          <span className="absolute bottom-2.5 left-2.5 flex" aria-hidden>
            {people.slice(0, 4).map((m) => (
              <span key={m.id} className="-mr-[7px] flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-canvas bg-gray-100 text-[11px] font-bold text-fg">
                {m.name.trim().charAt(0).toUpperCase()}
              </span>
            ))}
            {people.length > 4 && (
              <span className="flex h-[26px] items-center rounded-full border-2 border-canvas bg-gray-100 px-1.5 text-[10px] font-bold text-fg">+{people.length - 4}</span>
            )}
          </span>
        </span>
        <span className="mt-2.5 block truncate font-medium">{g.group.name}</span>
        <span className={`mt-0.5 block truncate text-sm tabular-nums ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-gray-400"}`}>
          {b > 0 ? `owed ${formatMoney(b, g.group.currency)}` : b < 0 ? `owe ${formatMoney(-b, g.group.currency)}` : "settled"}
        </span>
        <span className="block truncate text-xs text-gray-400">
          {peopleCount(people.length)}, {activeText(g.lastActivity, tz)}
        </span>
      </Link>
    </li>
  );
}

const TYPE_LABEL: Record<string, string | undefined> = { trip: "Trip", home: "Home", couple: "Couple" };

// "Start a group": only to fill an empty spot in the grid (New group is always at the top).
function StartTile({ short }: { short?: boolean }) {
  return (
    <li>
      <Link
        href="/groups/new"
        className={`lp-press flex ${short ? "h-[140px]" : "h-[188px]"} flex-col items-center justify-center gap-2 rounded-[20px] border-[1.5px] border-dashed border-gray-300 text-sm font-medium text-gray-600 active:bg-mist`}
      >
        <span className="text-2xl leading-none" aria-hidden>
          ＋
        </span>
        Start a group
      </Link>
    </li>
  );
}

// The pill-shaped buttons on the sliding cards.
const bannerButton =
  "inline-flex h-10 items-center self-start rounded-full border border-fg/25 bg-fg/[0.12] px-[18px] text-sm font-semibold text-fg backdrop-blur active:bg-fg/20";

function activeText(d: Date, tz: string): string {
  const day = dayLabel(d, new Date(), tz);
  return day === "Today" || day === "Yesterday" ? `active ${day.toLowerCase()}` : `active ${day}`;
}

const peopleCount = (n: number) => (n === 1 ? "1 person" : `${n} people`);
