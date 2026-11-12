import { neutralGameText } from "@/lib/game-words";
import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { getAccount, getLinkedAwayGroups, getMemberships } from "@/lib/identity";
import { invitationFor } from "@/lib/invitations";
import { PendingGroup } from "./_components/PendingGroup";
import { LeftBanner, LeftFootnote, LeftSections } from "./_components/LeftBanner";
import { eventsFrom, loadGroupView, loadSwitchList } from "@/lib/group-data";
import { db } from "@/lib/db";
import { canUndo } from "@/lib/undo";
import { UndoBar } from "@/components/UndoBar";
import { SendPostcardCard } from "@/components/postcards/SendCard";
import { placePhoto } from "@/lib/places";
import { placeOf } from "@/lib/countdown";
import { buildGroupView, type GroupEvent } from "./_components/view";
import { getTimeZone } from "@/lib/tz";
import { GroupHeader } from "./_components/GroupHeader";
import { PhoneOnlyNote } from "@/components/PhoneOnlyNote";
import { GroupSummary } from "./_components/GroupSummary";
import { ActivityTab } from "./_components/ActivityTab";
import { BalancesTab } from "./_components/BalancesTab";
import { ChartsTab } from "./_components/ChartsTab";
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
import { GamesTab } from "./_components/GamesTab";
import { gamesToSettle, loadGames } from "@/lib/pot-db";

const TABS = [
  { id: "activity", label: "Activity" },
  { id: "balances", label: "Balances" },
  { id: "charts", label: "Charts" },
] as const;
// Home and Couple groups open on This month, with their bills and shopping list.
const HOME_TABS = [
  { id: "month", label: "This month" },
  { id: "bills", label: "Bills" },
  { id: "list", label: "List" },
  { id: "activity", label: "Activity" },
] as const;
// Pot groups (card nights) open on their games.
const POT_TABS = [
  { id: "games", label: "Games" },
  { id: "balances", label: "Balances" },
  { id: "activity", label: "Activity" },
] as const;
type Tab = "activity" | "balances" | "charts" | "month" | "bills" | "list" | "games";

