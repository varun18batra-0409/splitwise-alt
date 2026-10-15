import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMemberships, getMyMemberId } from "@/lib/identity";
import { loadGroup, loadMyGroups } from "@/lib/group-data";
import { canUndo } from "@/lib/undo";
import { UndoBar } from "@/components/UndoBar";
import { buildGroupView } from "./_components/view";
import { getTimeZone } from "@/lib/tz";
import { GroupHeader } from "./_components/GroupHeader";
import { GroupSummary } from "./_components/GroupSummary";
import { ActivityTab } from "./_components/ActivityTab";
import { BalancesTab } from "./_components/BalancesTab";
import { ChartsTab } from "./_components/ChartsTab";

const TABS = [
  { id: "activity", label: "Activity" },
  { id: "balances", label: "Balances" },
  { id: "charts", label: "Charts" },
] as const;
type Tab = (typeof TABS)[number]["id"];

// A group: header, your balance, and three tabs (Activity · Balances · Charts).
export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    saved?: string;
    added?: string;
    skipped?: string;
    paid?: string;
    error?: string;
    did?: string;
    undone?: string;
    q?: string;
    cat?: string;
    who?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "activity";

  const data = await loadGroup(id);
  if (!data) notFound();

  // If this phone hasn't said who it is in this group yet, ask first.
  const myId = await getMyMemberId(data.group.id);
  if (!myId || !data.group.members.some((m) => m.id === myId)) redirect(`/join/${data.group.inviteCode}`);

  const v = await buildGroupView(data, myId, await getTimeZone());
  const { group } = v;

  // Group switcher: up to 5 of my other open groups, most recently active first.
  const switchTo = (await loadMyGroups(await getMemberships()))
    .filter((g) => !g.group.closed && g.group.id !== group.id)
    .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime())
    .slice(0, 5)
    .map((g) => ({ id: g.group.id, name: g.group.name, currency: g.group.currency, myBalance: g.myBalance }));

  // Right after a change: offer Undo (or Redo after an undo).
  const justDid = sp.did ? group.events.find((x) => x.id === sp.did) : undefined;
  const showUndo = justDid && canUndo(justDid, group.events).ok;

  return (
    <>
      <GroupHeader v={v} switchTo={switchTo} />
      <GroupSummary v={v} sp={sp} />

      <nav className="mb-6 grid grid-cols-3 gap-1 rounded-xl bg-mist p-1" aria-label="Group sections">
        {TABS.map((t) => (
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

      {tab === "activity" && <ActivityTab v={v} filter={{ q: sp.q?.slice(0, 80), cat: sp.cat, who: sp.who }} />}
      {tab === "balances" && <BalancesTab v={v} paid={sp.paid === "1"} />}
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
