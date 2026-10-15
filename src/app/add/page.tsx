import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMemberships } from "@/lib/identity";
import { PageHeader } from "@/components/ui";

// "+ Add expense" from the home screen. With one group it jumps straight in;
// with several, it asks which group.
export default async function PickGroupForExpense() {
  const memberships = await getMemberships();
  const groups = await db.group.findMany({
    where: { id: { in: Object.keys(memberships) }, closed: false, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (groups.length === 0) redirect("/groups/new");
  if (groups.length === 1) redirect(`/groups/${groups[0].id}/add`);

  return (
    <>
      <PageHeader title="Add expense to…" back="/" />
      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={g.id}>
            <Link
              href={`/groups/${g.id}/add`}
              className="block rounded-xl border border-gray-200 px-4 py-4 font-medium active:bg-gray-50"
            >
              {g.name}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
