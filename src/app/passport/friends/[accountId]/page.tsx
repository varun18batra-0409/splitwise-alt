import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { getAccount } from "@/lib/identity";
import { getTimeZone } from "@/lib/tz";
import { todayKey } from "@/lib/dates";
import { canSeePassport, loadPassport } from "@/lib/passport-db";
import { stampPages } from "@/lib/passport";
import { PageHeader } from "@/components/ui";
import { PassportBook } from "@/components/PassportBook";
import { Locked, NudgeBox } from "@/components/PassportFriend";

export const metadata = { title: "Passport", robots: { index: false } };

// A friend's passport (someone you've shared a group with), read-only.
export default async function FriendPassportByAccount({ params, searchParams }: { params: Promise<{ accountId: string }>; searchParams: Promise<{ nudged?: string; error?: string; from?: string }> }) {
  const { accountId } = await params;
  const sp = await searchParams;
  const me = await getAccount();
  if (!me) redirect(`/signin?back=/passport/friends`);
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(accountId)) return <Locked />;
  if (accountId === me.id) redirect("/passport");
  // Opened from a group: Back goes to that group.
  const from = sp.from && /^[A-Za-z0-9_-]{6,40}$/.test(sp.from) ? sp.from : "";
  const back = from ? `/groups/${from}?tab=balances` : "/passport/friends";
  const r = await canSeePassport(me.id, accountId);
  if (!r.ok && r.reason === "stranger") return <Locked />;
  const name = r.name ?? (r.ok ? r.owner?.name : undefined) ?? "Friend";
  const first = name.trim().split(/\s+/)[0] || name;
  if (!r.ok || !r.owner)
    return (
      <>
        <PageHeader title={`${first}’s passport`} back={back} />
        <div className="rounded-2xl bg-mist px-5 py-8 text-center">
          <p className="text-3xl" aria-hidden>
            🔒
          </p>
          <p className="mt-2 font-semibold">{first} keeps their passport private.</p>
          <p className="mt-1 text-sm text-gray-500">Only they can see it.</p>
        </div>
      </>
    );
  const p = await loadPassport(r.owner, "", todayKey(new Date(), await getTimeZone()), { forFriend: true });
  const empty = p.stamps.length + p.been.length === 0;
  return (
    <>
      <PageHeader title={`${first}’s passport`} back={back} />
      <PassportBook name={first} stats={p.stats} milestones={p.milestones} pages={stampPages(p.stamps, p.been)} index={p.index} badges={p.badges} own={false} />
      {empty && <NudgeBox accountId={accountId} first={first} sent={sp.nudged === "1"} error={sp.error} />}
      <p className="mt-5 text-center text-sm text-gray-500">
        <Link href="/passport/friends" className="font-semibold text-fg underline underline-offset-4">
          All friends’ passports
        </Link>
        {"  ·  "}
        <Link href="/passport" className="font-semibold text-fg underline underline-offset-4">
          Yours
        </Link>
      </p>
    </>
  );
}
