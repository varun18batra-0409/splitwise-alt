import { neutralGameText } from "@/lib/game-words";
import Link from "@/components/Link";
import { SignInBanner } from "@/components/SignInBanner";
import { Notice } from "@/components/Notice";
import { IntroTour } from "@/components/IntroTour";
import { JoinByLink } from "@/components/JoinByLink";
import { StartHero } from "@/components/StartHero";
import { cookies, headers } from "next/headers";
import { visitorRegion } from "@/lib/region";
import { pairPath } from "@/lib/direct";
import { GAME_NIGHT_GAMES } from "@/lib/group-types";
import { getTimeZone } from "@/lib/tz";
import { getAccount, getMemberships, guestGroupsOnPhone } from "@/lib/identity";
import { GuestMoveNotice } from "@/components/GuestMoveSheet";
import { PasskeyOffer } from "@/components/Passkeys";

import { loadDeletedGroups } from "@/lib/group-data";
import { loadOverview } from "@/lib/overview";
import { loadHomeRows, wrappedEnded } from "@/lib/home/home-data";
import { loadInvitations } from "@/lib/invitations";
import { InvitationCard } from "@/components/InvitationCard";
import { buildActivity, dayLabel } from "@/lib/activity";
import { formatMoney } from "@/lib/money";
import { homeMoney } from "@/lib/home/display";
import { climateFor, tripMonth, usesFahrenheit, weatherWords } from "@/lib/climate";
import { Polaroid } from "@/components/Polaroid";
import { coverFor, coverOf } from "@/lib/covers";
import { monthCardMode, monthNumbers, seasonNow } from "@/lib/home/banner";
import { HomeBanner } from "@/components/HomeBanner";
import { HighlightCard } from "@/components/HighlightCard";
import { beforeYouGo, homeHighlights } from "@/lib/home/highlights";
import { parseHandPlaces, passportZone, stampDay } from "@/lib/passport";
import { ensureHomeCountry, undatedTripFacts } from "@/lib/passport-db";
import { nextDueDay } from "@/lib/home/bills";
import { ActivityRow } from "@/components/ActivityRow";
import { itemHref } from "@/lib/paths";
import { db } from "@/lib/db";
import { moveOutPaymentIds } from "@/lib/payment-change";
import { gameVisible, stillIn } from "@/lib/left-view";
import { gamesForStories, homeBills, potIdsToShow, recentGames } from "@/lib/home/home-lists";
import { canUndo, originAtDb, paymentsForUndo } from "@/lib/undo";
import { isGroupAdmin } from "@/lib/group-admin";
import { UndoBar } from "@/components/UndoBar";
import { BellButton } from "@/components/BellButton";
import { countMyCollections, myCollections, progress } from "@/lib/collect";
import { CollectionsSection } from "@/components/CollectionsList";
import { FooterLinks, HOME_FOOTER_LINKS } from "@/components/FooterLinks";
import { countdownWords, placeOf, tripPhase, type TripPhase } from "@/lib/countdown";
import { todayKey } from "@/lib/dates";
import { countryOf, tripStops } from "@/lib/geo";
import { MoneyCard, PersonMoneyCard, type StubCover, type TripPassView } from "@/components/HomeMoney";
import { greetingWord } from "@/lib/home/owe-card";
import { PassStack } from "@/components/PassStack";
import { TripCountdown } from "@/components/TripCountdown";
import { homeNetCard, homePersonLines } from "@/lib/home/money-card";
import { Stories } from "@/components/Stories";
import { buildStories } from "@/lib/home/stories";
import { loadHomeMemories } from "@/lib/moments-db";
import { MemoryPolaroids } from "@/components/MemoryPolaroids";
import { comingUp } from "@/lib/home/coming-up";
import { photoSet, placePhotos, tripPhotoSrc } from "@/lib/places";
import { GroupCards, type GroupCardData } from "@/components/HomeGroups";
import { blockedEitherWay, unreadPostcards } from "@/lib/blocks";
import { gameHasBlockedPlayer } from "@/lib/home/game-blocks";
import { tripEmoji } from "@/lib/countdown";
import { payersOf, spentAmount } from "@/lib/payers";
import { getCategory } from "@/lib/categories";
import { daysBetween } from "@/lib/countdown";
import { parsePlayers, potSummary } from "@/lib/pot";
import { readNotes } from "@/lib/flash";

export const metadata = { alternates: { canonical: "/" } };

const countPasskeys = (accountId: string) => db.passkey.count({ where: { accountId } });

