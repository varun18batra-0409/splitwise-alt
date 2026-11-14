import { neutralGameText } from "@/lib/game-words";
import Link from "@/components/Link";
import { SignInBanner } from "@/components/SignInBanner";
import { Notice } from "@/components/Notice";
import { IntroTour } from "@/components/IntroTour";
import { JoinByLink } from "@/components/JoinByLink";
import { StartHero } from "@/components/StartHero";
import { cookies, headers } from "next/headers";
import { visitorRegion } from "@/lib/region";
import { GAME_NIGHT_GAMES } from "@/lib/group-types";
import { getTimeZone } from "@/lib/tz";
import { getAccount, getMemberships } from "@/lib/identity";
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
import { monthNumbers, seasonNow } from "@/lib/home/banner";
import { HomeBanner } from "@/components/HomeBanner";
import { HighlightCard } from "@/components/HighlightCard";
import { homeHighlights } from "@/lib/home/highlights";
import { parseHandPlaces } from "@/lib/passport";
import { nextDueDay } from "@/lib/home/bills";
import { ActivityRow } from "@/components/ActivityRow";
import { itemHref } from "@/lib/paths";
import { db } from "@/lib/db";
import { leaverOf } from "@/lib/left-view-db";
import { gameVisible, stillIn } from "@/lib/left-view";
import { canUndo } from "@/lib/undo";
import { UndoBar } from "@/components/UndoBar";
import { BellButton } from "@/components/BellButton";
import { countMyCollections, myCollections, progress } from "@/lib/collect";
import { CollectionsSection } from "@/components/CollectionsList";
import { FooterLinks, HOME_FOOTER_LINKS } from "@/components/FooterLinks";
import { countdownWords, placeOf, tripPhase, type TripPhase } from "@/lib/countdown";
import { todayKey } from "@/lib/dates";
import { countryOf, tripStops } from "@/lib/geo";
import { ComingUp, MoneyCard, type NeedLine, type StubCover, type TripPassView } from "@/components/HomeMoney";
import { homeTicket, mixedDirections, moneyMode, moneyPeople, rankGroups, type GroupFacts, type InvolvedGroup } from "@/lib/home/money-card";
import { Stories } from "@/components/Stories";
import { buildStories } from "@/lib/home/stories";
import { loadHomeMemories, loadMomentStoryGroups } from "@/lib/moments-db";
import { MemoryPolaroids } from "@/components/MemoryPolaroids";
import { comingUp } from "@/lib/home/coming-up";
import { passPhoto, type PassGroup } from "@/lib/home/pass-photo";
import { countryPhoto } from "@/lib/country-photos";
import { loadMyWishes } from "@/lib/wishes-db";
import { photoSet, placePhotos, tripPhotoSrc } from "@/lib/places";
import { GroupCards, type GroupCardData } from "@/components/HomeGroups";
import { loadNeedsYou } from "@/lib/needs-you";
import { unreadPostcards } from "@/lib/blocks";
import { BILL_DUE_DAYS, billDueNeeds, needLine, postcardNeed, type DueBill, type NeedItem } from "@/lib/home/need-line";
import { tripEmoji } from "@/lib/countdown";
import { payersOf, spentAmount } from "@/lib/payers";
import { getCategory } from "@/lib/categories";
import { daysBetween } from "@/lib/countdown";
import { parsePlayers, potSummary } from "@/lib/pot";

export const metadata = { alternates: { canonical: "/" } };

const countPasskeys = (accountId: string) => db.passkey.count({ where: { accountId } });

