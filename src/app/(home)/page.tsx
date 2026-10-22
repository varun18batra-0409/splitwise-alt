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

import { countAllUnread, loadDeletedGroups } from "@/lib/group-data";
import { loadOverview } from "@/lib/overview";
import { buildActivity, dayLabel } from "@/lib/activity";
import { decimalsOf, formatMoney } from "@/lib/money";
import { HomeBanner } from "@/components/HomeBanner";
import { GroupCover } from "@/components/GroupCover";
import { Polaroid } from "@/components/Polaroid";
import { coverFor, coverOf } from "@/lib/covers";
import { monthNumbers, seasonNow } from "@/lib/home/banner";
import { ActivityRow } from "@/components/ActivityRow";
import { itemHref } from "@/lib/paths";
import { restoreGroup } from "@/app/actions";
import { db } from "@/lib/db";
import { canUndo } from "@/lib/undo";
import { UndoBar } from "@/components/UndoBar";
import { PersonIcon, iconButtonClass } from "@/components/icons";
import { myCollections, progress } from "@/lib/collect";
import { tripPhase, type TripPhase } from "@/lib/countdown";
import { todayKey } from "@/lib/dates";
import { TripCountdown } from "@/components/TripCountdown";
import { TripRow } from "@/components/TripRow";

export const metadata = { alternates: { canonical: "/" } };

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
    collection?: string;
  }>;
}) {
  const { closed: justClosed, did, g: didGroup, undone, error, deleted, signedin, moved, collection } = await searchParams;
  const [tz, memberships] = await Promise.all([getTimeZone(), getMemberships()]);
  // Independent reads, all at once.
  const [overview, unread, deletedGroups, account, collections] = await Promise.all([
    loadOverview(memberships),
    getAccount().then((a) => countAllUnread(memberships, a?.id)),
    loadDeletedGroups(memberships),
    getAccount(),
    getAccount().then((a) => (a ? myCollections(a.id) : [])),
  ]);
  const { all, open, closed, owedLines, oweLines, common, netCommon, netLines, netValue, settleItems, toCommon } = overview;

  // Undo bar after a change made from the home screen (e.g. closing a group).
  let undoBar: { text: string; groupId: string; eventId: string } | null = null;
  if (did && didGroup && memberships[didGroup]) {
    const ev = await db.groupEvent.findFirst({ where: { id: did, groupId: didGroup } });
    // Only changes from then on matter for whether it can still be undone.
    const events = ev ? await db.groupEvent.findMany({ where: { groupId: didGroup, createdAt: { gte: ev.createdAt } } }) : [];
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
  type Attention = { key: string; text: React.ReactNode; sub?: string; amount?: string; lead: string; href: string; tone?: "owed" | "owe" };
  const attention: Attention[] = [
    ...settleItems
      .filter((it) => it.net < 0)
      .map((it) => ({ key: `owe-${it.key}`, lead: it.name, text: <>You owe <span className="font-semibold">{it.name}</span></>, sub: "Tap to settle up", amount: amt(it.net, it.converted), href: "/settle", tone: "owe" as const })),
    ...settleItems
      .filter((it) => it.net > 0)
      .map((it) => ({ key: `owed-${it.key}`, lead: it.name, text: <><span className="font-semibold">{it.name}</span> owes you</>, sub: "Nudge or record it", amount: amt(it.net, it.converted), href: "/settle", tone: "owed" as const })),
    ...(unread > 0 ? [{ key: "unread", lead: "bell", text: <>{unread > 9 ? "9+" : unread} new {unread === 1 ? "update" : "updates"}</>, sub: "In your groups and collections", href: "/notifications" }] : []),
    ...open
      .filter((g) => g.expenses.length > 0 && g.transfers.length === 0 && g.lastActivity.getTime() < quietSince)
      .map((g) => ({ key: `close-${g.group.id}`, lead: "check", text: <>Everyone’s square in <span className="font-semibold">{g.group.name}</span></>, sub: "Close it?", href: `/groups/${g.group.id}/settings#close` })),
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
        : collection === "deleted"
          ? "Collection deleted."
          : moved === "1"
          ? "Loopin has a new address: loopinapps.com. Everything came with you. Using the app icon on your home screen? It keeps working; to update it, add Loopin to your home screen again from this page."
          : signedin === "1"
          ? `Signed in${account ? ` as ${account.email}` : ""}. Your groups are saved to your email.`
          : null;

  // The sliding cards at the top: your month so far, and a seasonal nudge.
  // Your month across every group you're in (closed ones too: it was still your money), the same
  // way Insights counts it.
  const month = monthNumbers(
    all.map((g) => ({ currency: g.group.currency, myId: g.myId, expenses: g.expenses })),
    toCommon,
    common,
    new Date(),
    tz,
  );
  const region = visitorRegion(await headers());
  const season = seasonNow(new Date(), tz, region.country);
  const byActivity = [...open].sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  // The balance card's polaroids: the groups that make up most of your balance (then the latest).
  const single = open.length === 1;
  // The balance card's big number (all groups together, or per currency).
  const heroText = netCommon
    ? `${netCommon.converted ? "≈ " : ""}${netCommon.value > 0 ? "+" : netCommon.value < 0 ? "−" : ""}${formatMoney(Math.abs(netCommon.value), common)}`
    : netLines.join(" · ");
  // Trip countdowns: trips with a start day, happening now first, then the soonest (up to a year out).
  const today = todayKey(new Date(), tz);
  const trips = open
    .filter((g) => g.group.type === "trip" && g.group.tripStart)
    .map((g) => ({ g, phase: tripPhase(g.group.tripStart, g.group.tripEnd, today) }))
    .filter((t): t is { g: (typeof open)[number]; phase: TripPhase } => Boolean(t.phase) && t.phase!.kind !== "after" && (t.phase!.kind !== "before" || t.phase!.days <= 365))
    .sort(
      (a, b) =>
        (a.phase.kind === "before" ? a.phase.days : 0) - (b.phase.kind === "before" ? b.phase.days : 0) ||
        (a.g.group.tripEnd || a.g.group.tripStart).localeCompare(b.g.group.tripEnd || b.g.group.tripStart),
    );
  const byWeight = [...open].sort((a, b) => Math.abs(b.myBalance) - Math.abs(a.myBalance) || b.lastActivity.getTime() - a.lastActivity.getTime());
  // With one or two groups, shorter cards, so "Needs attention" shows without scrolling.
  const short = byActivity.length <= 2;

  // First visit: show what Loopin does instead of an empty screen.
  const tourSeen = (await cookies()).get("lp_tour")?.value === "1";
  if (all.length === 0 && deletedGroups.length === 0 && collections.length === 0 && !error && !notice && !tourSeen) return <IntroTour signInHref="/signin" currency={region.currency} india={region.india} />;

  return (
    <>
      {undoBar && <UndoBar key={undoBar.eventId} {...undoBar} back="home" redo={undone === "1"} />}
      {error && <Notice tone="error" params={["error"]} className="mb-4">{error}</Notice>}
      {notice && (
        <Notice params={["signedin", "moved", "deleted", "collection"]} className="mb-4">
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
            <div className="lp-rise grid grid-cols-2 gap-4 px-1 pt-1">
              {[
                ["trip", "Trip", "Goa trip"],
                ["home", "Flatmates", "Flat expenses"],
              ].map(([type, label, name], i) => (
                <Link
                  key={label}
                  href={`/groups/new?name=${encodeURIComponent(name)}&type=${type}`}
                  className={`lp-press block ${i === 0 ? "-rotate-[2deg]" : "rotate-[2deg]"} active:rotate-0`}
                >
                  <Polaroid cover={{ kind: coverOf({ type }) }} uid={`quick-${type}`} letter={label} caption={label} note="Start one ›" photoClass="h-[104px]" captionClass="text-[21px]" sizes="50vw" />
                </Link>
              ))}
            </div>
            <Link href="/add" className="mt-4 flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 active:bg-mist">
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
            <CollectTeaser className="mt-2" />
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

          {collections.length > 0 && <CollectionsSection list={collections} />}

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
            {/* Your balance, told by your groups: each polaroid is a group, with what it adds up to for you
                written under it — so where the number comes from is right there. */}
            <div className="relative flex h-[268px] flex-col overflow-hidden px-5 pb-12 pt-5 text-fg [background:radial-gradient(70%_80%_at_85%_30%,#3a2a1e_0%,transparent_70%),repeating-linear-gradient(45deg,rgba(244,241,232,0.035)_0_2px,transparent_2px_9px),repeating-linear-gradient(-45deg,rgba(244,241,232,0.03)_0_2px,transparent_2px_9px),linear-gradient(160deg,#211813_0%,#121014_75%)]">
              <div aria-hidden className="absolute inset-y-0 right-0 w-[62%]">
                {byWeight.slice(0, 3).map((g, i) => (
                  <Polaroid
                    key={g.group.id}
                    cover={coverFor(g.group)}
                    uid={`pol-${g.group.id}`}
                    letter={g.group.name}
                    caption={g.group.name}
                    note={g.myBalance > 0 ? `+${formatMoney(roundWhole(g.myBalance, g.group.currency), g.group.currency)}` : g.myBalance < 0 ? `−${formatMoney(roundWhole(g.myBalance, g.group.currency), g.group.currency)}` : "settled"}
                    noteTone={g.myBalance > 0 ? "owed" : g.myBalance < 0 ? "owe" : undefined}
                    // One group: a small keepsake, not a second copy of the big card below.
                    photoClass={single ? "h-[52px]" : "h-[74px]"}
                    captionClass={single ? "text-[14px]" : "text-[17px]"}
                    className={`lp-drop absolute ${single ? "w-[74px]" : "w-[100px]"} ${POLAROID_SPOTS[single ? 3 : i]}`}
                    style={{ animationDelay: `${i * 110}ms` }}
                    sizes="100px"
                  >
                    {i === 0 && <span className={`absolute -top-1 left-1/2 h-[12px] -translate-x-1/2 -rotate-[4deg] bg-[#e9d9b0]/75 shadow-sm ${single ? "w-[34px]" : "w-[46px]"}`} />}
                  </Polaroid>
                ))}
              </div>
              {/* Keeps the words readable where the photos slide under them. */}
              <div aria-hidden className="absolute inset-y-0 left-0 z-[5] w-[75%] bg-[linear-gradient(90deg,#17110e_0%,rgba(23,17,14,0.9)_50%,rgba(23,17,14,0)_100%)]" />
              {owedLines.length === 0 && oweLines.length === 0 ? (
                <>
                  <p className="relative z-10 text-sm text-fg/60">Across your groups</p>
                  <h1 className="relative z-10 mt-auto font-display text-[40px] font-semibold leading-none tracking-tight [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]">All square</h1>
                  <p className="relative z-10 mt-2 font-hand text-[22px] font-bold leading-none text-[#ffd9a8]">nobody owes anybody ✌︎</p>
                </>
              ) : (
                <>
                  <p className="relative z-10 text-sm text-fg/60">Net balance{netCommon && netCommon.converted ? ` · in ${common}` : ""}</p>
                  {/* The big number shrinks as it gets longer, so it never runs into the photos. */}
                  <h1
                    className={`relative z-10 mt-auto max-w-[60%] break-words font-display [text-shadow:0_2px_14px_rgba(0,0,0,0.7)] font-semibold leading-none tracking-tight tabular-nums ${
                      heroText.length <= 8 ? "text-[clamp(28px,9vw,36px)]" : heroText.length <= 10 ? "text-[clamp(24px,7.6vw,31px)]" : heroText.length <= 12 ? "text-[clamp(22px,6.6vw,27px)]" : "text-[22px]"
                    } ${netValue > 0 ? "text-owed" : netValue < 0 ? "text-owe" : ""}`}
                  >
                    {heroText}
                  </h1>
                  <p className="relative z-10 mt-1.5 max-w-[80%] font-hand text-[21px] font-bold leading-none text-[#ffd9a8] [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
                    {netValue > 0 ? "you get money back" : netValue < 0 ? "you need to pay" : "it all evens out"}
                    {open.filter((g) => g.myBalance !== 0).length > 1 ? `, from ${open.filter((g) => g.myBalance !== 0).length} groups` : ""}
                  </p>
                  {/* Everyone behind the number: tap to see the full list (Settle). */}
                  {settleItems.length > 0 && (
                    <Link
                      href="/settle"
                      aria-label={`Who: ${settleItems.map((it) => (it.net < 0 ? `you owe ${it.name} ${amt(it.net, it.converted)}` : `${it.name} owes you ${amt(it.net, it.converted)}`)).join("; ")}`}
                      className="relative z-10 mt-2.5 flex items-center self-start rounded-full py-0.5 pr-1 active:opacity-80"
                    >
                      {settleItems.slice(0, 4).map((it) => (
                        <span
                          key={it.key}
                          aria-hidden
                          className={`-mr-[6px] flex h-[24px] w-[24px] items-center justify-center rounded-full border-2 border-[#17110e] text-[10px] font-bold text-canvas ${it.net < 0 ? "bg-owe" : "bg-owed"}`}
                        >
                          {it.name.trim().charAt(0).toUpperCase()}
                        </span>
                      ))}
                      {settleItems.length > 4 && (
                        <span aria-hidden className="flex h-[24px] items-center rounded-full border-2 border-[#17110e] bg-fg px-1.5 text-[10px] font-bold text-canvas">
                          +{settleItems.length - 4}
                        </span>
                      )}
                      <span aria-hidden className="ml-3 text-xs text-fg/60">
                        {settleItems.length === 1 ? settleItems[0].name : `${settleItems.length} people`} ›
                      </span>
                    </Link>
                  )}
                </>
              )}
              {settleItems.length > 0 && (
                <Link href="/settle" className={`relative z-10 mt-3 ${bannerButton}`}>
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
                    <span className="block font-display text-[19px] font-semibold tabular-nums" data-month-share>
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

          {trips.length === 1 && (
            <div className="mt-6">
              <TripCountdown group={trips[0].g.group} phase={trips[0].phase} />
            </div>
          )}
          {/* More than one trip: one card at a time, swipe for the next (soonest first). */}
          {trips.length > 1 && (
            <section className="mt-6" aria-label="Your trips">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  Your trips <span className="ml-1 text-sm font-normal text-fg/40 tabular-nums">{trips.length}</span>
                </h2>
                <span className="text-xs text-fg/40">Swipe →</span>
              </div>
              <TripRow>
                {trips.map((t) => (
                  <TripCountdown key={t.g.group.id} group={t.g.group} phase={t.phase} />
                ))}
              </TripRow>
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
              <>
                {/* Up to 4 groups (most recently active first); the rest open with a tap, in the same grid. */}
                <ul className="lp-rise mt-4 grid grid-cols-2 gap-x-4 gap-y-6">
                  {byActivity.slice(0, 4).map((g, i) => (
                    <GroupCard key={g.group.id} g={g} tz={tz} short={short} i={i} wide={single} />
                  ))}
                  {byActivity.length > 1 && byActivity.length < 4 && byActivity.length % 2 === 1 && <StartTile short={short} />}
                </ul>
                {byActivity.length > 4 && (
                  <details className="group/more mt-5">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-gray-600 active:bg-mist [&::-webkit-details-marker]:hidden">
                      <span className="group-open/more:hidden">Show all {byActivity.length} groups</span>
                      <span className="hidden group-open/more:inline">Show fewer</span>
                    </summary>
                    <ul className="lp-rise mt-5 grid grid-cols-2 gap-x-4 gap-y-6">
                      {byActivity.slice(4).map((g, i) => (
                        <GroupCard key={g.group.id} g={g} tz={tz} short={short} i={i} />
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

          {collections.length > 0 ? <CollectionsSection list={collections} /> : <CollectTeaser className="mt-4" />}

          {/* Needs attention */}
          {attention.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">Needs attention</h2>
              <ul className="lp-rise overflow-hidden rounded-[20px] bg-white/[0.035] ring-1 ring-inset ring-line">
                {attention.map((a, n) => (
                  <li key={a.key} className={n ? "border-t border-line/70" : ""}>
                    <Link href={a.href} className="flex items-center gap-3.5 px-4 py-3.5 active:bg-mist">
                      <span
                        aria-hidden
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-[15px] font-semibold ${
                          a.tone === "owe" ? "bg-owe/[0.14] text-owe" : a.tone === "owed" ? "bg-owed/[0.14] text-owed" : "bg-fg/[0.07] text-fg/70"
                        }`}
                      >
                        {a.lead === "bell" ? (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
                        ) : a.lead === "check" ? (
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        ) : (
                          a.lead.trim().charAt(0).toUpperCase()
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] tracking-tight">{a.text}</span>
                        {a.sub && <span className="mt-0.5 block truncate text-[12px] text-fg/40">{a.sub}</span>}
                      </span>
                      {a.amount && (
                        <span className={`shrink-0 text-[15px] font-semibold tabular-nums tracking-tight ${a.tone === "owe" ? "text-owe" : "text-owed"}`}>{a.amount}</span>
                      )}
                      <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg/25"><path d="m9 18 6-6-6-6" /></svg>
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

// An open group on Home, as a polaroid: its picture (with who's in it), the
// name written underneath and your balance; tilted a little, alternately, like
// photos laid out on a table. Straightens when pressed.
function GroupCard({ g, tz, short, i = 0, wide }: { g: Awaited<ReturnType<typeof loadOverview>>["all"][number]; tz: string; short?: boolean; i?: number; wide?: boolean }) {
  const b = g.myBalance;
  const people = g.group.members.filter((m) => !m.leftAt);
  const type = TYPE_LABEL[g.group.type];
  // Your only group: one wide photo across the row (no empty "Start a group" box beside it).
  const photoH = wide ? 168 : short ? 118 : 150;
  return (
    <li className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <div className={`relative transition-transform duration-200 has-[a:active]:rotate-0 ${wide ? "-rotate-[0.8deg]" : i % 2 === 0 ? "-rotate-[1.4deg]" : "rotate-[1.6deg]"}`}>
        <Link href={`/groups/${g.group.id}`} className="lp-press block">
          <Polaroid
            cover={coverFor(g.group)}
            uid={g.group.id}
            letter={g.group.name}
            caption={g.group.name}
            note={b > 0 ? `owed ${formatMoney(b, g.group.currency)}` : b < 0 ? `owe ${formatMoney(-b, g.group.currency)}` : "settled"}
            noteTone={b > 0 ? "owed" : b < 0 ? "owe" : undefined}
            photoClass={wide ? "h-[168px]" : short ? "h-[118px]" : "h-[150px]"}
            captionClass={wide ? "text-[24px]" : "text-[21px]"}
            sizes={wide ? "(max-width: 448px) 100vw, 448px" : "(max-width: 448px) 50vw, 224px"}
          >
            {type && (
              <span className="absolute left-2 top-2 rounded-full bg-canvas/60 px-2.5 py-1 text-[11px] font-semibold text-fg backdrop-blur" aria-hidden>
                {type}
              </span>
            )}
          </Polaroid>
          <span className="mt-2 block truncate px-0.5 text-xs text-gray-400">
            {peopleCount(people.length)}, {activeText(g.lastActivity, tz)}
          </span>
        </Link>
        {/* Who's in it: tap the faces (or "+2") to see everyone and where each one stands. */}
        <Link
          href={`/groups/${g.group.id}/people`}
          aria-label={`Everyone in ${g.group.name}: ${people.map((m) => m.name).join(", ")}`}
          className="absolute left-[13px] flex rounded-full active:opacity-80"
          style={{ top: `${photoH - 27}px` }}
        >
          {people.slice(0, 4).map((m) => (
            <span key={m.id} aria-hidden className="-mr-[7px] flex h-[24px] w-[24px] items-center justify-center rounded-full border-2 border-canvas bg-gray-100 text-[10px] font-bold text-fg">
              {m.name.trim().charAt(0).toUpperCase()}
            </span>
          ))}
          {people.length > 4 && (
            <span aria-hidden className="flex h-[24px] items-center rounded-full border-2 border-canvas bg-gray-100 px-1.5 text-[10px] font-bold text-fg">
              +{people.length - 4}
            </span>
          )}
        </Link>
      </div>
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
        className={`lp-press flex ${short ? "h-[170px]" : "h-[202px]"} rotate-[1.6deg] flex-col items-center justify-center gap-2 border-[1.5px] border-dashed border-gray-300 text-sm font-medium text-gray-600 active:bg-mist`}
      >
        <span className="text-2xl leading-none" aria-hidden>
          ＋
        </span>
        Start a group
      </Link>
    </li>
  );
}

// Collect: the collections you're running (open first), each with how far along it is.
function CollectionsSection({ list }: { list: Awaited<ReturnType<typeof myCollections>> }) {
  return (
    <section className="mt-8" aria-label="Collections">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold tracking-tight">Collecting</h2>
        <Link href="/collect/new" className="text-sm text-gray-500">
          ＋ New
        </Link>
      </div>
      <ul className="lp-rise space-y-2">
        {list.slice(0, 6).map((c) => {
          const p = progress(c.entries, c.amount);
          const pct = p.target > 0 ? Math.min(100, Math.round((p.collected / p.target) * 100)) : p.people > 0 ? Math.round((p.paidCount / p.people) * 100) : 0;
          const toCheck = p.paidCount - p.checked;
          return (
            <li key={c.id}>
              <Link href={`/c/${c.code}`} className={`block rounded-2xl border border-line px-4 py-3.5 active:bg-mist ${c.closedAt ? "opacity-60" : ""}`}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15px] font-semibold">{c.title}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(p.collected, c.currency)}</span>
                </span>
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-fg/[0.08]">
                  <span className="lp-bar-x block h-full rounded-full bg-meter-up" style={{ width: `${Math.max(pct, p.paidCount ? 4 : 0)}%` }} />
                </span>
                <span className="mt-1.5 flex justify-between text-xs text-gray-400">
                  <span>
                    {c.closedAt ? "Closed · " : ""}
                    {p.paidCount} of {p.people || p.paidCount} paid
                  </span>
                  {toCheck > 0 && !c.closedAt && <span className="font-medium text-owed">{toCheck} to check</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// "Collect money": one small row inviting a first collection.
function CollectTeaser({ className = "" }: { className?: string }) {
  return (
    <Link href="/collect/new" className={`flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 active:bg-mist ${className}`}>
      <span className="text-xl" aria-hidden>
        🫙
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Collect money</span>
        <span className="block text-xs text-gray-400">One link for a gift, farewell or booking. See who’s paid.</span>
      </span>
      <span className="text-gray-400" aria-hidden>
        ›
      </span>
    </Link>
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

// Whole units for a small label (₹30,703 rather than ₹30,702.19).
function roundWhole(minor: number, currency: string): number {
  const unit = 10 ** decimalsOf(currency);
  return Math.round(Math.abs(minor) / unit) * unit;
}

// Where the balance card's polaroids land: scattered, a little off the edge, like on a table.
// The last spot is for when there's only one group.
const POLAROID_SPOTS = [
  "right-[-12px] top-[14px] rotate-[8deg] z-[3]",
  "right-[70px] top-[-22px] -rotate-[9deg] z-[2]",
  "right-[34px] top-[116px] -rotate-[5deg] z-[1]",
  "right-[22px] top-[22px] rotate-[9deg]",
];
