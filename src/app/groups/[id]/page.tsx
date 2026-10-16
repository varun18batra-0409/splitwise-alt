import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { getMemberships, getMyMemberId } from "@/lib/identity";
import { loadGroup, loadSwitchList } from "@/lib/group-data";
import { db } from "@/lib/db";
import { canUndo } from "@/lib/undo";
import { UndoBar } from "@/components/UndoBar";
import { buildGroupView } from "./_components/view";
import { getTimeZone } from "@/lib/tz";
import { GroupHeader } from "./_components/GroupHeader";
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
type Tab = "activity" | "balances" | "charts" | "month" | "bills" | "list";

// A group: header, your balance, and three tabs (Activity · Balances · Charts).
export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
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
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  // Check membership with one small query before loading the whole ledger.
  const myId = await getMyMemberId(id);
  const me = myId ? await db.member.findFirst({ where: { id: myId, groupId: id }, select: { id: true } }) : null;
  if (!me || !myId) {
    const exists = await db.group.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!exists) notFound();
    redirect("/private");
  }
  const data = await loadGroup(id);
  if (!data) notFound();

  const v = await buildGroupView(data, myId, await getTimeZone());
  const { group } = v;
  const home = group.type === "home" || group.type === "couple";
  const tabs = home ? HOME_TABS : TABS;
  const allowed: readonly string[] = home ? ["month", "bills", "list", "activity", "balances", "charts"] : ["activity", "balances", "charts"];
  const tab: Tab = allowed.includes(sp.tab ?? "") ? (sp.tab as Tab) : home ? "month" : "activity";

  // Home & Couple: bills for the Bills tab and "Coming up" on This month.
  const bills = home && (tab === "month" || tab === "bills") ? await billStatuses(group.id) : [];
  const comingUp = bills
    .filter((b) => b.status === "waiting" || b.status === "upcoming")
    .sort((a, b) => (a.status === "waiting" ? -1 : b.status === "waiting" ? 1 : a.due.localeCompare(b.due)))
    .slice(0, 5)
    .map((b) => ({
      id: b.bill.id,
      name: b.bill.name,
      icon: b.bill.icon,
      when: b.status === "waiting" ? `Due ${niceDate(b.due)}` : b.bill.nature === "varies" ? `Due ${niceDate(b.due)}` : `Adds itself ${niceDate(b.due)}`,
      who: b.payerId ? (b.payerId === myId ? "you pay" : `${v.nameOf(b.payerId)} pays`) : "taking turns",
      amount: b.bill.nature === "varies" ? (b.usual ? `~${v.money(b.usual)}` : "") : b.bill.nature === "daily" ? `${v.money(b.bill.amount)}/day` : v.money(b.bill.amount),
      status: (b.status === "waiting" ? "enter" : "due") as "enter" | "due",
      href: b.status === "waiting" ? `/groups/${group.id}/add?bill=${b.bill.id}&period=${b.period}` : undefined,
    }));

  const budgets = home && tab === "month" ? await budgetsNow(group.id, group.expenses.filter((e) => !e.deletedAt), myId, v.tz) : [];

  // The deposit tile (held shares only).
  const depositShares = home && tab === "month" ? await db.depositShare.findMany({ where: { deposit: { groupId: group.id }, status: "held" } }) : [];
  const deposit = depositShares.length
    ? { total: depositShares.reduce((s, d) => s + d.amount, 0), mine: depositShares.find((d) => d.memberId === myId)?.amount ?? 0 }
    : null;

  // Heads up and next month's estimate.
  const heads =
    home && tab === "month"
      ? await monthInsights(group.id, group.expenses.filter((e) => !e.deletedAt), myId, Object.fromEntries(group.members.filter((m) => !m.leftAt).map((m) => [m.id, m.splitWeight])), group.currency, v.tz)
      : null;

  // Savings goals (kept count of only).
  const goals =
    home && tab === "month"
      ? (await db.goal.findMany({ where: { groupId: group.id, deletedAt: null }, include: { entries: { select: { amount: true } } }, orderBy: { createdAt: "asc" } })).map((g) => ({
          id: g.id,
          name: g.name,
          target: g.target,
          saved: g.entries.reduce((s, e) => s + e.amount, 0),
        }))
      : [];

  // The shopping list: what's open now, and the usual things for quick adding.
  const list =
    home && tab === "list"
      ? await (async () => {
          const items = await db.listItem.findMany({ where: { groupId: group.id, expenseId: "" }, orderBy: { createdAt: "asc" } });
          const history = await db.listItem.findMany({ where: { groupId: group.id }, orderBy: { createdAt: "desc" }, take: 200, select: { text: true } });
          return { items, usual: usualItems(history.map((h) => h.text), items.map((i) => i.text)) };
        })()
      : null;

  // Group switcher: up to 5 of my other open groups, most recently active first.
  const switchTo = await loadSwitchList(await getMemberships(), group.id);

  // Right after a change: offer Undo (or Redo after an undo).
  const justDid = sp.did ? group.events.find((x) => x.id === sp.did) : undefined;
  const showUndo = justDid && canUndo(justDid, group.events).ok;

  return (
    <>
      <GroupHeader v={v} switchTo={switchTo} />
      <GroupSummary v={v} sp={sp} compact={home} />

      <nav className={`mb-6 grid gap-1 rounded-xl bg-mist p-1 ${tabs.length === 4 ? "grid-cols-4" : "grid-cols-3"}`} aria-label="Group sections">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/groups/${group.id}?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={`rounded-lg py-2 text-center text-sm ${t.id === tab ? "bg-fg font-semibold text-canvas" : "text-gray-500"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

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
      {tab === "balances" && <BalancesTab v={v} paid={sp.paid === "1"} why={sp.why} />}
      {tab === "charts" && <ChartsTab v={v} />}

      {showUndo && (
        <UndoBar
          key={justDid.id}
          text={sp.undone ? "Undone." : `${v.nameOf(justDid.actorId)} ${justDid.text}`}
          groupId={group.id}
          eventId={justDid.id}
          back={tab === "balances" ? "balances" : "group"}
          redo={sp.undone === "1"}
        />
      )}
    </>
  );
}