// A group: header, your balance, and three tabs (Activity · Balances · Charts).
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
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

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
    // This phone's old guest name was linked to an email since: say so, rather than "you're not in this group".
    redirect((await getLinkedAwayGroups()).includes(id) ? "/private?linked=1" : "/private");
  }
  // Balances and Charts never show the history, so they skip it (up to 500 rows). An Undo bar loads just what it needs below.
  const noHistory = sp.tab === "balances" || sp.tab === "charts";
  const [data, tz, switchTo, account] = await Promise.all([loadGroupView(id, noHistory ? { viewer: myId, events: false } : { viewer: myId }), getTimeZone(), loadSwitchList(memberships, id), getAccount()]);
  if (!data) notFound();
  // Still in it? (A removed person's phone can remember the group.)
  if (!data.group.members.some((m) => m.id === myId)) redirect("/private");

  const v = await buildGroupView(data, myId, tz);
  const { group } = v;
  // Someone who left (or was removed) sees Activity, Balances (their own) and Charts only.
  const leaver = v.leaver;
  const home = !leaver && (group.type === "home" || group.type === "couple");
  const pot = !leaver && group.type === "pot";
  const tabs = home ? HOME_TABS : pot ? POT_TABS : TABS;
  const allowed: readonly string[] = home ? ["month", "bills", "list", "activity", "balances", "charts"] : pot ? ["games", "balances", "activity"] : ["activity", "balances", "charts"];
  const tab: Tab = allowed.includes(sp.tab ?? "") ? (sp.tab as Tab) : home ? "month" : pot ? "games" : "activity";

  // Home & Couple: everything This month / Bills / List need, fetched together.
  const monthTab = home && tab === "month";
  const active = group.expenses.filter((e) => !e.deletedAt);
  const [bills, budgets, depositShares, heads, goalRows, list, games] = await Promise.all([
    home && (tab === "month" || tab === "bills") ? billStatuses(group.id) : Promise.resolve<Awaited<ReturnType<typeof billStatuses>>>([]),
    monthTab ? budgetsNow(group.id, active, myId, v.tz) : Promise.resolve<Awaited<ReturnType<typeof budgetsNow>>>([]),
    // The deposit tile (held shares only).
    monthTab ? db.depositShare.findMany({ where: { deposit: { groupId: group.id }, status: "held" } }) : Promise.resolve([] as { amount: number; memberId: string }[]),
    // Heads up and next month's estimate.
    monthTab
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
  ]);
  const toSettle = games.length ? await gamesToSettle(group.id, games) : {};
  // Reactions on expenses, for the Activity list.
  const reactions = tab === "activity" && group.expenses.length ? await db.reaction.findMany({ where: { expenseId: { in: group.expenses.map((e) => e.id) } }, select: { expenseId: true, memberId: true, emoji: true } }) : [];
  // Results of finished games: they change through the game (other card-game rows, e.g. imported ones, are ordinary).
  // Loaded whatever the group type now is: a card-night group can later become a trip and keep its games.
  const gameResultIds = tab === "activity" ? (await db.potGame.findMany({ where: { groupId: group.id, resultId: { not: "" } }, select: { resultId: true } })).map((g) => g.resultId) : [];
  const receipts = tab === "activity" && group.expenses.length ? await db.receipt.findMany({ where: { groupId: group.id, expenseId: { not: "" } }, select: { id: true, expenseId: true } }) : [];
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
            ? `Added up ${niceDate(b.due)}`
            : `Repeats · next ${niceDate(b.due)}`,
      who: b.payerId ? (b.payerId === myId ? "you pay" : `${v.nameOf(b.payerId)} pays`) : "taking turns",
      amount: b.bill.nature === "varies" ? (b.usual ? `~${v.money(b.usual)}` : "") : b.bill.nature === "daily" ? `${v.money(b.bill.amount)}/day` : v.money(b.bill.amount),
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
  const showUndo = justDid && canUndo(justDid, undoEvents).ok;

  return (
    <>
      <GroupHeader v={v} switchTo={switchTo} />
      <LeftBanner v={v} />
      <GroupSummary v={v} sp={sp} compact={home} />
      {!account && <PhoneOnlyNote back={`/groups/${group.id}`} className="mb-5" />}
      {sp.imported && <ImportedNote code={sp.imported} groupId={group.id} />}

      <nav className="-mx-5 mb-5 flex gap-6 overflow-x-auto border-b border-line px-5 [scrollbar-width:none]" aria-label="Group sections">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/groups/${group.id}?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={`relative shrink-0 whitespace-nowrap pb-3 pt-1 text-[15px] font-semibold transition-colors ${t.id === tab ? "text-fg" : "text-fg/60"}`}
          >
            {t.label}
            {t.id === tab && <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-[var(--color-tint,var(--color-fg))]" />}
          </Link>
        ))}
      </nav>

      {tab === "activity" && <LeftSections v={v} />}
      {tab === "activity" && (
        <ActivityTab
          v={v}
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
        />
      )}
      {home && (tab === "balances" || tab === "charts") && (
        <Link href={`/groups/${group.id}`} className="-mt-2 mb-5 inline-block text-sm text-gray-500">
          ‹ This month
        </Link>
      )}
      {tab === "month" && <ThisMonthTab v={v} extras={{ upcoming: comingUp, budgets, deposit, goals, insights: heads?.insights, forecast: heads?.forecast }} />}
      {tab === "bills" && <BillsTab v={v} bills={bills} saved={sp.saved === "bill"} />}
      {tab === "list" && list && (
        <ListTab v={v} items={list.items} usual={list.usual} notice={sp.bought ? "Added as an expense. Everyone has been told." : sp.told ? "Told everyone you’re going shopping." : undefined} />
      )}
      {tab === "games" && <GamesTab v={v} games={games} toSettle={toSettle} />}
      {tab === "balances" && <BalancesTab v={v} paid={sp.paid === "1"} why={sp.why} />}
      {tab === "charts" && <ChartsTab v={v} />}

      {/* Below the group's own content, never above it; not while searching or before anything was added. */}
      {(tab === "activity" || tab === "month" || tab === "games") && !leaver && group.expenses.length > 0 && !sp.q && !sp.cat && !sp.who && !sp.type && (
        <SendPostcardCard
          href={`/postcards/new?group=${group.id}`}
          front={group.type === "trip" && !group.cover && placePhoto(group.name) ? `photo:${placePhoto(group.name)!.src}` : group.type === "pot" ? "print:cards" : group.type === "home" || group.type === "couple" ? "print:home" : "print:beach"}
          words={group.type === "trip" ? placeOf(group.name) : ""}
          className="mt-8"
        />
      )}

      <LeftFootnote v={v} />

      {/* A brand-new flat, couple or card night: what's special about it, once on this phone. */}
      {!leaver && active.length === 0 && (group.type === "home" || group.type === "couple" || group.type === "pot") && <GroupTypeSheet groupId={group.id} type={group.type} />}

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
