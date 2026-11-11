import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { pickAdmin } from "@/lib/group-admin";
import { GetAppButton } from "@/components/GetApp";
import { db } from "@/lib/db";
import { getAccount, getMemberships } from "@/lib/identity";
import { joinAsExisting, joinAsNew } from "@/app/actions";
import { Avatar, ErrorNote, inputClass, primaryButtonClass } from "@/components/ui";
import { GoogleG } from "@/components/GoogleG";
import { googleConfigured } from "@/lib/google";
import { coverFor } from "@/lib/covers";
import { Polaroid } from "@/components/Polaroid";
import { inviteMemberId } from "@/lib/invites";
import { invitedNameRows } from "@/lib/join";
import type { Metadata } from "next";

// The preview WhatsApp shows for an invite link: the group's name, never anyone's money.
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const group = await db.group.findUnique({ where: { inviteCode: code }, select: { name: true, deletedAt: true } });
  const robots = { index: false, follow: false };
  if (!group || group.deletedAt) return { title: "Join on Loopin", robots };
  const title = `You’re invited to ${group.name}`;
  const description = "Tap to join. Split as you go, settle in one tap, keep the memories.";
  return { title, description, robots, openGraph: { title, description, images: [{ url: `/join/${code}/card`, width: 1200, height: 630 }] }, twitter: { card: "summary_large_image", title, description } };
}

