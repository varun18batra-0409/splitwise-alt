import Link from "@/components/Link";
import { PageHeader } from "@/components/ui";
import { PhoneOnlyNote } from "@/components/PhoneOnlyNote";
import { GroupLine, GroupRow } from "@/components/GroupLines";
import { getAccount, getMemberships } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { loadOverview } from "@/lib/overview";
import { stillIn } from "@/lib/left-view";

export const metadata = { title: "Your groups" };

// "See all" from Home: every group in one plain list, open ones first (newest activity on top), closed ones underneath.
export default async function GroupsPage() {
  const [tz, memberships, account] = await Promise.all([getTimeZone(), getMemberships(), getAccount()]);
  const { open, closed } = await loadOverview(memberships, { lean: true });
  const live = stillIn(open).sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  return (
    <>
      <PageHeader title="Your groups" back="/" />
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
    </>
  );
}
