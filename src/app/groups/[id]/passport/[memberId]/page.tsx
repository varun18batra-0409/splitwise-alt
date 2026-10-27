import { notFound, redirect } from "next/navigation";
import Link from "@/components/Link";
import { db } from "@/lib/db";
import { getMyMemberId } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { loadPassport } from "@/lib/passport-db";
import { stampPages } from "@/lib/passport";
import { PageHeader } from "@/components/ui";
import { PassportBook } from "@/components/PassportBook";

export const metadata = { title: "Passport", robots: { index: false } };

// A friend's trip passport, opened from a group you're both in. Only people who
// share a group with them, and only if they let people in their groups see it.
// Their stamps and countries only: never their money, other groups or email.
export default async function FriendPassport({ params }: { params: Promise<{ id: string; memberId: string }> }) {
  const { id, memberId } = await params;
  const myId = await getMyMemberId(id);
  if (!myId) redirect("/private");
  const [me, them] = await Promise.all([
    db.member.findUnique({ where: { id: myId }, select: { groupId: true, accountId: true } }),
    db.member.findUnique({ where: { id: memberId }, select: { groupId: true, name: true, accountId: true, group: { select: { deletedAt: true } } } }),
  ]);
  if (!me || me.groupId !== id || !them || them.groupId !== id || them.group.deletedAt) notFound();
  if (them.accountId && them.accountId === me.accountId) redirect("/passport");
  const back = `/groups/${id}?tab=balances`;
  const first = them.name.trim().split(/\s+/)[0] || them.name;
  const account = them.accountId ? await db.account.findUnique({ where: { id: them.accountId }, select: { id: true, homeCountry: true, places: true, passportShare: true } }) : null;
  if (!account || account.passportShare === "private")
    return (
      <>
        <PageHeader title={`${first}’s passport`} back={back} />
        <div className="rounded-2xl bg-mist px-5 py-8 text-center">
          <p className="text-3xl" aria-hidden>
            🔒
          </p>
          <p className="mt-2 font-semibold">{account ? `${first} keeps their passport private.` : `${first} isn’t on Loopin yet.`}</p>
          <p className="mt-1 text-sm text-gray-500">{account ? "Only they can see it." : "Their passport starts when they join."}</p>
          <Link href={back} className="mt-5 inline-block text-sm font-semibold underline underline-offset-4">
            Back to the group
          </Link>
        </div>
      </>
    );
  const p = await loadPassport(account, "", todayKey(new Date(), await getTimeZone()));
  return (
    <>
      <PageHeader title={`${first}’s passport`} back={back} />
      <PassportBook name={first} stats={p.stats} milestones={p.milestones} pages={stampPages(p.stamps, p.been)} index={p.index} />
      <p className="mt-5 text-center text-sm text-gray-500">
        Want one like this?{" "}
        <Link href="/passport" className="font-semibold text-fg underline underline-offset-4">
          See your own passport
        </Link>
      </p>
    </>
  );
}