// Where invitations land (group link, QR, contact message or email).
// Joining needs a verified email, so new people sign up first (30 seconds,
// no password); then one tap to join.
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string; e?: string; as?: string }>;
}) {
  const { code } = await params;
  const { error, e: invitedEmail, as: asId } = await searchParams;
  const group = await db.group.findUnique({
    where: { inviteCode: code },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  // A link that was replaced (or a group that's gone): a calm page, not a 404.
  if (!group || group.deletedAt) {
    return (
      <section className="vault mt-10 rounded-[24px] px-6 py-10 text-center" data-join-gone>
        <p className="font-display text-[26px] font-semibold leading-tight tracking-tight">This invite link no longer works</p>
        <p className="mt-3 text-sm text-gray-500">Ask for a new one.</p>
        <Link href="/" className="mt-6 inline-block text-sm font-semibold text-fg/70 underline underline-offset-4">
          Go to Loopin
        </Link>
      </section>
    );
  }

  const account = await getAccount();
  const memberships = await getMemberships();
  // Taken out of this group by whoever looks after it: the link doesn't bring them back in.
  const removedMe = account ? group.members.find((m) => m.accountId === account.id && m.removedAt) : undefined;
  if (removedMe) {
    const by = group.members.find((m) => m.id === removedMe.removedById)?.name ?? pickAdmin(group.members)?.name ?? "The person who looks after the group";
    return (
      <section className="vault mt-10 rounded-[24px] px-6 py-10 text-center" data-join-removed>
        <p className="font-display text-[26px] font-semibold leading-tight tracking-tight">{group.name}</p>
        <p className="mt-3 text-sm text-gray-500">{by} removed you from this group. Ask them to invite you again.</p>
        <Link href="/" className="mt-6 inline-block text-sm font-semibold text-fg/70 underline underline-offset-4">
          Go to Home
        </Link>
      </section>
    );
  }
  const mine = group.members.find((m) => (account && m.accountId === account.id) || memberships[group.id] === m.id);
  if (mine && !mine.leftAt && (!account || mine.accountId === account.id)) redirect(`/groups/${group.id}`);

  const active = group.members.filter((m) => !m.leftAt);
  const unclaimed = active.filter((m) => !m.accountId && !m.claimedAt);
  // Names someone was invited as by email can only be taken by that email (offered above as "Continue as"), never from this list.
  const invitedRows = await invitedNameRows(group.id);
  const claimable = unclaimed.filter((m) => !invitedRows.has(m.id));
  // Invited by email (this account's own invitation): say who by, and offer the name they were added as.
  const invite = account ? await db.invite.findUnique({ where: { groupId_email: { groupId: group.id, email: account.email } } }) : null;
  const waiting = invite && !invite.acceptedAt ? invite : null;
  const invitedBy = waiting ? group.members.find((m) => m.id === waiting.invitedById)?.name : undefined;
  // Invited by email to take over a name: offer that name first.
  const asMember = unclaimed.find((m) => m.id === asId) ?? (waiting ? unclaimed.find((m) => m.id === inviteMemberId(waiting)) : undefined) ?? null;
  const backQ = new URLSearchParams({ ...(invitedEmail ? { e: invitedEmail } : {}), ...(asMember ? { as: asMember.id } : {}) }).toString();
  const back = `/join/${code}${backQ ? `?${backQ}` : ""}`;

  const kind = group.type === "trip" ? "A trip" : group.type === "home" ? "A home" : group.type === "couple" ? "A couple" : group.type === "pot" ? "A card night" : "A group";

  return (
    <>
      {/* The invitation: a neutral card. No names and no amounts until you join. */}
      <header className="mb-6">
        <span className="font-display text-[26px] font-semibold leading-none tracking-tight">loopin</span>
      </header>
      <section className="text-center" data-join-card>
        <Polaroid cover={coverFor(group, true)} uid={`join-${group.id}`} letter={group.name} caption={group.name} photoClass="h-[200px]" className="mx-auto w-[250px] -rotate-2" captionClass="text-[22px]" sizes="250px" />
        <p className="mt-7 text-sm text-fg/60">{invitedBy ? `${invitedBy} invited you to` : "You’re invited to"}</p>
        <h1 className="mt-1 font-display text-[clamp(32px,10vw,40px)] font-semibold leading-[1.05] tracking-[-0.02em]">{group.name}</h1>
        <p className="mt-1 text-sm text-fg/60">
          {kind} · {active.length} {active.length === 1 ? "person" : "people"}
        </p>
        <p className="mx-auto mt-5 max-w-[19rem] text-sm leading-relaxed text-fg/70">Join to see who’s in, what’s been spent and who owes what.</p>
      </section>

      {error === "busy" && <ErrorNote>Too many joins from here in the last hour. Wait a bit and try again.</ErrorNote>}
      {error === "claimed" && <ErrorNote>That name is already taken by someone else. Join as yourself instead.</ErrorNote>}

      {!account ? (
        <>
          {asMember && <p className="mb-4 rounded-[18px] bg-mist px-4 py-3 text-sm">You were added as <strong>{asMember.name}</strong>. Join to see your share.</p>}
          <div className="space-y-2.5">
            {googleConfigured() && (
              <a href={`/api/auth/google/start?${new URLSearchParams({ back })}`} className="pop flex h-14 w-full items-center justify-center gap-3 bg-fg text-base font-semibold text-canvas">
                <GoogleG />
                Join with Google
              </a>
            )}
            <Link
              href={`/signin?${new URLSearchParams({ back, ...(invitedEmail ? { e: invitedEmail } : {}) })}`}
              className={googleConfigured() ? "flex h-14 w-full items-center justify-center rounded-full border border-fg/15 bg-fg/[0.06] text-base font-semibold text-fg transition-transform active:scale-[0.97]" : "pop flex h-14 w-full items-center justify-center bg-fg text-base font-semibold text-canvas"}
            >
              Sign up to join with email
            </Link>
          </div>
          <p className="mt-3 text-center text-[13px] text-fg/50">30 seconds, no password. Your groups follow you to any phone.</p>
        </>
      ) : (
        <>
          {asMember && (
            <form action={joinAsExisting} className="mb-8 space-y-3">
              <input type="hidden" name="code" value={code} />
              <input type="hidden" name="memberId" value={asMember.id} />
              <p className="text-gray-600">
                You were added as <strong className="text-fg">{asMember.name}</strong>. Continue as {asMember.name} to keep their expenses and balance.
              </p>
              <button type="submit" className={primaryButtonClass}>
                Continue as {asMember.name}
              </button>
              <p className="pt-2 text-center text-xs text-gray-400">Not {asMember.name}? Join as yourself below.</p>
            </form>
          )}
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

          {/* Names stay out of sight until you ask: the page above shows none. */}
          {claimable.length > 0 && (
            <details className="mt-10" data-claim-names>
              <summary className="cursor-pointer text-sm font-medium text-gray-600">Already added to this group by name?</summary>
              <p className="mb-3 mt-1 text-xs text-gray-400">Tap your name to take it over, so its expenses are yours.</p>
              <ul className="space-y-2">
                {claimable.map((m) => (
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
            </details>
          )}
        </>
      )}

      <p className="mt-6 text-center text-[13px] text-fg/50" data-join-footnote>No names or amounts are shown before you join.</p>
      <p className="mt-8 text-center text-xs text-gray-400">Loopin keeps count. It never touches your money.</p>
      <GetAppButton variant="card" className="mt-6" />
    </>
  );
}
