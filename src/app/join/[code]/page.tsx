import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { GetAppButton } from "@/components/GetApp";
import { db } from "@/lib/db";
import { getAccount, getMemberships } from "@/lib/identity";
import { joinAsExisting, joinAsNew } from "@/app/actions";
import { Avatar, ErrorNote, PageHeader, inputClass, primaryButtonClass, secondaryButtonClass } from "@/components/ui";

// Where invitations land (group link, QR, contact message or email).
// Joining needs a verified email, so new people sign up first (30 seconds,
// no password); then one tap to join.
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string; e?: string }>;
}) {
  const { code } = await params;
  const { error, e: invitedEmail } = await searchParams;
  const group = await db.group.findUnique({
    where: { inviteCode: code },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!group || group.deletedAt) notFound();

  const account = await getAccount();
  const memberships = await getMemberships();
  const mine = group.members.find((m) => (account && m.accountId === account.id) || memberships[group.id] === m.id);
  if (mine && !mine.leftAt && (!account || mine.accountId === account.id)) redirect(`/groups/${group.id}`);

  const active = group.members.filter((m) => !m.leftAt);
  const verified = active.filter((m) => m.accountId);
  const unclaimed = active.filter((m) => !m.accountId && !m.claimedAt);
  const back = `/join/${code}${invitedEmail ? `?e=${encodeURIComponent(invitedEmail)}` : ""}`;

  return (
    <>
      <PageHeader title={`Join ${group.name}`} />

      {error === "busy" && <ErrorNote>Too many joins from here in the last hour. Wait a bit and try again.</ErrorNote>}
      {error === "claimed" && <ErrorNote>That name is already taken by someone else. Join as yourself instead.</ErrorNote>}

      <section className="vault mb-8 rounded-[24px] px-5 py-6 text-fg">
        <p className="text-sm text-fg/55">You’re invited to</p>
        <p className="mt-1 font-display text-[28px] font-semibold leading-tight">{group.name}</p>
        <p className="mt-2 text-sm text-fg/60">
          {active.length} {active.length === 1 ? "person" : "people"} · {verified.map((m) => m.name).slice(0, 4).join(", ")}
          {verified.length > 4 ? "…" : ""}
        </p>
      </section>

      {!account ? (
        <>
          <p className="mb-5 text-gray-600">
            To join, sign up with your email. It takes 30 seconds, there’s no password, and it means notifications reach you and friends can
            find you.
          </p>
          <Link href={`/signin?${new URLSearchParams({ mode: "signup", back, ...(invitedEmail ? { e: invitedEmail } : {}) })}`} className={primaryButtonClass}>
            Sign up to join
          </Link>
          <Link href={`/signin?${new URLSearchParams({ back, ...(invitedEmail ? { e: invitedEmail } : {}) })}`} className={`mt-3 ${secondaryButtonClass}`}>
            I already have an account
          </Link>
        </>
      ) : (
        <>
          <form action={joinAsNew} className="space-y-4">
            <input type="hidden" name="code" value={code} />
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-600">Your name in this group</span>
              <input name="name" required defaultValue={account.name} placeholder="Your name" autoComplete="given-name" maxLength={40} className={inputClass} />
            </label>
            <button type="submit" className={primaryButtonClass}>
              Join {group.name}
            </button>
            <p className="text-center text-xs text-gray-400">Joining as {account.email}</p>
          </form>

          {unclaimed.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-1 text-sm font-medium text-gray-600">Already added to this group by name?</h2>
              <p className="mb-3 text-xs text-gray-400">Tap your name to take it over, so its expenses are yours.</p>
              <ul className="space-y-2">
                {unclaimed.map((m) => (
                  <li key={m.id}>
                    <form action={joinAsExisting}>
                      <input type="hidden" name="code" value={code} />
                      <input type="hidden" name="memberId" value={m.id} />
                      <button type="submit" className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-left active:bg-mist">
                        <Avatar name={m.name} />
                        <span className="font-medium">That’s me: {m.name}</span>
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <GetAppButton variant="card" className="mt-10" />
    </>
  );
}
