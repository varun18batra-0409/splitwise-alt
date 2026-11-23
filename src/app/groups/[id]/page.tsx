import { neutralGameText } from "@/lib/game-words";
import { peopleShown } from "@/lib/left-view";
import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { getAccount, getMemberships, guestGroupsOnPhone, privatePath } from "@/lib/identity";
import { googleConfigured } from "@/lib/google";
import { invitationFor } from "@/lib/invitations";
import { PendingGroup } from "./_components/PendingGroup";
import { LeftBanner, LeftFootnote, LeftSections } from "./_components/LeftBanner";
import { eventsFrom, loadBalancesSummary, loadGroupView, loadSwitchList } from "@/lib/group-data";
import { db } from "@/lib/db";
import { receiptsFor } from "@/lib/receipts-db";
import { bounceIfDirect } from "@/lib/direct-db";
import { canUndo, originAtDb, ownMoveOut } from "@/lib/undo";
import { passportZone } from "@/lib/passport";
import { UndoBar } from "@/components/UndoBar";
import { balancesDataFull, balancesDataSummary, buildGroupView, buildSummaryView, type GroupEvent, type LiteView } from "./_components/view";
import { getTimeZone } from "@/lib/tz";
import { GroupHeader } from "./_components/GroupHeader";
import { ClosedBanner, MoneyTicket } from "./_components/GroupSummary";
import { GroupNotices } from "./_components/GroupNotices";
import { GuestCard } from "./_components/GuestCard";
import { SigninPrompt } from "@/components/SigninPrompt";
import { readNotes } from "@/lib/flash";
import { ActivityTab } from "./_components/ActivityTab";
import { PeopleTab } from "./_components/PeopleTab";
import { RecapTab } from "./_components/RecapTab";
import { OverviewTab, GroupFooter } from "./_components/OverviewTab";
import { MemoriesTab } from "./_components/MemoriesTab";
import { groupTabs, litTab, resolveTab, subPageTitle, type TabId } from "./_components/tabs";
import { SubPageHeader } from "./_components/SubPageHeader";
import { ThisMonthTab } from "./_components/ThisMonthTab";
import { BillsTab } from "./_components/BillsTab";
import { ListTab } from "./_components/ListTab";
import { usualItems } from "@/lib/home/list";
import { budgetsNow } from "@/lib/home/budgets-db";
import { monthInsights } from "@/lib/home/insights-db";
import { billStatuses } from "@/lib/home/bills-db";
import { niceDate } from "@/lib/format";
import { dayKey } from "@/lib/dates";
import { Notice } from "@/components/Notice";
import { GroupTypeSheet } from "@/components/GroupTypeSheet";
import { offersTypeSheet } from "@/lib/group-type-sheet";
import { GamesTab } from "./_components/GamesTab";
import { gamesToSettle, loadGames } from "@/lib/pot-db";
import { canAddMoment, loadMomentViewer } from "@/lib/moments-access";
import { listMoments, momentStrip } from "@/lib/moments-db";
import { loadGroupPostcards, tripStampCard } from "@/lib/group-memories";
import { sinceLastPayment } from "@/lib/home/money-card";
import { headers } from "next/headers";
import { visitorRegion } from "@/lib/region";
import { OfflineKeeper } from "@/components/offline/OfflineKeeper";
import { buildSnapshot } from "@/lib/offline/snapshot";
import { offlineOn } from "@/lib/offline/words";
import { splitNameFor } from "@/lib/group-types";

