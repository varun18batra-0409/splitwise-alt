import Link from "next/link";
import { db } from "@/lib/db";
import { getMemberships } from "@/lib/identity";
import { primaryButtonClass } from "@/components/ui";

// Home screen: the groups this phone has joined.
// (The "You owe / You are owed" summary arrives in step 5.)
export default async function Home() {
  const memberships = await getMemberships();
  const groups = await db.group.findMany({
    where: { id: { in: Object.keys(memberships) } },
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Your groups</h1>

      {groups.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-gray-500">No groups yet.</p>
          <p className="mt-1 text-sm text-gray-400">
            Create one, or open an invite link a friend sent you.
          </p>
        </div>
      ) : (
        <ul className="mb-8 divide-y divide-gray-100">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`} className="flex items-center justify-between py-4 active:bg-gray-50">
                <span className="font-medium">{g.name}</span>
                <span className="text-sm text-gray-400">{g._count.members} people ›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link href="/groups/new" className={`block ${primaryButtonClass}`}>
        Create a group
      </Link>
    </>
  );
}
