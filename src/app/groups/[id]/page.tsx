import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { Avatar, PageHeader } from "@/components/ui";
import { ShareInvite } from "@/components/ShareInvite";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const group = await db.group.findUnique({
    where: { id },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  if (!group) notFound();

  // If this phone hasn't said who it is in this group yet, ask first.
  const myId = await getMyMemberId(group.id);
  if (!myId || !group.members.some((m) => m.id === myId)) {
    redirect(`/join/${group.inviteCode}`);
  }

  return (
    <>
      <PageHeader title={group.name} back="/" />

      <ShareInvite code={group.inviteCode} groupName={group.name} />

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-400">
          People · {group.members.length}
        </h2>
        <ul className="divide-y divide-gray-100">
          {group.members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-3">
              <Avatar name={m.name} />
              <span className="font-medium">{m.name}</span>
              {m.id === myId && <span className="text-sm text-gray-400">(you)</span>}
            </li>
          ))}
        </ul>
        <Link href={`/join/${group.inviteCode}`} className="mt-2 inline-block py-2 text-sm text-gray-400">
          Not you? Switch person
        </Link>
      </section>

      <section className="mt-10 rounded-2xl border border-dashed border-gray-200 py-10 text-center text-sm text-gray-400">
        No expenses yet.
      </section>
    </>
  );
}