// A group: header, then its tabs. Trips and other groups: Overview / Expenses / People / Memories (Trip recap sits behind the Overview).
// Flats and couples: This month (their Overview) / Expenses / People. Card nights: Games / Balances / Activity. The addresses are the old ones
// (?tab=activity is Expenses, ?tab=balances is People, ?tab=charts is Trip recap); see _components/tabs.ts.
export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    open?: string;
    saved?: string;
    bought?: string;
    told?: string;
    added?: string;
    skipped?: string;
    paid?: string;
    error?: string;
    did?: string;
    undone?: string;
    q?: string;
    cat?: string;
    who?: string;
    type?: string;
    from?: string;
    to?: string;
    by?: string;
    min?: string;
    max?: string;
    why?: string;
    n?: string;
    imported?: string;
    removed?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // A pair of two people has no group page: its person page (which also decides who may see it), keeping the same query.
  await bounceIfDirect(id, sp);
  const notes = await readNotes(sp, `/groups/${id}`);

  // Who you are here, then the ledger, the time zone and the switcher list all
  // at once (each is a trip to the database; one after another they add up).
  const memberships = await getMemberships();
  const myId = memberships[id];
  if (!myId) {
    const exists = await db.group.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!exists) notFound();
    // Someone added you here and you haven't answered yet: the invitation, not the group.
    const invitation = await invitationFor(await getAccount(), id);
    if (invitation) return <PendingGroup inv={invitation} />;
    // This device's old guest name was linked to an email since: say so, rather than "you're not in this group".
    redirect(await privatePath(id));
  }
  // Only Expenses shows the history (up to 500 rows); every other tab skips it. An Undo bar loads just what it needs below.
  const raw = (sp.tab ?? "").toLowerCase();
  const noHistory = raw !== "activity" && raw !== "expenses";
  // People (the Balances tab): for someone still in the group the database adds the balances up and no share is loaded (loadBalancesSummary).
  // It says "use the full method" (null) for a card night, someone who left, or anything odd in the numbers; then it is loaded as before.
  const wantsSummary = raw === "balances" || raw === "people";
  const [summary, firstFull, tz, switchTo, account] = await Promise.all([
    wantsSummary ? loadBalancesSummary(id, myId, { why: sp.why }) : Promise.resolve(null),
    wantsSummary ? Promise.resolve(null) : loadGroupView(id, noHistory ? { viewer: myId, events: false } : { viewer: myId }),
    getTimeZone(),
    loadSwitchList(memberships, id),
    getAccount(),
  ]);
  const full = summary ? null : wantsSummary ? await loadGroupView(id, { viewer: myId, events: false }) : firstFull;
  const data = summary ?? full;
  if (!data) notFound();
  // Still in it? (A removed person's phone can remember the group.)
  if (!data.group.members.some((m) => m.id === myId)) redirect(await privatePath(id));

  // Which tab opens (the loaded group already says its type and whether you left), so the view below only reads what that tab shows.
  const leaver = data.leaver;
  // A group that isn't a trip shows Memories only once you have a postcard in it.
  const hasPostcards = data.group.type !== "trip" && !leaver?.removed && account ? (await db.postcard.count({ where: { groupId: data.group.id, OR: [{ fromId: account.id }, { toId: account.id }] } })) > 0 : false;
  const tabs = groupTabs({ type: data.group.type, leaver: leaver ? { removed: Boolean(leaver.removed) } : null, hasPostcards });
  const tab: TabId = resolveTab(sp.tab, tabs, { type: data.group.type, leaver: leaver ? { removed: Boolean(leaver.removed) } : null });
  // `fv`: the full view (every screen but the summary Balances). `v`: what the parts every tab shares read (a full view is one too).
  const fv = full ? await buildGroupView(full, myId, tz, { moveOuts: tab === "activity" || tab === "overview" }) : null;
  const v: LiteView = fv ?? (await buildSummaryView(summary!, myId, tz));
  const { group } = v;
  const guestHere = group.members.find((m) => m.id === myId)?.accountId === null; // my row here has no account
  // Someone who left (or was removed) sees Overview (their own money), Expenses and People, and Memories read-only (not if removed).
  const home = !leaver && (group.type === "home" || group.type === "couple");
  const pot = !leaver && group.type === "pot";

  // Home & Couple: everything This month / Bills / List need, fetched together.
  const monthTab = home && tab === "month";
  const active = fv ? fv.group.expenses.filter((e) => !e.deletedAt) : [];
  const activeCount = fv ? active.length : v.expenses.length; // (the summary's slim list holds only the ones that count)
  const [bills, budgets, depositShares, heads, goalRows, list, games, shopRows] = await Promise.all([
    home && (tab === "month" || tab === "bills") ? billStatuses(group.id) : Promise.resolve<Awaited<ReturnType<typeof billStatuses>>>([]),
    monthTab ? budgetsNow(group.id, active, myId, v.tz) : Promise.resolve<Awaited<ReturnType<typeof budgetsNow>>>([]),
    // The deposit tile (held shares only).
    monthTab ? db.depositShare.findMany({ where: { deposit: { groupId: group.id }, status: "held" } }) : Promise.resolve([] as { amount: number; memberId: string }[]),
    // Heads up and next month's estimate.
    // The Bills tab shows the same estimate (one function, one number), so it asks for it too.
    monthTab || (home && tab === "bills")
      ? monthInsights(group.id, active, myId, Object.fromEntries(group.members.filter((m) => !m.leftAt).map((m) => [m.id, m.splitWeight])), group.currency, v.tz)
      : Promise.resolve<Awaited<ReturnType<typeof monthInsights>> | null>(null),
    // Savings goals (kept count of only).
    monthTab
      ? db.goal.findMany({ where: { groupId: group.id, deletedAt: null }, include: { entries: { select: { amount: true } } }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([] as { id: string; name: string; target: number; entries: { amount: number }[] }[]),
    // The shopping list: what's open now, and the usual things for quick adding.
    home && tab === "list"
      ? Promise.all([
          db.listItem.findMany({ where: { groupId: group.id, expenseId: "" }, orderBy: { createdAt: "asc" } }),
          db.listItem.findMany({ where: { groupId: group.id }, orderBy: { createdAt: "desc" }, take: 200, select: { text: true } }),
        ]).then(([items, history]) => ({ items, usual: usualItems(history.map((h) => h.text), items.map((i) => i.text)) }))
      : Promise.resolve(null),
    pot && tab === "games" ? loadGames(group.id) : Promise.resolve([] as Awaited<ReturnType<typeof loadGames>>),
    // The overview's shopping card: the first few things still to buy (the same rows the List tab shows as "To buy").
    monthTab ? db.listItem.findMany({ where: { groupId: group.id, expenseId: "", boughtAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, text: true } }) : Promise.resolve([] as { id: string; text: string }[]),
  ]);
  const toSettle = games.length ? await gamesToSettle(group.id, games) : {};
  // Reactions on expenses, for the Activity list (someone who left sees only those made by their last day).
  const reactions = tab === "activity" && group.expenses.length ? await db.reaction.findMany({ where: { expenseId: { in: group.expenses.map((e) => e.id) }, ...(leaver ? { createdAt: { lte: leaver.leftAt } } : {}) }, select: { expenseId: true, memberId: true, emoji: true } }) : [];
  // Results of finished games: they change through the game (other card-game rows, e.g. imported ones, are ordinary).
  // Loaded whatever the group type now is: a card-night group can later become a trip and keep its games.
  const gameResultIds = tab === "activity" ? (await db.potGame.findMany({ where: { groupId: group.id, resultId: { not: "" } }, select: { resultId: true } })).map((g) => g.resultId) : [];
  const receipts = tab === "activity" && group.expenses.length ? await receiptsFor(group.id, leaver?.leftAt ?? null) : [];
  const today = dayKey(new Date(), v.tz);
  const comingUp = bills
    .filter((b) => b.status === "waiting" || b.status === "upcoming")
    .sort((a, b) => (a.status === "waiting" ? -1 : b.status === "waiting" ? 1 : a.due.localeCompare(b.due)))
    .slice(0, 5)
    .map((b) => ({
      id: b.bill.id,
      name: b.bill.name,
      icon: b.bill.icon,
      when:
        b.status === "waiting" || b.bill.nature === "varies"
          ? `${b.due < today ? "Was due" : "Due"} ${niceDate(b.due)}`
          : b.bill.nature === "daily"
            ? `${b.due < today ? "Totalled" : "Totals on"} ${niceDate(b.due)}`
            : `Repeats · next ${niceDate(b.due)}`,
      who: b.payerId ? (b.payerId === myId ? "you pay" : `${v.nameOf(b.payerId)} pays`) : "taking turns",
      amount: b.bill.nature === "varies" ? (b.usual ? `~${v.money(b.usual)}` : "") : b.bill.nature === "daily" ? `${v.money(b.bill.amount)} a day` : v.money(b.bill.amount),
      status: (b.status === "waiting" ? "enter" : "due") as "enter" | "due",
      href: b.status === "waiting" ? `/groups/${group.id}/add?bill=${b.bill.id}&period=${b.period}` : undefined,
    }));

  const deposit = depositShares.length
    ? { total: depositShares.reduce((s, d) => s + d.amount, 0), mine: depositShares.find((d) => d.memberId === myId)?.amount ?? 0 }
    : null;

  const goals = goalRows.map((g) => ({ id: g.id, name: g.name, target: g.target, saved: g.entries.reduce((s, e) => s + e.amount, 0) }));

  // Right after a change: offer Undo (or Redo after an undo).
  // (Without the history: that change and the ones after it. Someone who left keeps the full, scoped history.)
  let undoEvents: GroupEvent[] = group.events;
  if (noHistory && sp.did) {
    undoEvents = leaver ? ((await loadGroupView(id, { viewer: myId }))?.group.events ?? []) : await eventsFrom(group.id, sp.did);
  }
  const justDid = sp.did ? undoEvents.find((x) => x.id === sp.did) : undefined;
  const showUndo = justDid && (v.leaverChecks.get(justDid.id) ?? canUndo(justDid, undoEvents, new Date(), v.undoViewer, noHistory ? await originAtDb(justDid) : undefined)).ok; // (the 10 minutes count from the original recording, as on the server)
  // Someone who moved out themselves (not removed) can undo it from here: the line and whether the server would allow it right now.
  const ownMove = leaver && !leaver.removed ? await ownMoveOut(group.id, v.undoViewer, new Date()) : null;

  // "Our moments" (trip groups only): the small strip on Overview, and the whole list on Memories, as far as this person may see them.
  // (Only Overview and Memories use it, so the other tabs skip its three reads.)
  const momentViewer = group.type === "trip" && (tab === "overview" || tab === "memories") ? await loadMomentViewer(group.id, myId) : null;
  const strip = momentViewer && tab === "overview" ? { ...(await momentStrip(momentViewer)), canAdd: canAddMoment(momentViewer) } : null;
  const memories =
    tab === "memories"
      ? await (async () => {
          const homeCountry = (account?.homeCountry || visitorRegion(await headers()).country || "IN").toUpperCase();
          const [cards, postcards] = await Promise.all([momentViewer ? listMoments(momentViewer) : Promise.resolve([]), account ? loadGroupPostcards(account.id, group.id) : Promise.resolve([])]);
          const stamp = group.type === "trip" ? tripStampCard({ id: group.id, name: group.name, tripStart: group.tripStart, tripEnd: group.tripEnd, tripPlace: group.tripPlace ?? "", tripCountry: group.tripCountry ?? "", memberCount: leaver ? peopleShown(group.members, myId, leaver.leftAt).length : group.members.length }, homeCountry, today, leaver?.leftAt ?? null, passportZone(account)) : null;
          return { cards, postcards, stamp };
        })()
      : null;
  // The Balances tab's totals: from the database's one statement, or worked out from every expense (the full method).
  const balances = tab === "balances" ? (summary ? balancesDataSummary(summary) : fv ? balancesDataFull(fv) : null) : null;
  // What has built up since the group's last payment: the pass's Since and Items fields (worked out from the rows already loaded).
  const facts = tab === "overview" || pot ? sinceLastPayment(group.expenses, group.payments, (d) => dayKey(d, v.tz)) : { since: null, items: 0 };

  // Add expenses offline (switch OFFLINE_ADD): keep a small copy of this group on the phone, worked out here. (Not for someone who left,
  // a closed group or a pair: buildSnapshot says no, and the old copy is removed.)
  const offlineCopy = offlineOn() && fv ? buildSnapshot(fv, { splitName: splitNameFor(group.type) }) : null;

  // Bills, Shopping list and Charts: their own title bar, no group picture, no tab bar, no "‹ Overview" link.
  const subTitle = subPageTitle(tab);

  return (
    <>
      {subTitle ? <SubPageHeader title={subTitle} groupId={group.id} groupName={group.name} /> : <GroupHeader v={v} switchTo={switchTo} />}
      {offlineOn() && fv && <OfflineKeeper groupId={group.id} memberId={myId} snapshot={offlineCopy} />}
      <LeftBanner v={v} ownMoveOut={ownMove} />
      {/* A refusal that needs an account opens the sign-in sheet; its sentence is the sheet, so the plain banner is not repeated. */}
      <GroupNotices sp={sp} notes={notes} />
      <SigninPrompt notes={notes} back={`/groups/${group.id}`} />
      {sp.undone === "1" && !showUndo && (
        <Notice tone="success" params={["undone"]} className="mb-5 text-sm">
          Undone.
        </Notice>
      )}
      <ClosedBanner v={v} />
      {(() => {
        const me = group.members.find((m) => m.id === myId);
        return me && me.accountId === null && !me.leftAt && !leaver && group.type !== "direct" ? <GuestCard name={me.name} groupName={group.name} groupId={group.id} /> : null;
      })()}
      {/* Card nights keep their ticket above their tabs; trips and other groups show it on the Overview only; flats show it on This month. */}
      {pot && !subTitle && <MoneyTicket v={v} facts={facts} />}
      {sp.imported && <ImportedNote code={sp.imported} groupId={group.id} />}

      {!subTitle && (
        <nav className="-mx-5 mb-5 grid border-b border-line px-5" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} aria-label="Group sections">
          {tabs.map((t) => {
            const lit = t.id === litTab(tab, tabs);
            return (
              <Link
                key={t.id}
                href={`/groups/${group.id}?tab=${t.id}`}
                aria-current={lit ? "page" : undefined}
                className={`relative flex min-h-11 items-center justify-center whitespace-nowrap pb-1 text-[14px] max-[359px]:text-[13px] font-semibold transition-colors min-[360px]:text-[15px] ${lit ? "text-fg" : "text-fg/60"}`}
              >
                {t.label}
                {lit && <span aria-hidden className="absolute inset-x-1 -bottom-px h-[2px] rounded-full bg-fg" />}
              </Link>
            );
          })}
        </nav>
      )}

      {tab === "activity" && <LeftSections v={v} />}
      {tab === "activity" && fv && (
        <ActivityTab
          v={fv}
          filter={{
            q: sp.q?.slice(0, 80),
            cat: sp.cat,
            who: sp.who,
            type: (["expense", "payment", "refund", "change"] as const).find((t) => t === sp.type),
            from: /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from : undefined,
            to: /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to : undefined,
            by: sp.by,
            min: sp.min?.slice(0, 15),
            max: sp.max?.slice(0, 15),
            tz: v.tz,
            currency: group.currency,
          }}
          shown={Number(sp.n) || undefined}
          openId={sp.open?.slice(0, 40)}
          reactions={reactions}
          receipts={receipts}
          gameResultIds={gameResultIds}
          signin={guestHere ? { groups: await guestGroupsOnPhone(), google: googleConfigured(), back: `/groups/${group.id}?tab=activity` } : undefined}
        />
      )}
      {tab === "overview" && fv && <OverviewTab v={fv} facts={facts} strip={strip} />}
      {tab === "month" && fv && (
        <>
          <ThisMonthTab v={fv} extras={{ upcoming: comingUp, budgets, deposit, goals, insights: heads?.insights, forecast: heads?.forecast, shopping: { items: shopRows.slice(0, 3), total: shopRows.length } }} />
          <div className="mt-6">
            <GroupFooter groupId={group.id} type={group.type} settings={false} />
          </div>
        </>
      )}
      {tab === "bills" && fv && <BillsTab v={fv} bills={bills} saved={sp.saved === "bill"} forecast={heads?.forecast ?? null} />}
      {tab === "list" && list && fv && (
        <ListTab v={fv} items={list.items} usual={list.usual} notice={sp.bought ? "Added as an expense. Everyone has been told." : sp.told ? "Told everyone you’re going shopping." : undefined} />
      )}
      {tab === "games" && fv && <GamesTab v={fv} games={games} toSettle={toSettle} />}
      {tab === "balances" && balances && <PeopleTab v={v} data={balances} paid={sp.paid === "1"} why={sp.why} canUndoMoveOut={group.type === "home" && Boolean(ownMove?.check.ok)} />}
      {tab === "recap" && fv && <RecapTab v={fv} />}
      {tab === "memories" && memories && fv && (
        <MemoriesTab v={fv} cards={memories.cards} stamp={memories.stamp} postcards={memories.postcards} today={today} canAdd={canAddMoment(momentViewer)} guest={Boolean(momentViewer) && momentViewer!.accountId === null} removed={sp.removed === "1"} />
      )}

      <LeftFootnote v={v} />

      {/* A brand-new flat, couple or card night: what's special about it, once on this device. */}
      {offersTypeSheet({ type: group.type, closed: group.closed, left: Boolean(leaver), activeCount }) && <GroupTypeSheet groupId={group.id} type={group.type} showNote={!(pot && tab === "games")} />}

      {showUndo && (
        <UndoBar
          key={justDid.id}
          text={sp.undone ? "Undone." : `${v.nameOf(justDid.actorId)} ${neutralGameText(justDid.text)}`}
          groupId={group.id}
          eventId={justDid.id}
          back={tab === "balances" ? "balances" : "group"}
          redo={sp.undone === "1"}
        />
      )}
    </>
  );
}

// Right after bringing a group over from another app.
function ImportedNote({ code, groupId }: { code: string; groupId: string }) {
  const [e, p, check] = code.split(".");
  const n = (x: string | undefined) => Math.max(0, Math.min(99999, Number(x) || 0));
  return (
    <Notice tone={check === "off" ? "info" : "success"} params={["imported"]} className="mb-5 text-sm">
      Brought over {n(e)} {n(e) === 1 ? "expense" : "expenses"} and {n(p)} {n(p) === 1 ? "payment" : "payments"}.{" "}
      {check === "off" ? "Balances differ slightly from the file’s own total, so have a look. " : check === "ok" ? "Balances match the file. " : ""}
      <Link href={`/groups/${groupId}/people`} className="underline">
        Invite everyone
      </Link>{" "}
      so they can take over their names.
    </Notice>
  );
}
