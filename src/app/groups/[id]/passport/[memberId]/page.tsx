import { redirect } from "next/navigation";
import { PassportIcon } from "@/components/Icons";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { PageHeader } from "@/components/ui";
import { Locked } from "@/components/PassportFriend";

export const metadata = { title: "Passport", robots: { index: false } };

// A person's passport, opened from a group: goes to their passport page (with
// Back leading here again). Someone who isn't on Loopin yet has no passport.
export default async function MemberPassport({ params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await params;
  const myId = await getMyMemberId(id);
  if (!myId) redirect("/private");
  const them = /^[A-Za-z0-9_-]{6,40}$/.test(memberId) ? await db.member.findUnique({ where: { id: memberId }, select: { groupId: true, name: true, accountId: true } }) : null;
  if (!them || them.groupId !== id) return <Locked />;
  if (them.accountId) redirect(`/passport/friends/${them.accountId}?from=${encodeURIComponent(id)}`);
  const first = them.name.trim().split(/\s+/)[0] || them.name;
  return (
    <>
      <PageHeader title={`${first}’s passport`} back={`/groups/${id}?tab=balances`} />
      <div className="rounded-2xl bg-mist px-5 py-8 text-center">
        <span aria-hidden className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-owed/40 text-owed">
          <PassportIcon size={26} />
        </span>
        <p className="mt-2 font-semibold">{first} isn’t on Loopin yet</p>
        <p className="mt-1 text-sm text-gray-500">Their passport starts when they join.</p>
        <Link href={`/groups/${id}/people`} className="mt-5 inline-block text-sm font-semibold underline underline-offset-4">
          Invite them from People
        </Link>
      </div>
    </>
  );
}
