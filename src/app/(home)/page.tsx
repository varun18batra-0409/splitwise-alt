import Link from "@/components/Link";
import { InviteFriends } from "@/components/InviteFriends";
import { GetAppButton } from "@/components/GetApp";
import { PhoneOnlyNote } from "@/components/PhoneOnlyNote";
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
import { loadInvitations } from "@/lib/invitations";
import { InvitationCard } from "@/components/InvitationCard";
import { buildActivity, dayLabel } from "@/lib/activity";
import { formatMoney } from "@/lib/money";
import { HomeBanner } from "@/components/HomeBanner";
import { HighlightCard } from "@/components/HighlightCard";
import { homeHighlights } from "@/lib/home/highlights";
import { usesFahrenheit } from "@/lib/climate";
import { parseHandPlaces } from "@/lib/passport";
import { nextDueDay } from "@/lib/home/bills";
import { GroupCover } from "@/components/GroupCover";
import { Polaroid } from "@/components/Polaroid";
import { coverFor, coverOf } from "@/lib/covers";
import { monthNumbers, seasonNow } from "@/lib/home/banner";
import { ActivityRow } from "@/components/ActivityRow";
import { itemHref } from "@/lib/paths";
import { restoreGroup } from "@/app/actions";
import { db } from "@/lib/db";
import { leaverOf } from "@/lib/left-view-db";
import { gameVisible, stillIn } from "@/lib/left-view";
import { canUndo } from "@/lib/undo";
import { UndoBar } from "@/components/UndoBar";
import { PersonIcon, iconButtonClass } from "@/components/icons";
import { myCollections, progress } from "@/lib/collect";
import { countdownWords, placeOf, tripPhase, type TripPhase } from "@/lib/countdown";
import { todayKey } from "@/lib/dates";
import { TripCountdown } from "@/components/TripCountdown";
import { countdownStage } from "@/lib/countdown";
import { countryOf, tripStops } from "@/lib/geo";
import { MoneyCard, TripStrip } from "@/components/HomeMoney";
import { moneyLead, moneyMode, moneySub } from "@/lib/home/money-card";
import { TripRow } from "@/components/TripRow";
import { Stories } from "@/components/Stories";
import { buildStories } from "@/lib/home/stories";
import { placePhoto, placePhotos } from "@/lib/places";
import { tripEmoji } from "@/lib/countdown";
import { payersOf, spentAmount } from "@/lib/payers";
import { getCategory } from "@/lib/categories";
import { daysBetween } from "@/lib/countdown";
import { parsePlayers, potSummary } from "@/lib/pot";

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
  const [overview, unread, deletedGroups, account, collections, invitations] = await Promise.all([
    loadOverview(memberships),
    getAccount().then((a) => countAllUnread(memberships, a?.id)),
    loadDeletedGroups(memberships),
    getAccount(),
    getAccount().then((a) => (a ? myCollections(a.id) : [])),
    // Groups someone added you to, waiting for Join or Not now.
    getAccount().then((a) => loadInvitations(a)),
  ]);
  const { all, open, closed, owedLines, oweLines, common, netCommon, netLines, netValue, settleItems, toCommon } = overview;

  // Undo bar after a change made from the home screen (e.g. closing a group).
  let undoBar: { text: string; groupId: string; eventId: string } | null = null;
  if (did && didGroup && memberships[didGroup] && !(await leaverOf(memberships[didGroup]))) {
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
      .filter((g) => !g.leaver && g.expenses.length > 0 && g.transfers.length === 0 && g.lastActivity.getTime() < quietSince)
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
        ? "Group deleted. You can restore it below for 30 days."
        : deleted === "gone"
          ? "That group was deleted. If you started it or look after it, you can restore it below for 30 days."
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
  // Stories about how a group is now (countdown, a year ago, just back, wrapped, hero) skip groups the viewer left.
  const live = stillIn(open);
  const byActivity = [...live].sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  // The balance card's big number (all groups together, or per currency).
  const heroText = netCommon
    ? `${netCommon.converted ? "≈ " : ""}${netCommon.value > 0 ? "+" : netCommon.value < 0 ? "−" : ""}${formatMoney(Math.abs(netCommon.value), common)}`
    : netLines.join(" · ");
  const mode = moneyMode({ owedLines: owedLines.length, oweLines: oweLines.length, netValue });
  // Someone added you to a group: it isn't in your groups until you tap Join.
  const invitationsBlock =
    invitations.length > 0 ? (
      <div className="mb-6 mt-5 space-y-3" data-invitations>
        {invitations.map((inv) => (
          <InvitationCard key={inv.key} inv={inv} />
        ))}
      </div>
    ) : null;
  // Trip countdowns: trips with a start day, happening now first, then the soonest (up to a year out).
  const today = todayKey(new Date(), tz);
  const trips = live
    .filter((g) => g.group.type === "trip" && g.group.tripStart)
    .map((g) => ({ g, phase: tripPhase(g.group.tripStart, g.group.tripEnd, today) }))
    .filter((t): t is { g: (typeof open)[number]; phase: TripPhase } => Boolean(t.phase) && t.phase!.kind !== "after" && (t.phase!.kind !== "before" || t.phase!.days <= 365))
    .sort(
      (a, b) =>
        (a.phase.kind === "before" ? a.phase.days : 0) - (b.phase.kind === "before" ? b.phase.days : 0) ||
        (a.g.group.tripEnd || a.g.group.tripStart).localeCompare(b.g.group.tripEnd || b.g.group.tripStart),
    );
  // Stories: the moments in your groups (a trip coming up, last night's game,
  // a group that just got square, a collection filling up, a year ago today).
  const potIds = open.filter((g) => g.group.type === "pot").map((g) => g.group.id);
  const gameRows = potIds.length
    ? await db.potGame.findMany({ where: { groupId: { in: potIds }, status: "done", deletedAt: null, finishedAt: { gte: new Date(Date.now() - 3 * 86_400_000) } }, include: { moves: { where: { deletedAt: null } } }, take: 10 })
    : [];
  // Games played after someone left the group aren't theirs to see.
  const games = gameRows.filter((gm) => gameVisible(open.find((x) => x.group.id === gm.groupId)?.leaver ?? null, gm));
  // What each story shows: the place's photos, the crew, today's numbers, a game's table.
  const first = (n: string) => n.trim().split(/\s+/)[0] || n;
  const crewOf = (g: (typeof open)[number]) => g.group.members.filter((m) => !m.leftAt).map((m) => (m.id === g.myId ? "You" : first(m.name)));
  const moodOf = (name: string) => {
    const e = tripEmoji(name);
    return e === "🌴" ? "beach" : e === "🏔️" || e === "❄️" || e === "🏕️" ? "hills" : e === "🌆" ? "city" : "any";
  };
  const dayOf = (d: Date) => todayKey(d, tz);
  const todayIn = (g: (typeof open)[number]) => {
    const list = g.expenses.filter((e) => e.kind !== "pot" && e.kind !== "refund" && dayOf(e.spentAt ?? e.createdAt) === today);
    if (!list.length) return { spent: "", count: 0 };
    const money = (n: number) => formatMoney(n, g.group.currency);
    const paid = new Map<string, number>();
    for (const e of list) for (const p of payersOf(e)) paid.set(p.memberId, (paid.get(p.memberId) ?? 0) + p.amount);
    const [topId] = [...paid].sort((a, b) => b[1] - a[1])[0] ?? [""];
    const topName = topId === g.myId ? "You" : first(g.group.members.find((m) => m.id === topId)?.name ?? "");
    const big = [...list].sort((a, b) => b.amount - a.amount)[0];
    return { spent: money(list.reduce((t, e) => t + spentAmount(e), 0)), count: list.length, top: list.length > 1 && topName ? topName : undefined, biggest: list.length > 1 ? { what: big.description, amount: money(big.amount) } : undefined };
  };
  const gameDetails = await Promise.all(
    games.map(async (gm) => {
      const grp = open.find((x) => x.group.id === gm.groupId)!;
      const { lines } = potSummary(parsePlayers(gm.players), gm.moves);
      const name = (id: string) => (id === grp.myId ? "You" : first(grp.group.members.find((m) => m.id === id)?.name ?? "Someone"));
      const money = (n: number) => formatMoney(n, grp.group.currency);
      const max = Math.max(1, ...lines.map((l) => Math.abs(l.net)));
      const { gameSettlement } = await import("@/lib/pot-db");
      const st = await gameSettlement(gm.groupId, gm).catch(() => null);
      const left = st ? st.transfers.reduce((t, x) => t + x.left, 0) : 0;
      return {
        table: [...lines].sort((a, b) => b.net - a.net).map((l) => ({ name: name(l.memberId), net: `${l.net > 0 ? "+" : l.net < 0 ? "−" : ""}${money(Math.abs(l.net))}`, up: l.net >= 0, even: l.net === 0, share: Math.abs(l.net) / max })),
        pays: (st?.transfers ?? []).filter((t) => t.left > 0).map((t) => `${name(t.from)} → ${name(t.to)}  ${money(t.left)}`),
        toSettle: left > 0 ? money(left) : undefined,
      };
    }),
  );
  const stories = buildStories({
    now: new Date(),
    trips: trips.map((t) => ({
      id: t.g.group.id,
      name: t.g.group.name,
      phase: t.phase,
      photos: placePhotos(t.g.group.name, t.g.group.tripPlace),
      cover: coverFor(t.g.group),
      people: t.g.group.members.filter((m) => !m.leftAt).length,
      crew: crewOf(t.g),
      mood: moodOf(t.g.group.name),
      month: t.g.group.tripStart ? Number(t.g.group.tripStart.slice(5, 7)) - 1 : undefined,
      stop: (() => {
        const st = tripStops(t.g.group.name, t.g.group.tripPlace ?? "", t.g.group.tripCountry ?? "")[0];
        const c = st?.country ? countryOf(st.country) : undefined;
        return st ? { city: st.city || undefined, country: st.country || undefined, countryName: c?.name, flag: c?.flag } : undefined;
      })(),
      today: t.phase.kind === "before" ? undefined : todayIn(t.g),
    })),
    games: games.map((gm, k) => {
      const grp = open.find((x) => x.group.id === gm.groupId)!;
      const { lines } = potSummary(parsePlayers(gm.players), gm.moves);
      const top = [...lines].sort((a, b) => b.net - a.net)[0];
      const name = (id: string) => grp.group.members.find((m) => m.id === id)?.name ?? "Someone";
      return {
        id: gm.id,
        groupId: gm.groupId,
        name: gm.name,
        winner: top && top.net > 0 ? name(top.memberId) : "",
        won: top && top.net > 0 ? formatMoney(top.net, grp.group.currency) : "",
        youWon: top && top.net > 0 && top.memberId === grp.myId ? formatMoney(top.net, grp.group.currency) : undefined,
        finishedAt: gm.finishedAt ?? gm.createdAt,
        ...gameDetails[k],
      };
    }),
    squared: open
      .filter((g) => !g.leaver && g.group.type !== "pot" && g.expenses.length > 0 && g.transfers.length === 0 && g.payments.length > 0)
      .map((g) => ({
        id: g.group.id,
        name: g.group.name,
        at: g.payments.reduce((m, p) => (p.createdAt > m ? p.createdAt : m), g.payments[0].createdAt),
        cover: coverFor(g.group),
        photos: g.group.type === "trip" ? placePhotos(g.group.name, g.group.tripPlace, 2) : [],
        spent: formatMoney(g.spent, g.group.currency),
        payments: g.payments.length,
        people: g.group.members.filter((m) => !m.leftAt).length,
      })),
    collections: collections
      .filter((c) => !c.closedAt)
      .map((c) => {
        const pr = progress(c.entries, c.amount);
        return {
          id: c.id,
          code: c.code,
          title: c.title,
          paid: pr.paidCount,
          people: pr.people,
          in: formatMoney(pr.collected, c.currency),
          target: pr.target ? formatMoney(pr.target, c.currency) : undefined,
          paidNames: c.entries.filter((e) => e.status === "paid" || e.status === "confirmed").map((e) => first(e.name)),
          dueNames: c.entries.filter((e) => e.status === "due").map((e) => first(e.name)),
        };
      }),
    memories: stillIn(all)
      .filter((g) => g.group.type === "trip" && g.group.tripStart)
      .flatMap((g) => {
        const start = g.group.tripStart;
        const years = Number(today.slice(0, 4)) - Number(start.slice(0, 4));
        if (years < 1) return [];
        const anniversary = `${today.slice(0, 4)}${start.slice(4)}`;
        const since = daysBetween(anniversary, today); // shown on the day and for two days after
        if (Number.isNaN(since) || since < 0 || since > 2) return [];
        return [
          {
            id: g.group.id,
            name: g.group.name,
            years,
            people: g.group.members.length,
            days: g.group.tripEnd ? daysBetween(start, g.group.tripEnd) + 1 : 1,
            photos: placePhotos(g.group.name, g.group.tripPlace, 2),
            cover: coverFor(g.group),
            spent: g.spent > 0 ? formatMoney(g.spent, g.group.currency) : undefined,
            crew: crewOf(g),
          },
        ];
      }),
    // A trip that ended in the last two weeks: its Wrapped.
    wrapped: live
      .filter((g) => g.group.type === "trip" && g.group.tripStart && g.expenses.length >= 3)
      .flatMap((g) => {
        const ended = daysBetween(g.group.tripEnd || g.group.tripStart, today);
        if (ended < 1 || ended > 14) return [];
        const cats = new Map<string, number>();
        for (const e of g.expenses) if (e.kind !== "pot" && e.kind !== "refund") cats.set(e.category, (cats.get(e.category) ?? 0) + e.amount);
        const top = [...cats].sort((a, b) => b[1] - a[1])[0];
        return [{ id: g.group.id, name: g.group.name, endedDaysAgo: ended, photos: placePhotos(g.group.name, g.group.tripPlace, 2), cover: coverFor(g.group), spent: formatMoney(g.spent, g.group.currency), topCategory: top ? getCategory(top[0]).label : undefined }];
      }),
  });
  // The next trip (or the one you're on): a compact strip under the money card.
  const hero = trips[0];
  // Trips at the same stage of the countdown each get their own words (slot 0, 1, 2… in that stage).
  const stageSlot = new Map<string, number>();
  {
    const seen = new Map<string, number>();
    for (const t of trips) {
      const st = countdownStage(t.phase) ?? "none";
      const n = seen.get(st) ?? 0;
      stageSlot.set(t.g.group.id, n);
      seen.set(st, n + 1);
    }
  }
  // The sliding cards at the top (4 to 7), picked for what's useful right now.
  const stopsOf = (g: (typeof all)[number]) => tripStops(g.group.name, g.group.tripPlace ?? "", g.group.tripCountry ?? "");
  const homeCountry = (account?.homeCountry || region.country || "IN").toUpperCase();
  const [postcardsNew, billRows] = await Promise.all([
    account ? db.postcard.count({ where: { toId: account.id, readAt: null, OR: [{ opensAt: null }, { opensAt: { lte: new Date() } }] } }) : Promise.resolve(0),
    // A group they left shows no bills.
    db.bill.findMany({ where: { groupId: { in: open.filter((g) => !g.leaver).map((g) => g.group.id) }, deletedAt: null, paused: false }, take: 20 }),
  ]);
  // The same count as the passport: countries with a stamp or a tick (home only if it has one).
  const passportSet = new Set(
    [
      ...(account ? parseHandPlaces(account.places).map((p) => p.c) : []),
      ...all
        .filter((g) => g.group.type === "trip" && !g.group.deletedAt && (g.group.tripStart ? g.group.tripStart <= today : g.expenses.some((e) => !e.deletedAt)))
        .flatMap((g) => stopsOf(g).map((s) => s.country || homeCountry)),
    ].filter(Boolean),
  );
  const highlights = homeHighlights({
    trips: trips.map((t) => {
      const ph = placePhotos(t.g.group.name, t.g.group.tripPlace, 2);
      return {
        id: t.g.group.id,
        name: placeOf(t.g.group.name),
        phase: t.phase,
        start: t.g.group.tripStart,
        end: t.g.group.tripEnd || null,
        stops: stopsOf(t.g),
        photo: ph[0],
        photo2: ph[1],
        todaySpent: t.phase.kind === "before" ? undefined : todayIn(t.g).spent || undefined,
      };
    }),
    justBack: live
      .filter((g) => g.group.type === "trip" && g.group.tripStart && g.expenses.length > 0)
      .map((g) => ({ g, ended: daysBetween(g.group.tripEnd || g.group.tripStart, today) }))
      .filter(({ ended }) => ended >= 1 && ended <= 14)
      .sort((a, b) => a.ended - b.ended)
      .map(({ g, ended }) => ({
        id: g.group.id,
        name: placeOf(g.group.name),
        endedDaysAgo: ended,
        payments: g.transfers.length,
        photo: placePhotos(g.group.name, g.group.tripPlace, 1)[0],
        abroad: stopsOf(g).some((s) => s.country && s.country !== homeCountry),
      })),
    hasMonth: Boolean(month),
    season,
    postcardsNew,
    billsDue: billRows.flatMap((b) => {
      const due = nextDueDay(b, new Date());
      const g = open.find((x) => x.group.id === b.groupId);
      if (!due || !g || b.nature === "daily") return [];
      return [{ groupId: b.groupId, billId: b.id, name: b.name, group: g.group.name, inDays: daysBetween(today, due), amount: b.nature === "fixed" && b.amount ? formatMoney(b.amount, g.group.currency) : "" }];
    }),
    passportCountries: passportSet.size,
    // Said alongside, so "23 countries" next to a list of 22 abroad makes sense.
    passportAbroad: [...passportSet].filter((c) => c !== homeCountry).length,
    groups: open.length,
    fahrenheit: usesFahrenheit(region.country),
  });

  // First visit: show what Loopin does instead of an empty screen.
  const tourSeen = (await cookies()).get("lp_tour")?.value === "1";
  if (all.length === 0 && deletedGroups.length === 0 && collections.length === 0 && invitations.length === 0 && !error && !notice && !tourSeen) return <IntroTour signInHref="/signin" currency={region.currency} india={region.india} />;

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
          Group closed. Find it under “Closed groups”.
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

      <header className="mb-5 flex items-center justify-between">
        <p className="font-display text-[26px] font-semibold leading-none tracking-tight">loopin</p>
        <div className="flex items-center gap-2">
          <GetAppButton variant="icon" />
          <Link href="/how-it-works" aria-label="How Loopin works" className={`glass ${iconButtonClass} text-[17px] font-semibold`}>
            ?
          </Link>
          <Link href="/account" aria-label={account ? `Account: ${account.email}` : "Sign in or account"} className={`relative glass ${iconButtonClass}`}>
            {account?.name ? <span className="text-[15px] font-bold">{account.name.trim().charAt(0).toUpperCase()}</span> : <PersonIcon size={20} />}
            {account && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-owed" aria-hidden />}
          </Link>
        </div>
      </header>

      {/* Someone added you to a group: it isn't in your groups until you tap Join. */}
      {all.length === 0 && invitationsBlock}

      {all.length === 0 ? (
        <>
          {/* Start card: nothing here yet. */}
          <section aria-label="Start" className="vault rounded-[26px] px-5 pb-5 pt-6 text-fg" data-start-card>
            <p className="text-sm text-fg/60">Welcome to Loopin</p>
            <h1 className="mt-1 font-display text-[32px] font-semibold leading-[1.08] tracking-tight">Start with one group.</h1>
            <p className="mt-2 text-fg/65">Add what you paid, and Loopin keeps track of who owes whom.</p>
            <div className="mt-6 space-y-3">
              <Link href="/groups/new" className="pop block bg-fg px-4 py-3.5 text-center font-semibold text-canvas">
                Create a group
              </Link>
              <JoinByLink />
            </div>
          </section>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link href="/switching" className="flex min-h-[76px] flex-col justify-center rounded-2xl border border-line px-4 py-3 active:bg-mist">
              <span className="text-[13px] text-fg/60">Coming from another app?</span>
              <span className="mt-0.5 text-sm font-semibold leading-snug">Bring your groups over</span>
            </Link>
            <Link href="/how-it-works" className="flex min-h-[76px] flex-col justify-center rounded-2xl border border-line px-4 py-3 active:bg-mist">
              <span className="text-[13px] text-fg/60">How Loopin works</span>
              <span className="mt-0.5 text-sm font-semibold leading-snug">Three steps, one minute</span>
            </Link>
          </div>

          {!account && (
            <Link href="/signin" className="mt-4 flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 active:bg-mist">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Sign up to keep your groups</span>
                <span className="block text-xs text-fg/60">Get them back on a new phone. Google or your email, no password.</span>
              </span>
              <span className="text-gray-400" aria-hidden>
                ›
              </span>
            </Link>
          )}

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
              <RowIcon d="M12 5v14M5 12h14" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Add an expense</span>
                <span className="block text-xs text-gray-400">We’ll make a group for it first</span>
              </span>
              <span className="text-gray-400" aria-hidden>
                ›
              </span>
            </Link>
            <PotTeaser className="mt-2" />
          </section>

          {stories.length > 0 && <Stories stories={stories} className="mt-8" />}
          {collections.length > 0 && <CollectionsSection list={collections} />}
        </>
      ) : (
        <>
          {/* Money first: the net amount and two equal buttons, inside the first screen of a small phone. */}
          <MoneyCard
            lead={`${mode === "square" ? greeting(new Date(), tz, account?.name) : `${greeting(new Date(), tz, account?.name)}. ${moneyLead(mode)}`}${mode !== "square" && netCommon && netCommon.converted ? ` (in ${common})` : ""}`}
            amount={mode === "square" ? "All square" : heroText.replace(/^([≈ ]*)[+−]/, "$1")}
            amountClass={mode === "square" ? "text-[40px]" : heroText.length <= 9 ? "text-[44px]" : heroText.length <= 12 ? "text-[36px]" : "text-[28px]"}
            tone={mode === "owed" ? "owed" : mode === "owe" ? "owe" : "plain"}
            sub={moneySub({ mode, groups: open.filter((g) => g.myBalance !== 0).length, allGroups: open.length, people: settleItems })}
            mode={mode}
          />

          {/* The next trip, or the one you're on: one compact line. */}
          {hero && <TripStrip groupId={hero.g.group.id} place={placeOf(hero.g.group.name)} phase={hero.phase} going={crewOf(hero.g).length} start={hero.g.group.tripStart} shareLine={countdownWords(hero.g.group.name, hero.phase)?.line ?? ""} />}

          {invitationsBlock}

          {/* New here (one group, no expenses yet): a gentle pointer to the 1-minute tour. */}
          {open.length <= 1 && open.every((g) => g.expenses.length === 0) && (
            <Link href="/how-it-works" className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-mist px-4 py-3 text-sm active:bg-line">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d8bd7a]/45 text-[#e8d29a]">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.5v13l10.5-6.5Z" />
                </svg>
              </span>
              <span className="min-w-0 flex-1 leading-snug">
                <span className="block font-medium text-fg">New to Loopin? See how it works</span>
                <span className="block text-xs text-gray-400">A one-minute guide</span>
              </span>
              <span className="text-gray-400" aria-hidden>›</span>
            </Link>
          )}

          {/* Groups: each with its photo, what happened last and where you stand. */}
          <section className="mt-8" aria-label="Your groups">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="font-display text-[22px] font-semibold tracking-tight">Your groups</h2>
              <Link href="/groups/new" className="flex min-h-11 items-center gap-1 text-sm font-semibold text-fg/85 underline decoration-fg/30 underline-offset-4">
                New group
              </Link>
            </div>
            {/* Not signed in: these groups live only on this phone. Said once, right under the heading. */}
            {!account && all.length > 0 && <PhoneOnlyNote plural className="mb-2" />}
            {open.length === 0 ? (
              <p className="py-6 text-sm text-gray-500">No open groups. Create one, or reopen a closed one.</p>
            ) : (
              <>
                <ul className="lp-rise">
                  {byActivity.slice(0, 5).map((g) => (
                    <GroupLine key={g.group.id} g={g} tz={tz} />
                  ))}
                </ul>
                {byActivity.length > 5 && (
                  <details className="group/more">
                    <summary className="mt-2 inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-gray-600 active:bg-mist [&::-webkit-details-marker]:hidden">
                      <span className="group-open/more:hidden">Show all {byActivity.length} groups</span>
                      <span className="hidden group-open/more:inline">Show fewer</span>
                    </summary>
                    <ul className="lp-rise">
                      {byActivity.slice(5).map((g) => (
                        <GroupLine key={g.group.id} g={g} tz={tz} />
                      ))}
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

          {/* Any other trips coming up, one card at a time (soonest first). The first one is the strip under the money card. */}
          {trips.length > 1 && (
            <section className="mt-8" aria-label="More trips">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-display text-[22px] font-semibold tracking-tight">Also coming up</h2>
                {trips.length > 2 && <span className="text-xs text-fg/60">Swipe for more</span>}
              </div>
              <TripRow>
                {trips.slice(1).map((t) => (
                  <TripCountdown key={t.g.group.id} group={t.g.group} phase={t.phase} slot={stageSlot.get(t.g.group.id) ?? 0} />
                ))}
              </TripRow>
            </section>
          )}

          {stories.length > 0 && <Stories stories={stories} className="mt-8" />}

          {collections.length > 0 && <CollectionsSection list={collections} />}

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
                        {a.sub && <span className="mt-0.5 block truncate text-[12px] text-fg/60">{a.sub}</span>}
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
                <Link href="/search" className="hit text-sm text-gray-500">
                  See all ›
                </Link>
              </div>
              <ul className="divide-y divide-line">
                {recent.map((r, i) => (
                  <li key={r.item.id}>
                    {/* Tap: opens it in its group, already expanded (details, Edit, Delete). */}
                    <Link href={itemHref(r.groupId, r.item)} className="block active:bg-mist">
                      <ActivityRow item={r.item} currency={r.currency} nameOf={r.nameOf} groupName={`${r.groupName}, ${dayLabel(r.item.date, new Date(), tz)}`} motion="loop" delay={0.6 + (i % 5)} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-8">
          {/* The sliding cards, picked for you: the trip you're on, the next trip's weather and what's on there,
              a trip just over, postcards waiting, a bill due, your month, a festival where you live. */}
            <HomeBanner>
              {highlights.map((h) =>
                h.kind === "month" ? (
                  month && (
                    <div key="month">

                <div className="relative flex h-[268px] flex-col overflow-hidden bg-[radial-gradient(90%_90%_at_90%_10%,#4a2c16_0%,transparent_60%),linear-gradient(160deg,#24170f_0%,#121014_75%)] px-5 pb-12 pt-5">
                  <p aria-hidden className="absolute -right-3 -top-6 font-display text-[150px] font-semibold leading-none text-fg/[0.06]">
                    {month.name.slice(0, 3)}
                  </p>
                  <p className="relative text-sm text-[#d9b38c]">{month.wrapped ? "Your month, wrapped" : "Your month so far"}</p>
                  <p className="relative mt-1 font-display text-[27px] font-semibold leading-[1.1]">{month.name} in numbers</p>
                  <div className="relative mt-auto flex gap-5">
                    <p>
                      <span className="block money text-[19px] font-semibold tabular-nums" data-month-share>
                        {month.converted ? "≈ " : ""}
                        {formatMoney(month.share, month.currency)}
                      </span>
                      <span className="block text-xs text-gray-600">your share</span>
                    </p>
                    <p>
                      <span className="block money text-[19px] font-semibold tabular-nums">{month.count}</span>
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
                    </div>
                  )
                ) : (
                  <HighlightCard key={h.id} h={h} />
                ),
              )}
            </HomeBanner>
          </div>
        </>
      )}

      {/* Recently deleted groups: tucked away (like Closed groups) and opened with a tap;
          open on its own right after a delete. Whoever deleted them, or looks after them, can bring them back for 30 days. */}
      {deletedGroups.length > 0 && (
        <details className="group/deleted mt-4" open={deleted === "group" || deleted === "gone"}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-gray-600 active:bg-mist [&::-webkit-details-marker]:hidden">
            <span className="group-open/deleted:hidden">Recently deleted ({deletedGroups.length})</span>
            <span className="hidden group-open/deleted:inline">Hide recently deleted</span>
          </summary>
          <p className="mt-2 text-xs text-gray-400">You can bring these back for 30 days.</p>
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

      {all.length > 0 && <InviteFriends name={account?.name} className="mt-8" />}
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
            {peopleCount(g.people)}, {closed ? "closed" : activeText(g.lastActivity, tz)}
          </span>
        </span>
        <span className={`shrink-0 text-right text-sm tabular-nums ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-gray-400"}`}>
          {b > 0 ? `owed ${formatMoney(b, g.group.currency)}` : b < 0 ? `owe ${formatMoney(-b, g.group.currency)}` : "settled"}
        </span>
      </Link>
    </li>
  );
}

// A group on Home: its photo, its name, what happened last, and your balance in it.
function GroupLine({ g, tz }: { g: Awaited<ReturnType<typeof loadOverview>>["all"][number]; tz: string }) {
  const b = g.myBalance;
  const people = { length: g.people };
  const photo = g.group.type === "trip" && !g.group.cover ? placePhoto(g.group.name)?.src : undefined;
  return (
    <li>
      <Link href={`/groups/${g.group.id}`} className="flex items-center gap-3.5 py-2.5 active:opacity-80" data-group-line>
        <span className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-[16px] bg-mist" aria-hidden>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
          ) : (
            <GroupCover {...coverFor(g.group)} uid={`line-${g.group.id}`} letter={g.group.name} letterClass="text-lg" sizes="52px" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold tracking-tight">{g.group.name}</span>
          <span className="block truncate text-[13px] text-fg/50">
            {peopleCount(people.length)}, {activeText(g.lastActivity, tz)}
          </span>
        </span>
        <span className="shrink-0 text-right leading-tight">
          <span className={`money block text-[17px] ${b > 0 ? "text-owed" : b < 0 ? "text-owe" : "text-fg/60"}`}>
            {b > 0 ? `+${formatMoney(b, g.group.currency)}` : b < 0 ? `−${formatMoney(-b, g.group.currency)}` : "Settled"}
          </span>
          {b !== 0 && <span className="block text-[11px] text-fg/60">{b > 0 ? "you’re owed" : "you owe"}</span>}
        </span>
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
// For someone just starting: card nights (Collect and everything else start from New group).
function PotTeaser({ className = "" }: { className?: string }) {
  return (
    <Link href="/groups/new?type=pot" className={`flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 active:bg-mist ${className}`}>
      <RowIcon d="M7 4h8a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM17 7l2.2.6a2 2 0 0 1 1.4 2.4l-2.6 9.6" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Card night? Start a Pot</span>
        <span className="block text-xs text-gray-400">Teen Patti or Poker: who took what from the pot, who won, who pays</span>
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

function greeting(now: Date, tz: string, name?: string | null): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  const part = h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : "evening";
  const first = name?.trim().split(/\s+/)[0];
  return `Good ${part}${first ? `, ${first}` : ""}`;
}

// A drawn icon in a soft round tile, for the rows on the start screen.
function RowIcon({ d }: { d: string }) {
  return (
    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fg/[0.07] text-fg/85">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
}
