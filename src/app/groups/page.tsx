import Link from "@/components/Link";
import { PageHeader } from "@/components/ui";
import { PhoneOnlyNote } from "@/components/PhoneOnlyNote";
import { GroupLine, GroupRow } from "@/components/GroupLines";
import { getAccount, getMemberships } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { loadOverview } from "@/lib/overview";
import { stillIn } from "@/lib/left-view";
import { loadDeletedGroups } from "@/lib/group-data";
import { restoreGroup } from "@/app/actions";
import { Notice } from "@/components/Notice";

export const metadata = { title: "Your groups" };

// "See all" from Home: every group in one plain list, open ones first (newest activity on top), closed ones underneath.
export default async function GroupsPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  const [tz, memberships, account] = await Promise.all([getTimeZone(), getMemberships(), getAccount()]);
  const [{ open, closed }, deletedGroups] = await Promise.all([loadOverview(memberships), loadDeletedGroups(memberships)]);
  const live = stillIn(open).sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  // Right after a delete (or opening a deleted group's old link), Recently deleted comes first, open, under the message;
  // otherwise it sits at the bottom, closed. (A redirect can't be relied on to keep a #anchor, so the page orders itself.)
  const justDeleted = deleted === "group" || deleted === "gone" || deleted === "trip";
  const deletedBlock =
    deletedGroups.length > 0 ? (

        <details id="deleted" className={`group/deleted scroll-mt-6 ${justDeleted ? "mb-6" : "mt-8"}`} open={justDeleted} data-recently-deleted>
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-gray-600 active:bg-mist [&::-webkit-details-marker]:hidden">
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
                  <button type="submit" className="min-h-11 rounded-full border border-line px-3.5 py-1.5 text-sm font-medium text-fg active:bg-mist">
                    Restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
    ) : null;
  return (
    <>
      <PageHeader title="Your groups" back="/" bell />
      {justDeleted && (
        <Notice params={["deleted"]} className="mb-4">
          {deleted === "group"
            ? "Group deleted. You can restore it here for 30 days."
            : deleted === "trip"
              ? "That trip was deleted. If you started it or look after it, you can bring it back from Recently deleted."
              : "That group was deleted. If you started it or look after it, you can restore it here for 30 days."}
        </Notice>
      )}
      {justDeleted && deletedBlock}
      {!account && live.length + closed.length > 0 && <PhoneOnlyNote plural className="mb-4" />}
      {live.length === 0 ? (
        <p className="py-6 text-sm text-gray-500">No open groups. Create one, or reopen a closed one.</p>
      ) : (
        <ul className="lp-rise" data-all-groups>
          {live.map((g) => (
            <GroupLine key={g.group.id} g={g} tz={tz} />
          ))}
        </ul>
      )}
      <Link href="/groups/new" className="mt-3 flex min-h-11 items-center justify-center rounded-full border border-line text-sm font-semibold active:bg-mist">
        New group
      </Link>
      {closed.length > 0 && (
        <section className="mt-8" aria-label="Closed groups">
          <h2 className="font-display text-lg font-semibold tracking-tight">Closed groups ({closed.length})</h2>
          <ul className="divide-y divide-line">
            {closed.map((g) => (
              <GroupRow key={g.group.id} g={g} closed tz={tz} />
            ))}
          </ul>
        </section>
      )}
      {!justDeleted && deletedBlock}
    </>
  );
}