// Home: stories, your money card (a boarding pass: route, amount, one button; what needs you is a quiet line under it), your groups as polaroids, and the
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
  // Independent reads, all at once. (`dueSoon` is filled by the needs-you read, from the bill statuses it already works out.)
  const dueSoon: DueBill[] = [];
  const [overview, deletedGroups, account, collections, collectionsTotal, invitations, needs, momentGroups, postcardsNew] = await Promise.all([
    loadOverview(memberships),
    loadDeletedGroups(memberships),
    getAccount(),
    getAccount().then((a) => (a ? myCollections(a.id) : [])),
    getAccount().then((a) => (a ? countMyCollections(a.id) : 0)),
    // Groups someone added you to, waiting for Join or Not now.
    getAccount().then((a) => loadInvitations(a)),
    // Things only you can answer (someone says they paid you, a bill waiting for its amount): the top two show on Home.
    getAccount().then((a) => loadNeedsYou(memberships, a, 0, new Date(), dueSoon)),
    // New moments in your trip groups (the last 3 days; only ones you may see).
    loadMomentStoryGroups(memberships),
    // Postcards that arrived and are unread (none from people you blocked, none still sealed).
    getAccount().then((a) => (a ? unreadPostcards(a.id) : 0)),
  ]);
  const { all, open, closed, owedLines, oweLines, common, netCommon, netLines, netValue, toCommon } = overview;
  // Only the rows Home shows: the newest changes, this month, today's spending on trips, a finished trip's categories.
  const now = new Date();
  const today = todayKey(now, tz);
  const [rows, memories, wishes] = await Promise.all([
    loadHomeRows(all, { tz, now, today }),
    // The newest moments this person may see: the Memories polaroids under the story circles.
    loadHomeMemories(memberships),
    // Want to go: the stub's picture when nothing else fits.
    account ? loadMyWishes(account.id) : Promise.resolve([] as string[]),
  ]);

  // Undo bar after a change made from the home screen (e.g. closing a group).
  let undoBar: { text: string; groupId: string; eventId: string } | null = null;
  if (did && didGroup && memberships[didGroup] && !(await leaverOf(memberships[didGroup]))) {
    const ev = await db.groupEvent.findFirst({ where: { id: did, groupId: didGroup } });
    // Only changes from then on matter for whether it can still be undone.
    const events = ev ? await db.groupEvent.findMany({ where: { groupId: didGroup, createdAt: { gte: ev.createdAt } } }) : [];
    if (ev && canUndo(ev, events).ok) {
      const grp = all.find((x) => x.group.id === didGroup);
      const actor = ev.actorId === memberships[didGroup] ? "You" : grp?.group.members.find((m) => m.id === ev.actorId)?.name ?? "Someone";
      undoBar = { text: undone ? "Undone." : `${actor} ${neutralGameText(ev.text)}${grp ? ` · ${grp.group.name}` : ""}`, groupId: didGroup, eventId: ev.id };
    }
  }

  // Needs you: one line at the bottom of the money card, the most important first ("... and 2 more" when there are several): things only you can
  // answer, a flat bill due soon and a postcard that arrived. Money you owe or are owed is the card's job, new updates are the Alerts badge's,
  // and "this group is all square, close it" lives in Updates and on the group's own page: none of them repeats here. (src/lib/home/need-line.ts has the rules.)
  const NEED_ACTION: Record<"claim" | "payment" | "bill" | "collect", string> = { claim: "Confirm", payment: "Confirm", bill: "Add", collect: "Confirm" };
  const postcardItem = postcardNeed(postcardsNew);
  const needItems: NeedItem[] = [
    ...needs.items.map((it) => ({ key: it.id, kind: it.kind, text: it.text, action: it.action ?? NEED_ACTION[it.kind], href: it.href, orange: it.tone === "orange" })),
    ...billDueNeeds(dueSoon, today),
    ...(postcardItem ? [postcardItem] : []),
  ];

  // The latest changes across open groups.
  const recent = open
    .flatMap((g) => {
      const mine = rows.recent.get(g.group.id);
      if (!mine) return [];
      const names = new Map(g.group.members.map((m) => [m.id, m.id === g.myId ? "You" : m.name]));
      return buildActivity(mine.expenses, mine.payments, g.myId).map((item) => ({
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
  const month = monthNumbers(rows.monthGroups, toCommon, common, now, tz);
  const region = visitorRegion(await headers());
  // Stories about how a group is now (countdown, a year ago, just back, wrapped, hero) skip groups the viewer left.
  const live = stillIn(open);
  const byActivity = [...live].sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  // The balance card's big number (all groups together, or per currency).
  // Big amounts show whole units (display only); the exact amount rides along in the tooltip.
  const heroOf = (money: (n: number) => string) =>
    netCommon ? `${netCommon.converted ? "≈ " : ""}${netCommon.value > 0 ? "+" : netCommon.value < 0 ? "−" : ""}${money(Math.abs(netCommon.value))}` : netLines.join(" · ");
  const heroText = heroOf((n) => formatMoney(n, common)); // exact, the same figure as the group and Settle up (rounding stays on summaries)
  const heroExact = heroOf((n) => formatMoney(n, common));
  // Several currencies with no saved rate and money going both ways: no single "you owe", so the card stays neutral.
  const acrossCurrencies = !netCommon && mixedDirections(netLines);
  const mode = acrossCurrencies ? "even" : moneyMode({ owedLines: owedLines.length, oweLines: oweLines.length, netValue });
  // Who the money is with, each side on its own: the same transfers Settle up uses, largest first. Money both ways stays as two lines
  // on the ticket (never netted together), so both sides are worked out whenever anything is open.
  const peopleGroups = open.map((g) => ({ groupId: g.group.id, groupName: g.group.name, currency: g.group.currency, myId: g.myId, members: g.group.members, transfers: g.transfers }));
  const owePeople = mode === "square" ? [] : moneyPeople(peopleGroups, "owe", common, toCommon);
  const owedPeople = mode === "square" ? [] : moneyPeople(peopleGroups, "owed", common, toCommon);
  // The groups the money runs through, for the stub's picture: how much is with you in each (in the common currency; a group with no
  // saved rate counts 0 and only wins when nothing else is there).
  const involved: InvolvedGroup[] = open
    .filter((g) => !g.leaver && g.transfers.some((t) => t.from === g.myId || t.to === g.myId))
    .map((g) => ({
      id: g.group.id,
      name: g.group.name,
      type: g.group.type,
      weight: g.transfers
        .filter((t) => t.from === g.myId || t.to === g.myId)
        .reduce((sum, t) => sum + (g.group.currency === common ? t.amount : (toCommon(t.amount, g.group.currency) ?? 0)), 0),
    }));
  const ticket = homeTicket({
    mode,
    acrossCurrencies,
    owe: owePeople,
    owed: owedPeople,
    common,
    hero: { text: heroText.replace(/^([≈ ]*)[+−]/, "$1"), exact: heroExact !== heroText ? heroExact.replace(/^([≈ ]*)[+−]/, "$1") : undefined },
    groups: involved,
  });
  // What waits on you, folded into the card as one line.
  const need: NeedLine | null = needLine(needItems);
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
    const list = (rows.today.get(g.group.id) ?? []).filter((e) => e.kind !== "pot" && e.kind !== "refund" && dayOf(e.spentAt ?? e.createdAt) === today);
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
    moments: momentGroups,
    // A trip that is still to come is the countdown line (never also a circle); a trip that is on, or its moments, keep theirs.
    trips: trips.filter((t) => t.phase.kind !== "before").map((t) => ({
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
  }));
  const stopsOf = (g: (typeof all)[number]) => tripStops(g.group.name, g.group.tripPlace ?? "", g.group.tripCountry ?? "");
  const homeCountry = (account?.homeCountry || region.country || "IN").toUpperCase();
  // The stub's picture(s), as a fallback: the group with the most money (two when it spans groups), else your newest group. Same cover as its polaroid.
  const stubCover = (id: string): StubCover | null => {
    const c = groupCards.find((x) => x.id === id);
    return c ? { id: c.id, cover: c.cover, photo: c.photo, name: c.name } : null;
  };
  const stubIds = ticket.kind === "square" || (ticket.kind === "neutral" && involved.length === 0) ? byActivity.slice(0, 1).map((g) => g.group.id) : rankGroups(involved).slice(0, 2).map((g) => g.id);
  const groupStub = stubIds.map(stubCover).filter((c): c is StubCover => Boolean(c));
  // The money pass's picture (src/lib/home/pass-photo.ts): a different photo of the trip where you owe most; a home interior for flat or
  // couple money; else a country you've been to, one you want to go to, or a good travel photo. Never a polaroid's own photo.
  const common3 = (g: (typeof open)[number], n: number) => (g.group.currency === common ? n : (toCommon(n, g.group.currency) ?? 0));
  const passGroups: PassGroup[] = open
    .filter((g) => !g.leaver)
    .map((g) => {
      const mine = g.transfers.filter((t) => t.from === g.myId || t.to === g.myId);
      const placeOfGroup = g.group.type === "trip" ? placePhotos(g.group.name, g.group.tripPlace) : [];
      return {
        id: g.group.id,
        type: g.group.type,
        iOwe: mine.some((t) => t.from === g.myId),
        isOwed: mine.some((t) => t.to === g.myId),
        owe: mine.filter((t) => t.from === g.myId).reduce((sum, t) => sum + common3(g, t.amount), 0),
        owed: mine.filter((t) => t.to === g.myId).reduce((sum, t) => sum + common3(g, t.amount), 0),
        spend: common3(g, g.spent),
        photos: placeOfGroup,
        cover: tripPhotoSrc(g.group),
      };
    })
    .filter((g) => g.iOwe || g.isOwed);
  // Countries you've been to, newest first: trips that have started, then ones ticked by hand (newest last in the list); home last.
  const visitedCodes = [
    ...all
      .filter((g) => g.group.type === "trip" && !g.group.deletedAt && g.group.tripStart && g.group.tripStart <= today)
      .sort((a, b) => b.group.tripStart.localeCompare(a.group.tripStart))
      .flatMap((g) => stopsOf(g).map((st) => st.country || homeCountry)),
    ...(account ? parseHandPlaces(account.places).map((pl) => pl.c).reverse() : []),
  ];
  const visitedNewest = [...new Set(visitedCodes.filter((c) => c !== homeCountry)), ...(visitedCodes.includes(homeCountry) ? [homeCountry] : [])];
  const avoidPhotos = groupCards.flatMap((c) => (c.photo ? [c.photo] : []));
  const photoFor = (side: "owe" | "owed" | null): StubCover[] => {
    const p = passPhoto({
      side,
      groups: passGroups,
      avoid: avoidPhotos,
      interiors: [...photoSet("home"), ...photoSet("cover-home")],
      visited: visitedNewest,
      want: [...wishes].reverse(),
      general: ["cover-beach", "cover-city", "cover-mountains", "cover-lake", "hero", "sunset"].flatMap((slot) => photoSet(slot)),
      countryPhoto: (code) => countryPhoto(code),
    });
    return p ? [{ id: `pass-${p.source}-${side ?? "all"}`, cover: { kind: "plain" }, photo: p.src, name: "Loopin" }] : [];
  };
  const stub = photoFor(ticket.kind === "one" ? ticket.line.side : null).length ? photoFor(ticket.kind === "one" ? ticket.line.side : null) : groupStub;
  // Each pass of a both-ways stack has the picture for its own side; no photo to pick: the picture of the groups its money runs through.
  const sideStub = (ids: string[]) =>
    rankGroups(involved.filter((g) => ids.includes(g.id)))
      .slice(0, 2)
      .map((g) => stubCover(g.id))
      .filter((c): c is StubCover => Boolean(c));
  const sideStubs =
    ticket.kind === "both"
      ? {
          owe: photoFor("owe").length ? photoFor("owe") : sideStub(ticket.lines.find((l) => l.side === "owe")?.groupIds ?? []),
          owed: photoFor("owed").length ? photoFor("owed") : sideStub(ticket.lines.find((l) => l.side === "owed")?.groupIds ?? []),
        }
      : undefined;
  // The pass's SINCE and ITEMS fields: per group with money open, the first item added since the group's last payment and how many there
  // are (what has built up since the last settle-up). A group that can't be read just leaves its fields out.
  const facts: Record<string, GroupFacts> = {};
  if (ticket.kind === "one" || ticket.kind === "both") {
    await Promise.all(
      involved.map(async (g) => {
        const after = open.find((x) => x.group.id === g.id)?.lastPaymentAt ?? null;
        const where = { groupId: g.id, deletedAt: null, ...(after ? { createdAt: { gt: after } } : {}) };
        try {
          const [first, items] = await Promise.all([db.expense.findFirst({ where, orderBy: { createdAt: "asc" }, select: { spentAt: true, createdAt: true } }), db.expense.count({ where })]);
          facts[g.id] = { since: first ? todayKey(first.spentAt ?? first.createdAt, tz) : null, items };
        } catch {
          /* left out */
        }
      }),
    );
  }
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

  // The sliding cards (4 to 7), picked for what's useful right now. Nothing here repeats what is already on Home: the Coming up passes say
  // their trips' usual weather, and the needs-you line says a bill due within 3 days and new postcards, so those are left out below.
  const season = seasonNow(new Date(), tz, region.country);
  // A group they left shows no bills.
  const billRows = await db.bill.findMany({ where: { groupId: { in: open.filter((g) => !g.leaver).map((g) => g.group.id) }, deletedAt: null, paused: false }, take: 20 });
  // The same count as the passport: countries with a stamp or a tick (home only if it has one).
  const passportSet = new Set(
    [
      ...(account ? parseHandPlaces(account.places).map((p) => p.c) : []),
      ...all
        .filter((g) => g.group.type === "trip" && !g.group.deletedAt && (g.group.tripStart ? g.group.tripStart <= today : g.expenseCount > 0))
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
      .filter((g) => g.group.type === "trip" && g.group.tripStart && g.expenseCount > 0)
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
    // New postcards are the needs-you line's: no card for them (the "Send a postcard" card still comes).
    postcardsNew: 0,
    // A bill due within 3 days is the needs-you line's; the card only brings up one 4 to 5 days away.
    billsDue: billRows.flatMap((b) => {
      const due = nextDueDay(b, new Date());
      const g = open.find((x) => x.group.id === b.groupId);
      if (!due || !g || b.nature === "daily") return [];
      const inDays = daysBetween(today, due);
      if (inDays <= BILL_DUE_DAYS) return [];
      return [{ groupId: b.groupId, billId: b.id, name: b.name, group: g.group.name, inDays, amount: b.nature === "fixed" && b.amount ? formatMoney(b.amount, g.group.currency) : "" }];
    }),
    passportCountries: passportSet.size,
    // Said alongside, so "23 countries" next to a list of 22 abroad makes sense.
    passportAbroad: [...passportSet].filter((c) => c !== homeCountry).length,
    groups: open.length,
    fahrenheit: usesFahrenheit(region.country),
    // The Coming up passes already say their trips' usual weather.
    skipWeather: passes.map((p) => p.id),
    // Real photos (slots card-passport and card-postcards in scripts/fetch-photos.mjs); none downloaded: the drawn art.
    scenes: { passport: photoSet("card-passport")[0], postcards: photoSet("card-postcards")[0] },
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

      {/* Just the wordmark and the bell. The app install and "How Loopin works" live in You. */}
      <header className="mb-4 flex items-center justify-between">
        <p className="font-display text-[26px] font-semibold leading-none tracking-tight">loopin</p>
        <BellButton className="glass border border-fg/10" />
      </header>

      {/* Someone added you to a group: it isn't in your groups until you tap Join. */}
      {all.length === 0 && invitationsBlock}

      {all.length === 0 ? (
        <>
          {/* Start screen: nothing here yet. Two photos and a receipt, the promise, then the ways in. */}
          <section aria-label="Start" className="text-fg" data-start-card>
            <StartHero />
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
                  Already here? <span className="font-semibold text-fg underline underline-offset-4">Sign in</span>
                </Link>
              </p>
            )}
            <p className="mt-1 text-center text-xs text-fg/55">
              <Link href="/terms" className="inline-flex min-h-11 items-center px-2">
                Terms
              </Link>
              <span aria-hidden>·</span>
              <Link href="/privacy" className="inline-flex min-h-11 items-center px-2">
                Privacy
              </Link>
            </p>
          </section>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Link href="/switching" className="flex min-h-[84px] flex-col justify-center rounded-2xl border border-line px-4 py-3 active:bg-mist [&>span]:[text-wrap:balance]">
              <span className="text-[13px] text-fg/55">Coming from another app?</span>
              <span className="mt-0.5 text-sm font-medium leading-snug text-fg/85 [text-wrap:balance]">Bring your groups over</span>
            </Link>
            <Link href="/how-it-works" className="flex min-h-[84px] flex-col justify-center rounded-2xl border border-line px-4 py-3 active:bg-mist [&>span]:[text-wrap:balance]">
              <span className="text-[13px] text-fg/55">How Loopin works</span>
              <span className="mt-0.5 text-sm font-medium leading-snug text-fg/85 [text-wrap:balance]">Three steps, one minute</span>
            </Link>
          </div>

          <section className="mt-8">
            <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">Quick start</h2>
            <div className="lp-rise grid grid-cols-2 gap-4 px-1 pt-1">
              {[
                ["trip", "Trip", "Goa trip"],
                ["home", "Home", "Flat expenses"],
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
          {/* Stories on top, like Instagram: a row of circles. Hidden when there are none (then a greeting fills the space). */}
          <h1 className={stories.length > 0 ? "sr-only" : "mb-4 mt-1 font-display text-[32px] font-semibold leading-[1.05] tracking-tight"}>{greeting(new Date(), tz, account?.name)}</h1>
          {stories.length > 0 && <Stories stories={stories} className="mb-4" />}
          {/* Memories: square polaroids of recent moments you may see. Nothing at all when there are none. */}
          <MemoryPolaroids memories={memories} />

          {/* Money: a boarding pass with the route, the amount and the one next step; what needs you is a quiet line under it. */}
          <MoneyCard ticket={ticket} mode={mode} tone={mode === "owed" ? "owed" : mode === "owe" ? "owe" : "plain"} stub={stub} sideStubs={sideStubs} facts={facts} year={today.slice(0, 4)} need={need} />

          {invitationsBlock}

          {/* Groups: polaroids you swipe sideways. "See all" opens the full list. */}
          <section className="mt-5" aria-labelledby="home-groups-h">
            <div className="flex items-baseline justify-between">
              <h2 id="home-groups-h" className="font-display text-[20px] font-semibold tracking-tight">Your groups</h2>
              <Link href="/groups" className="flex min-h-11 items-center text-sm font-medium text-fg/85">
                See all
              </Link>
            </div>
            {byActivity.length === 0 ? (
              <p className="py-4 text-sm text-gray-500">No open groups. Create one, or reopen a closed one.</p>
            ) : (
              <div className="-mt-2">
                <GroupCards groups={groupCards} total={byActivity.length} />
              </div>
            )}
          </section>

          {/* Coming up: one boarding pass per upcoming trip, swiped sideways. */}
          <ComingUp passes={passes} />

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
                      <ActivityRow item={r.item} currency={r.currency} nameOf={r.nameOf} groupName={r.groupName} dateLabel={dayLabel(r.item.date, new Date(), tz)} motion="loop" delay={0.6 + (i % 5)} />
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

          <div className="mt-8">
            {/* The sliding cards, picked for you: the trip you're on, a trip just over, a bill a few days off, your month, a festival where
                you live, your passport and postcards. Swipe, tap a dot, or pause; they glide by themselves unless animations are off. */}
            <HomeBanner>
              {highlights.map((h) =>
                h.kind === "month" ? (
                  month && (
                    <div key="month" className="flex flex-1 flex-col">
                      <div className="relative flex min-h-[268px] flex-1 flex-col overflow-hidden bg-[linear-gradient(150deg,#2a1f1c_0%,#17151a_60%,#101012_100%)] px-5 pb-12 pt-5" data-month-card>
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
        </>
      )}

      {/* Not signed in: these groups live only on this phone. The one sign-in banner, dismissible, just above the footer. */}
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
