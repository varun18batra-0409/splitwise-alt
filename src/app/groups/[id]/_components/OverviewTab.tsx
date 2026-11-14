import Link from "@/components/Link";
import { ActivityRow } from "@/components/ActivityRow";
import { ChartIcon, GearIcon, PlusIcon } from "@/components/icons";
import { OUTLINE } from "@/components/HomeMoney";
import { groupTicketSides, type GroupFacts } from "@/lib/home/money-card";
import { recentRows } from "@/lib/group-overview";
import { itemHref } from "@/lib/paths";
import { dayLabel } from "@/lib/activity";
import { MoneyTicket } from "./GroupSummary";
import { MomentsStrip } from "./MomentsStrip";
import type { GroupView } from "./view";

type Strip = { count: number; latest: string[]; canAdd: boolean } | null;

// A trip's (or any plain group's) first tab, as the founder's mockup 03: your money ticket, a quiet "Add expense", the latest three
// expenses, and "Trip recap" and "Group settings" at the bottom. The small moments strip sits under the ticket and opens the Memories tab.
export function OverviewTab({ v, facts, strip }: { v: GroupView; facts: GroupFacts; strip: Strip }) {
  const { group, myId, net } = v;
  const sides = groupTicketSides({ mine: net[myId] ?? 0, myId, transfers: v.transfers, nameOf: v.nameOf });
  // The settled pass already has its own quiet "Add an expense", so the outline button is for when money is owed either way.
  const canAdd = !group.closed && !v.leaver && sides.length > 0;
  const rows = recentRows(group.expenses, group.payments, myId);
  const now = new Date();
  return (
    <div>
      <MoneyTicket v={v} facts={facts} />
      {canAdd && (
        <Link href={`/groups/${group.id}/add`} className={`${OUTLINE} -mt-1 mb-5 w-full gap-2`} data-add-expense>
          <PlusIcon size={18} />
          Add expense
        </Link>
      )}
      {strip && <MomentsStrip groupId={group.id} count={strip.count} latest={strip.latest} canAdd={strip.canAdd} />}

      {rows.length > 0 && (
        <section aria-labelledby="recent-h" className="mb-4" data-recent-expenses>
          <div className="flex items-baseline justify-between">
            <h2 id="recent-h" className="font-display text-[20px] font-semibold tracking-tight">
              Recent expenses
            </h2>
            <Link href={`/groups/${group.id}?tab=activity`} className="flex min-h-11 items-center text-sm font-medium text-fg/85">
              See all
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {rows.map((item) => (
              <li key={item.id}>
                <Link href={itemHref(group.id, item)} className="block active:bg-mist">
                  <ActivityRow item={item} currency={group.currency} nameOf={v.nameOf} dateLabel={dayLabel(item.date, now, v.tz)} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <GroupFooter groupId={group.id} type={group.type} />
    </div>
  );
}

// The way on to the rest: the recap (charts, the report, search) and the group's settings. Under a trip's Overview; a flat's Overview has the
// recap only (its header already carries the settings button).
export function GroupFooter({ groupId, type, settings = true }: { groupId: string; type: string; settings?: boolean }) {
  const link = "flex min-h-11 flex-1 items-center justify-center gap-2 px-2 text-[15px] font-medium text-fg/85 active:opacity-70";
  return (
    <nav aria-label="More about this group" className="mt-2 flex items-center justify-center border-t border-line pt-1">
      <Link href={`/groups/${groupId}?tab=charts`} className={link} data-group-recap>
        <ChartIcon size={18} />
        {type === "trip" ? "Trip recap" : "Recap"}
      </Link>
      {settings && (
        <>
          <span aria-hidden className="h-6 w-px bg-line" />
          <Link href={`/groups/${groupId}/settings`} className={link} data-group-settings>
            <GearIcon size={18} />
            Group settings
          </Link>
        </>
      )}
    </nav>
  );
}