// Home (the 15 Nov mockup): greeting, automated stories, your money card (label, exact amount, who and where, one button, the trip's photo; nothing sits
// under it: what needs you lives in Updates behind the bell), Coming up (the countdown cards), your groups as polaroids, Memories, Latest and the sliding cards (the tagline is not on Home).
// Search, Settle and Alerts live in the bottom bar.
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
  const sp = await searchParams;
  const { closed: justClosed, did, g: didGroup, undone, deleted, signedin, moved, collection } = sp;
  const { error } = await readNotes(sp, "/");
  const [tz, memberships] = await Promise.all([getTimeZone(), getMemberships()]);
  // Independent reads, all at once.
  const [overview, deletedGroups, account, collections, collectionsTotal, invitations, postcardsNew, guestGroups] = await Promise.all([
    loadOverview(memberships, visitorRegion(await headers()).currency),
    loadDeletedGroups(memberships),
    getAccount(),
    getAccount().then((a) => (a ? myCollections(a.id) : [])),
    getAccount().then((a) => (a ? countMyCollections(a.id) : 0)),
    // Groups someone added you to, waiting for Join or Not now.
    getAccount().then((a) => loadInvitations(a)),
    // Postcards that arrived and are unread (none from people you blocked, none still sealed).
    getAccount().then((a) => (a ? unreadPostcards(a.id) : 0)),
    // Signed in, but some groups are still only a guest name on this device (the sign-in check was skipped, or they came later).
    getAccount().then((a) => (a ? guestGroupsOnPhone() : [])),
  ]);
  const { all, direct, open, closed, common, toCommon, pairRows } = overview;
  // Only the rows Home shows: the newest changes, this month, today's spending on trips, a finished trip's categories.
  const now = new Date();
  const today = todayKey(now, tz);
  const [rows, memories] = await Promise.all([
    loadHomeRows(all, { tz, now, today }, pairRows),
    // The newest moments this person may see: the Memories polaroids under the story circles.
    loadHomeMemories(memberships),
  ]);

  // Undo bar after a change made from the home screen (e.g. closing a group).
  let undoBar: { text: string; groupId: string; eventId: string } | null = null;
  // (A person who moved out sees it too: their own Undo of a move-out is theirs to use. canUndo decides who may undo what.)
  const grp = didGroup ? all.find((x) => x.group.id === didGroup) : undefined;
  if (did && didGroup && memberships[didGroup] && grp) {
    const myId = memberships[didGroup];
    const ev = await db.groupEvent.findFirst({ where: { id: did, groupId: didGroup } });
    // Only changes from then on matter for whether it can still be undone.
    const events = ev ? await db.groupEvent.findMany({ where: { groupId: didGroup, createdAt: { gte: ev.createdAt } } }) : [];
    const viewer = { id: myId, isAdmin: await isGroupAdmin(didGroup, myId), closed: grp.group.closed, members: grp.group.members, payments: ev ? await paymentsForUndo(didGroup, ev.undo) : [] };
    if (ev && canUndo(ev, events, new Date(), viewer, await originAtDb(ev)).ok) {
      const actor = ev.actorId === myId ? "You" : grp.group.members.find((m) => m.id === ev.actorId)?.name ?? "Someone";
      undoBar = { text: undone ? "Undone." : `${actor} ${neutralGameText(ev.text)} · ${grp.group.name}`, groupId: didGroup, eventId: ev.id };
    }
  }

  // The latest changes across open groups. (Only a flat move-out's final payments can read "waiting"; every other payment counts at once.)
  const moveOut = await moveOutPaymentIds(db, open.map((g) => g.group.id));
  // Money with one person (no group) shows here too, labelled with their name and opening their page.
  const pairsOpen = pairRows.filter((p) => !p.group.closed);
  const recent = [...open, ...pairsOpen]
    .flatMap((g) => {
      const mine = rows.recent.get(g.group.id);
      if (!mine) return [];
      const names = new Map(g.group.members.map((m) => [m.id, m.id === g.myId ? "You" : m.name]));
      const pair = g.group.type === "direct";
      const other = pair ? g.group.members.find((m) => m.id !== g.myId) : undefined;
      return buildActivity(mine.expenses, mine.payments, g.myId, [], moveOut).map((item) => ({
        item,
        groupId: g.group.id,
        currency: g.group.currency,
        groupName: other ? other.name : g.group.name,
        href: pair ? pairPath(g.group.id) : undefined,
        nameOf: (id: string) => names.get(id) ?? "Someone",
      }));
    })
    .sort((a, b) => b.item.date.getTime() - a.item.date.getTime())
    .slice(0, 5);

  const notice =
    deleted === "account"
      ? "Your email and sign-in were deleted. Your groups on this device are still here."
      : collection === "deleted"
          ? "Collection deleted."
          : moved === "1"
          ? "Loopin has a new address: loopinapps.com. Everything came with you. Using the app icon on your home screen? It keeps working; to update it, add Loopin to your home screen again from this page."
          : signedin === "1"
          ? `Signed in${account ? ` as ${account.email}` : ""}. Your groups are saved to your email.`
          : null;

  // The month card: your month so far.
  // Your month across every group you're in (closed ones too: it was still your money), the same
  // way Insights counts it.
  const monthAll = monthNumbers(rows.monthGroups, toCommon, common, now, tz);
  // No share this month: no card and no dot (founder, 16 Nov).
  const monthMode = monthCardMode(monthAll);
  const month = monthMode === "none" ? null : monthAll;
  const region = visitorRegion(await headers());
  // Stories about how a group is now (countdown, a year ago, just back, wrapped, hero) skip groups the viewer left.
  const live = stillIn(open);
  const byActivity = [...live].sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  // The slim Net card: everything you're owed minus everything you owe, groups and with-a-person (direct pairs) together, with the two
  // kinds as small lines. Only Home combines them; Settle up keeps them apart. Same balances and saved rates as Home's total always used.
  const netCard = homeNetCard({
    items: [
      ...open.map((g) => ({ currency: g.group.currency, net: g.myBalance, direct: false })),
      ...direct.map((p) => ({ currency: p.currency, net: p.net, direct: true })),
    ],
    common,
    toCommon,
  });
  // Only one-to-one expenses, no group: Home names each person ("With Rohan: owes you ₹600") instead of an unnamed "Net".
  const personLines = homePersonLines(direct.map((p) => ({ key: p.groupId, name: p.other.name, currency: p.currency, net: p.net })));
  const personOnly = byActivity.length === 0 && personLines.lines.length > 0;
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
  const potIds = potIdsToShow(open); // not the groups you left, so their games cannot fill the newest ten
  const gameRows = await recentGames(potIds, new Date(Date.now() - 3 * 86_400_000));
  // Blocking works both ways: nobody with a block between them and you is named on a story (the group's own screens are unchanged).
  const blocked = account ? await blockedEitherWay(account.id) : new Set<string>();
  const isBlockedMember = (g: (typeof open)[number], id: string) => id !== g.myId && Boolean(blocked.size) && g.group.members.some((m) => m.id === id && m.accountId !== null && blocked.has(m.accountId));
  // Games played after someone left the group aren't theirs to see. A game with anyone in it who has a block either way with you has no story
  // at all (never a story with a name left out: that would read as a different result).
  const games = gamesForStories(gameRows, open).filter((gm) => {
    const grp = open.find((x) => x.group.id === gm.groupId);
    if (!grp || !gameVisible(grp.leaver ?? null, gm)) return false;
    return !gameHasBlockedPlayer(potSummary(parsePlayers(gm.players), gm.moves).lines.map((l) => l.memberId), (id) => isBlockedMember(grp, id));
  });
  // What each story shows: the place's photos, the crew, today's numbers, a game's table.
  const first = (n: string) => n.trim().split(/\s+/)[0] || n;
  const crewOf = (g: (typeof open)[number]) => g.group.members.filter((m) => !m.leftAt && (m.id === g.myId || !(m.accountId && blocked.has(m.accountId)))).map((m) => (m.id === g.myId ? "You" : first(m.name)));
  const moodOf = (name: string) => {
    const e = tripEmoji(name);
    return e === "🌴" ? "beach" : e === "🏔️" || e === "❄️" || e === "🏕️" ? "hills" : e === "🌆" ? "city" : "any";
  };
  const dayOf = (d: Date) => todayKey(d, tz);
  const todayIn = (g: (typeof open)[number]) => {
    const list = (rows.today.get(g.group.id) ?? []).filter((e) => e.kind !== "pot" && e.kind !== "refund" && dayOf(e.spentAt ?? e.createdAt) === today);
    if (!list.length) return { spent: "", count: 0 };
    const money = (n: number) => formatMoney(n, g.group.currency);
    const paid = new Map<string, number>();
    for (const e of list) for (const p of payersOf(e)) paid.set(p.memberId, (paid.get(p.memberId) ?? 0) + p.amount);
    const [topId] = [...paid].sort((a, b) => b[1] - a[1])[0] ?? [""];
    const topName = topId === g.myId ? "You" : isBlockedMember(g, topId) ? "" : first(g.group.members.find((m) => m.id === topId)?.name ?? "");
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
    home: (account?.homeCountry || region.country || "").toUpperCase() || undefined,
    // Moments are no stories: they live only in Memories, under the story circles.
    // Every trip that is coming up or on has its circle (founder, 15 Nov: stories always on top), as well as its card in Coming up.
    trips: trips.map((t) => ({
      id: t.g.group.id,
      name: t.g.group.name,
      phase: t.phase,
      photos: placePhotos(t.g.group.name, t.g.group.tripPlace),
      cover: coverFor(t.g.group),
      people: t.g.group.members.filter((m) => !m.leftAt).length,
      couple: t.g.group.type === "couple",
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
        name: neutralGameText(gm.name),
        winner: top && top.net > 0 ? name(top.memberId) : "",
        won: top && top.net > 0 ? formatMoney(top.net, grp.group.currency) : "",
        youWon: top && top.net > 0 && top.memberId === grp.myId ? formatMoney(top.net, grp.group.currency) : undefined,
        finishedAt: gm.finishedAt ?? gm.createdAt,
        ...gameDetails[k],
      };
    }),
    squared: open
      .filter((g) => !g.leaver && g.group.type !== "pot" && g.expenseCount > 0 && g.transfers.length === 0 && g.paymentCount > 0 && g.lastPaymentAt)
      .map((g) => ({
        id: g.group.id,
        name: g.group.name,
        at: g.lastPaymentAt!,
        cover: coverFor(g.group),
        photos: g.group.type === "trip" ? placePhotos(g.group.name, g.group.tripPlace, 2) : [],
        spent: formatMoney(g.spent, g.group.currency),
        payments: g.paymentCount,
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
          checked: pr.checked,
          people: pr.people,
          in: formatMoney(pr.confirmedAmount, c.currency),
          reported: pr.reportedAmount > 0 ? formatMoney(pr.reportedAmount, c.currency) : undefined,
          target: pr.target ? formatMoney(pr.target, c.currency) : undefined,
          paidNames: c.entries.filter((e) => e.status === "confirmed").map((e) => first(e.name)),
          reportedNames: c.entries.filter((e) => e.status === "paid").map((e) => first(e.name)),
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
            people: g.group.members.filter((m) => !m.leftAt).length,
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
      .flatMap((g) => {
        const ended = wrappedEnded(g, today);
        if (ended === null) return [];
        const cats = rows.categories.get(g.group.id) ?? new Map<string, number>();
        const top = [...cats].sort((a, b) => b[1] - a[1])[0];
        return [{ id: g.group.id, name: g.group.name, endedDaysAgo: ended, photos: placePhotos(g.group.name, g.group.tripPlace, 2), cover: coverFor(g.group), spent: formatMoney(g.spent, g.group.currency), topCategory: top ? getCategory(top[0]).label : undefined }];
      }),
  });
  // The polaroids in Your groups: newest activity first. Each says only a status word (no amount, no day count: the money pass and
  // the Coming up passes say those, once).
  const groupCards: GroupCardData[] = byActivity.map((g) => ({
    id: g.group.id,
    name: g.group.name,
    cover: coverFor(g.group),
    // A trip shows its place's real photo whenever it has none of its own (also when a drawn picture was stored): the same on its
    // polaroid, the ticket's stub and the countdown thumb.
    photo: tripPhotoSrc(g.group),
    balance: g.myBalance,
    expenses: g.expenseCount,
  }));
  const stopsOf = (g: (typeof all)[number]) => tripStops(g.group.name, g.group.tripPlace ?? "", g.group.tripCountry ?? "");
  // A trip pass's picture: the group's own cover, the same as its polaroid.
  const stubCover = (id: string): StubCover | null => {
    const c = groupCards.find((x) => x.id === id);
    return c ? { id: c.id, cover: c.cover, photo: c.photo, name: c.name } : null;
  };
  // Coming up: one boarding pass per upcoming trip (trips only, earliest first, at most three); a trip that is on says "Day 2 of 5" on its pass.
  // A finished trip leaves. The weather is the trip's usual weather when we know it, as one small pill.
  const passes: TripPassView[] = comingUp(
    trips.map((t) => {
      const st = stopsOf(t.g)[0];
      const c0 = st?.country ? countryOf(st.country) : undefined;
      return { id: t.g.group.id, type: t.g.group.type, name: t.g.group.name, start: t.g.group.tripStart, end: t.g.group.tripEnd || null, phase: t.phase, going: crewOf(t.g).length, stop: st ? { city: st.city, country: st.country, countryName: c0?.name } : undefined };
    }),
    today.slice(0, 4),
  ).flatMap((p) => {
    const t = trips.find((x) => x.g.group.id === p.id)!;
    const cover = stubCover(p.id);
    if (!cover) return [];
    const stop = stopsOf(t.g)[0];
    const c = stop ? climateFor(stop.city, stop.country, tripMonth(t.g.group.tripStart, t.g.group.tripEnd || null)) : null;
    const w = c ? weatherWords(c, usesFahrenheit(region.country)) : null;
    return [{ ...p, stub: cover, shareLine: countdownWords(t.g.group.name, t.phase)?.line ?? "", weather: w ? { text: w.temps.replace(/^Usually /, ""), full: w.line } : undefined }];
  });

  // Trips at the same stage of the countdown each get their own words on their card (slot 0, 1, 2… in that stage).
  const stageSlot = new Map<string, number>();
  {
    const seenStage = new Map<string, number>();
    for (const p of passes) {
      const n = seenStage.get(p.stage) ?? 0;
      seenStage.set(p.stage, n + 1);
      stageSlot.set(p.id, n);
    }
  }

  // The sliding row on Home (one row, in this order; see src/lib/home/highlights.ts): the usual weather for your next trip, your month,
  // a bill due within 5 days, a postcard, your passport, and the festival for your country when it is on. No trip photos.
  // A group they left shows no bills.
  const billRows = await homeBills(open.filter((g) => !g.leaver).map((g) => g.group.id));
  const fahrenheit = usesFahrenheit(region.country);
  const homeCountry = (account ? (await ensureHomeCountry(account)).homeCountry : "").toUpperCase(); // saved once; never guessed from where the phone is
  const weatherCard = beforeYouGo(
    trips.map((t) => {
      const stops = stopsOf(t.g);
      return {
        id: t.g.group.id,
        name: placeOf(t.g.group.name),
        phase: t.phase,
        start: t.g.group.tripStart,
        end: t.g.group.tripEnd || null,
        stops,
        countryName: stops[0]?.country ? countryOf(stops[0].country)?.name : undefined,
      };
    }),
    fahrenheit,
    homeCountry,
  );
  // The day a trip's stamp is dated, or null when it has none yet (one rule, shared with the passport: src/lib/passport.ts).
  // An undated trip is stamped from the spending you may see (src/lib/passport-db.ts undatedTripFacts), the same numbers the passport reads.
  const stampTz = passportZone(account);
  const undatedFacts = await undatedTripFacts(
    all.filter((g) => g.group.type === "trip" && !g.group.tripStart && !g.group.deletedAt).map((g) => ({ groupId: g.group.id, me: { id: g.myId, leftAt: g.leaver?.leftAt ?? null } })),
    stampTz,
  );
  const stampOf = (g: (typeof all)[number]) =>
    stampDay({ type: g.group.type, deletedAt: g.group.deletedAt, tripStart: g.group.tripStart, undated: undatedFacts.get(g.group.id) ?? null, leftAt: g.leaver?.leftAt ?? null }, today, stampTz);
  // The same count as the passport: countries with a stamp or a tick (home only if it has one).
  const passportSet = new Set(
    [
      ...(account ? parseHandPlaces(account.places).map((p) => p.c) : []),
      ...all.filter((g) => stampOf(g) !== null).flatMap((g) => stopsOf(g).map((s) => s.country || homeCountry)),
    ].filter(Boolean),
  );
  // The passport card's stamps: the same places the passport counts, newest first, then countries ticked by hand. Abroad only, one each, at most 2.
  const keepsakeStamps = [
    ...all
      .flatMap((g) => {
        const when = stampOf(g);
        return when === null ? [] : [{ g, when }];
      })
      .sort((a, b) => b.when.localeCompare(a.when))
      .flatMap(({ g, when }) => stopsOf(g).filter((st) => st.country).map((st) => ({ code: st.country.toUpperCase(), when, byHand: false }))),
    ...(account ? parseHandPlaces(account.places).map((pl) => ({ code: pl.c.toUpperCase(), when: "", byHand: true })).reverse() : []),
  ]
    .filter((st) => Boolean(homeCountry) && st.code !== homeCountry) // home unknown: nothing counts as abroad
    .filter((st, i, list) => list.findIndex((o) => o.code === st.code) === i)
    .slice(0, 2)
    .flatMap((st) => {
      const c = countryOf(st.code);
      return c ? [{ code: c.code, country: c.name, when: st.when, ...(st.byHand ? { byHand: true } : {}) }] : [];
    });
  const highlights = homeHighlights({
    weather: weatherCard,
    hasMonth: Boolean(month),
    signedIn: Boolean(account),
    // The festival or season coming up in this visitor's country (Christmas, New Year, Diwali, Eid…), only inside its dates.
    season: seasonNow(new Date(), tz, region.country),
    // New postcards and a bill due soon have no line of their own on Home, so the sliding cards bring them up.
    postcardsNew,
    billsDue: billRows.flatMap((b) => {
      const due = nextDueDay(b, new Date());
      const g = open.find((x) => x.group.id === b.groupId);
      if (!due || !g || b.nature === "daily") return [];
      const inDays = daysBetween(today, due);
      return [{ groupId: b.groupId, billId: b.id, name: b.name, group: g.group.name, inDays, amount: b.nature === "fixed" && b.amount ? formatMoney(b.amount, g.group.currency) : "" }];
    }),
    passportCountries: passportSet.size,
    // Said alongside, so "23 countries" next to a list of 22 abroad makes sense.
    passportAbroad: homeCountry ? [...passportSet].filter((c) => c !== homeCountry).length : undefined, // home unknown: no "abroad, plus home" phrase
    // Real photos (slots card-passport and card-postcards in scripts/fetch-photos.mjs); none downloaded: the drawn art.
    scenes: { passport: photoSet("card-passport")[0], postcards: photoSet("card-postcards")[0], stamps: keepsakeStamps, postcardPhoto: photoSet("card-postcard-photo")[0] },
  });

  // First visit: show what Loopin does instead of an empty screen.
  const tourSeen = (await cookies()).get("lp_tour")?.value === "1";
  // Someone with only people they share expenses with directly (no group) still gets Home, Settle and their people (they count even with no group).
  const hasAny = all.length > 0 || direct.length > 0;
  if (!hasAny && deletedGroups.length === 0 && collections.length === 0 && invitations.length === 0 && !error && !notice && !tourSeen) return <IntroTour signInHref="/signin" currency={region.currency} india={region.india} momentPhoto={photoSet("card-postcard-photo")[0]} />;

  return (
    <>
      {undoBar && <UndoBar key={undoBar.eventId} {...undoBar} back="home" redo={undone === "1"} />}
      {error && <Notice tone="error" params={["error", "et", "es"]} className="mb-4">{error}</Notice>}
      {notice && (
        <Notice params={["signedin", "moved", "deleted", "collection"]} className="mb-4">
          {notice}
        </Notice>
      )}
      {account && signedin === "1" && (await countPasskeys(account.id)) === 0 && <PasskeyOffer />}
      {justClosed === "1" && !undone && (
        <Notice params={["closed"]} className="mb-4">
          Group closed. Find it under{" "}
          <Link href="/groups" className="font-medium underline underline-offset-4">
            Closed groups
          </Link>
          .
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

      {/* The wordmark, a quiet greeting under it, and the bell. The app install and "How Loopin works" live in You. */}
      <header className="mb-4 flex items-start justify-between">
        <div className="min-w-0">
          <p className="font-display text-[28px] font-semibold leading-none tracking-tight">loopin</p>
          {/* The start screen has its own visible h1; with groups, Home gets a hidden one so the screen has exactly one main heading. */}
          {hasAny && <h1 className="sr-only">Home</h1>}
          {hasAny && (
            <p className="mt-2 text-[17px] leading-tight text-fg/75" data-greeting>
              {greetingWord(new Date(), tz)}
            </p>
          )}
        </div>
        <BellButton className="glass border border-fg/10" />
      </header>

      {/* Signed in, with groups that are only on this device: a quiet offer to move them (opens the same check as sign-in). */}
      <GuestMoveNotice groups={guestGroups} />

      {/* Someone added you to a group: it isn't in your groups until you tap Join. */}
      {!hasAny && invitationsBlock}

      {!hasAny ? (
        <>
          {/* Start screen: nothing here yet. Two photos and a receipt, the promise, then the ways in. */}
          <section aria-label="Start" className="text-fg" data-start-card>
            <StartHero currency={region.currency} />
            <h1 className="font-display text-[clamp(30px,9vw,34px)] font-semibold leading-[1.08] tracking-tight">
              Good times. <span className="block">Shared fairly.</span>
            </h1>
            <p className="mt-2.5 max-w-[19rem] text-[15px] leading-snug text-fg/65">Split expenses, settle up and keep the memories.</p>
            <div className="mt-6 space-y-3">
              <Link href="/groups/new" className="pop block bg-fg px-4 py-3.5 text-center font-semibold text-canvas">
                Create a group
              </Link>
              <JoinByLink />
            </div>
            {!account && (
              <p className="mt-4 text-center text-[15px] text-fg/65">
                <Link href="/signin" className="inline-block py-3">
                  Already here? <span className="font-semibold text-fg underline underline-offset-4">{"Sign\u00a0in"}</span>
                </Link>
              </p>
            )}
          </section>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Link href="/switching" className="flex min-h-[84px] flex-col justify-center rounded-2xl border border-line px-4 py-3 active:bg-mist [&>span]:[text-wrap:balance]">
              <span className="text-[13px] text-fg/55">Coming from another app?</span>
              <span className="mt-0.5 text-sm font-medium leading-snug text-fg/85 [text-wrap:balance]">Bring your groups over</span>
            </Link>
            <Link href="/how-it-works" className="flex min-h-[84px] flex-col justify-center rounded-2xl border border-line px-4 py-3 active:bg-mist [&>span]:[text-wrap:balance]">
              <span className="text-[13px] text-fg/55">How Loopin works</span>
              <span className="mt-0.5 text-sm font-medium leading-snug text-fg/85 [text-wrap:balance]">A one-minute tour</span>
            </Link>
          </div>

          <section className="mt-8">
            <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">Quick start</h2>
            <div className="lp-rise grid grid-cols-2 gap-4 px-1 pt-1">
              {[
                ["trip", "Trip", "Goa trip"],
                ["home", "Flat or family", "Flat expenses"],
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
          {collections.length > 0 && <CollectionsSection list={collections} limit={6} total={collectionsTotal} />}
        </>
      ) : (
        <>
          {/* Automated stories on top, like Instagram: a row of circles. Nothing when there are none. */}
          {stories.length > 0 && <Stories stories={stories} className="mb-4" />}

          {/* Money (the mockup's short "You owe" card: label, the exact amount, who and where, faces, ONE full-width cream button, no photo);
              nothing sits under it: what needs you is in Updates behind the bell. */}
          {personOnly ? <PersonMoneyCard {...personLines} /> : <MoneyCard card={netCard} />}

          {/* Coming up: the countdown card for each trip that is next (the trip's polaroid, "12 days to go", everyone going, Share),
              earliest first, swiped sideways. Founder, 15 Nov: this card, not the mockup's. */}
          {passes.length > 0 && (
            <section aria-labelledby="coming-up-h" className="mt-7" data-coming-up>
              <h2 id="coming-up-h" className="mb-2 font-display text-[22px] font-semibold tracking-tight">
                {passes.some((p) => p.days === null) ? "Your trips" : "Coming up"}
              </h2>
              <PassStack label="Upcoming trips" attrs={{ "data-coming-up-stack": "" }}>
                {passes.map((p) => {
                  const t = trips.find((x) => x.g.group.id === p.id)!;
                  return <TripCountdown key={p.id} group={t.g.group} phase={t.phase} slot={stageSlot.get(p.id) ?? 0} today={today} />;
                })}
              </PassStack>
            </section>
          )}

          {invitationsBlock}

          {/* Groups: polaroids you swipe sideways. "See all" opens the full list. */}
          <section className="mt-7" aria-labelledby="home-groups-h">
            <div className="flex items-baseline justify-between">
              <h2 id="home-groups-h" className="font-display text-[22px] font-semibold tracking-tight">Your groups</h2>
              <Link href="/groups" className="flex min-h-11 items-center text-sm font-medium text-fg/85">
                See all
              </Link>
            </div>
            {byActivity.length === 0 ? (
              <>
                {/* Only people so far: the dashed "New group" tile is still one tap away. */}
                {direct.length > 0 && <GroupCards groups={[]} total={0} />}
                <p className="py-4 text-sm text-gray-500">
                  No open groups.{" "}
                  <Link href="/groups/new" className="font-medium text-fg underline underline-offset-4">Create one</Link>, or reopen a closed one.
                </p>
              </>
            ) : (
              <div className="-mt-2">
                <GroupCards groups={groupCards} total={byActivity.length} />
              </div>
            )}
          </section>

          {/* Further down: Memories (the newest moment as a polaroid; nothing at all when there are none), then Latest. */}
          <MemoryPolaroids memories={memories} />

          {/* Latest */}
          {recent.length > 0 && (
            <section className="mt-7">
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-display text-[22px] font-semibold tracking-tight">Latest</h2>
                <Link href="/search" className="hit text-sm text-gray-500">
                  See all ›
                </Link>
              </div>
              <ul className="divide-y divide-line">
                {recent.map((r, i) => (
                  <li key={r.item.id}>
                    {/* Tap: opens it in its group, already expanded (details, Edit, Delete). */}
                    <Link href={r.href ?? itemHref(r.groupId, r.item)} className="block active:bg-mist">
                      <ActivityRow item={r.item} currency={r.currency} nameOf={r.nameOf} groupName={r.groupName} dateLabel={dayLabel(r.item.date, new Date(), tz)} motion="loop" delay={0.6 + (i % 5)} whole />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {collections.length > 0 && <CollectionsSection list={collections} limit={6} total={collectionsTotal} />}

          {/* New here (one group, no expenses yet): a gentle pointer to the 1-minute tour. */}
          {open.length <= 1 && open.every((g) => g.expenseCount === 0) && (
            <Link href="/how-it-works" className="mt-6 flex items-center gap-3 rounded-2xl border border-line bg-mist px-4 py-3 text-sm active:bg-line">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-fg/25 text-fg/75">
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

          {/* ONE sliding row: your next trip's usual weather, your month, a bill due soon, a postcard, your passport, the festival (in its dates).
              Swipe, tap a dot, or pause; they glide by themselves unless animations are off. */}
          {highlights.length > 0 && (
            <div className="mt-8">
              <HomeBanner>
                {highlights.map((h) =>
                  h.kind === "month" ? (
                    month && monthMode === "slim" ? (
                      // Exactly one expense: one slim line, not a large card with one number in it.
                      <div key="month" className="flex flex-1 flex-col">
                        <div className="relative flex flex-1 flex-wrap content-center items-center justify-between gap-x-4 gap-y-2 overflow-hidden bg-[linear-gradient(150deg,#2a1f1c_0%,#17151a_60%,#101012_100%)] px-5 pb-10 pt-4" data-month-card data-month-slim>
                          <p className="relative min-w-0 text-[15px] text-fg/85" data-month-line>
                            {month.name} · 1 expense · your share{" "}
                            <span className="money font-semibold tabular-nums text-fg" title={formatMoney(month.share, month.currency)}>
                              {month.converted ? "≈ " : ""}
                              {homeMoney(month.share, month.currency)}
                            </span>
                          </p>
                          <Link href={`/search?m=${month.month}`} className="relative shrink-0 text-sm font-medium text-fg underline underline-offset-4">
                            See {month.name}
                          </Link>
                        </div>
                      </div>
                    ) : month && (
                      <div key="month" className="flex flex-1 flex-col">
                        <div className="relative flex flex-1 flex-col overflow-hidden bg-[linear-gradient(150deg,#2a1f1c_0%,#17151a_60%,#101012_100%)] px-5 pb-12 pt-5" data-month-card>
                          {/* The month's name, large and faint behind the numbers. */}
                          <span aria-hidden className="pointer-events-none absolute -right-2 top-1 select-none font-display text-[120px] font-semibold leading-none text-white/[0.06]">
                            {month.name.slice(0, 3)}
                          </span>
                          <p className="relative text-[13px] text-fg/65">{month.wrapped ? "Your month, wrapped" : "Your month so far"}</p>
                          <p className="relative mt-1 font-display text-[27px] font-semibold leading-[1.1]">{month.name} in numbers</p>
                          <div className="relative mb-4 mt-5 flex flex-wrap items-end gap-x-4 gap-y-2 min-[360px]:gap-x-5" data-month-stats>
                            {/* No "₹0 your share": a zero is left out. */}
                            {month.share !== 0 && (
                              <p className="shrink-0">
                                <span className="block money text-[19px] font-semibold tabular-nums" data-month-share title={formatMoney(month.share, month.currency)} data-exact={formatMoney(month.share, month.currency)}>
                                  {month.converted ? "≈ " : ""}
                                  {homeMoney(month.share, month.currency)}
                                </span>
                                <span className="block whitespace-nowrap text-xs text-fg/65">your share</span>
                              </p>
                            )}
                            <p className="shrink-0">
                              <span className="block money text-[19px] font-semibold tabular-nums">{month.count}</span>
                              <span className="block whitespace-nowrap text-xs text-fg/65">{month.count === 1 ? "expense" : "expenses"}</span>
                            </p>
                            {month.top && (
                              // Whole words only: a long category wraps between words, never inside one.
                              <p className="min-w-[4.5rem] flex-1 [overflow-wrap:normal]">
                                <span className="block font-display text-[19px] font-semibold leading-tight">{month.top}</span>
                                <span className="block text-xs text-fg/65">most spent on</span>
                              </p>
                            )}
                          </div>
                          <Link href={`/search?m=${month.month}`} className={`relative mt-auto ${bannerButton}`}>
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
          )}

          {/* No tagline on Home (founder, 15 Nov): "Everyone’s in. Everything adds up." stays on the opening screen, the app's
              description, shared trip pictures and How Loopin works. */}
        </>
      )}

      {/* Not signed in: these groups live only on this device. The one sign-in banner, dismissible, just above the footer. */}
      {all.length > 0 && !account && <SignInBanner className="mt-6" />}

      <FooterLinks links={HOME_FOOTER_LINKS} className="mt-6 pb-6" />
    </>
  );
}

// "Collect money": one small row inviting a first collection.
// For someone just starting: game nights (Collect and everything else start from New group).
function PotTeaser({ className = "" }: { className?: string }) {
  return (
    <Link href="/groups/new?type=pot" className={`flex items-center gap-3 rounded-2xl border border-line px-4 py-3.5 active:bg-mist ${className}`}>
      <RowIcon d="M7 4h8a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM17 7l2.2.6a2 2 0 0 1 1.4 2.4l-2.6 9.6" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Game night? Start one</span>
        <span className="block text-xs text-gray-400">{GAME_NIGHT_GAMES}: keep the score, see who pays</span>
      </span>
      <span className="text-gray-400" aria-hidden>
        ›
      </span>
    </Link>
  );
}

// The pill-shaped buttons on the sliding cards.
const bannerButton =
  "inline-flex h-10 items-center self-start rounded-full border border-fg/25 bg-transparent px-[18px] text-sm font-semibold text-fg active:bg-fg/10";

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
