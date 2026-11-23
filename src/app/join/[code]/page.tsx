import { EmailText } from "@/components/EmailText";
import Link from "@/components/Link";
import { redirect } from "next/navigation";
import { invitationFor } from "@/lib/invitations";
import { pickAdmin } from "@/lib/group-admin";
import { GetAppButton } from "@/components/GetApp";
import { db } from "@/lib/db";
import { getAccount, getMemberships, guestGroupsOnPhone } from "@/lib/identity";
import { GoogleSignInLink } from "@/components/GuestMoveSheet";
import { joinAsExisting, joinAsNew } from "@/app/actions";
import { Avatar, ErrorNote, inputClass, primaryButtonClass } from "@/components/ui";
import { GoogleG } from "@/components/GoogleG";
import { googleConfigured } from "@/lib/google";
import { publicName } from "@/lib/names";
import { coverFor } from "@/lib/covers";
import Image from "next/image";
import { GroupCover } from "@/components/GroupCover";
import { tripPhotoSrc } from "@/lib/places";
import { inviteMemberId } from "@/lib/invites";
import { invitedNameRows, NAME_NEEDED, openInviteEmails } from "@/lib/join";
import { removedByEmail } from "@/lib/removal-marks";
import type { Metadata } from "next";
import { ChevronDown, GroupIcon } from "@/components/icons";

// The preview WhatsApp shows for an invite link: the group's name, never anyone's money.
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const group = await db.group.findUnique({ where: { inviteCode: code }, select: { name: true, deletedAt: true, type: true } });
  const robots = { index: false, follow: false };
  // A pair of two people has no join link: the same neutral title as a link that no longer works.
  if (!group || group.deletedAt || group.type === "direct") return { title: "Join on Loopin", robots };
  const title = `You’re invited to ${group.name}`;
  const description = "Tap to join. Split as you go, settle in one tap, keep the memories.";
  return { title, description, robots, openGraph: { title, description, images: [{ url: `/join/${code}/card`, width: 1200, height: 630 }] }, twitter: { card: "summary_large_image", title, description } };
}

// Where invitations land (group link, QR, contact message or email).
// Anyone with the link can join, with or without an account. Without one, the person taps Join, picks their name from the list (shown as
// "Asha K.") or adds a new one, and this phone remembers them. With an account it is one tap, as before.
export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ error?: string; e?: string; as?: string; step?: string }>;
}) {
  const { code } = await params;
  const { error, e: invitedEmail, as: asId, step } = await searchParams;
  const group = await db.group.findUnique({
    where: { inviteCode: code },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  // A link that was replaced (or a group that's gone): a calm page, not a 404.
  if (!group || group.deletedAt || group.type === "direct") {
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
  // A personal email invitation's link (?e=…&as=…): the person signs in with that email, so the old sign-in buttons stay for it.
  // Signing in with Google from there also moves the guest groups this phone holds, so it lists them first (like /signin).
  const emailInvite = !account && Boolean(invitedEmail);
  const guestGroups = emailInvite ? await guestGroupsOnPhone() : [];
  const memberships = await getMemberships();
  // Taken out of this group by whoever looks after it: the link doesn't bring them back in.
  // (A guest taken out of the group: the name this phone still holds says so, instead of sending them into the group.)
  const removedMe = account ? group.members.find((m) => m.accountId === account.id && m.removedAt) : group.members.find((m) => memberships[group.id] === m.id && !m.accountId && m.removedAt);
  // Removed, then deleted their account and signed up again with the same email: the group kept a scrambled note, so it is the same screen.
  const removedNote = account && !removedMe && !group.members.some((m) => m.accountId === account.id) ? await removedByEmail(group.id, account.email) : null;
  if (removedMe || removedNote) {
    // The admin invited them back: that invitation is answered from Home (Join / Not now), which clears the removal when they accept.
    if (account && (await invitationFor(account, group.id))) redirect("/");
    const by = group.members.find((m) => m.id === (removedMe?.removedById ?? removedNote?.by))?.name ?? pickAdmin(group.members)?.name ?? "The person who looks after the group";
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
  const invitedRows = await invitedNameRows(group.id, { forGuest: !account });
  const claimable = unclaimed.filter((m) => !invitedRows.has(m.id));
  // Invited by email (this account's own invitation): say who by, and offer the name they were added as.
  const invite = account ? await db.invite.findUnique({ where: { groupId_email: { groupId: group.id, email: account.email } } }) : null;
  const waiting = invite && !invite.acceptedAt ? invite : null;
  const invitedBy = waiting ? group.members.find((m) => m.id === waiting.invitedById)?.name : undefined;
  // Invited by email to take over a name: offer that name first.
  // A name an email invitation is reserved for is named to a signed-out visitor only when the link carries the very email it was sent to
  // (and it is never offered for taking: there is no claim button there). Anything else signed out comes only from the claimable list.
  const reservedOk = !account && asId && invitedEmail ? (await openInviteEmails(group.id, asId)).includes(invitedEmail.trim().toLowerCase()) : false;
  // Signed out: ?as= counts only when it is the name that the open invitation for ?e= was sent for; any other value is ignored (a stranger's
  // link can't be used to read a name off this page).
  const asMember = (account ? unclaimed.find((m) => m.id === asId) : reservedOk ? unclaimed.find((m) => m.id === asId) : null) ?? (waiting ? unclaimed.find((m) => m.id === inviteMemberId(waiting)) : undefined) ?? null;
  const backQ = new URLSearchParams({ ...(invitedEmail ? { e: invitedEmail } : {}), ...(asMember ? { as: asMember.id } : {}) }).toString();
  const back = `/join/${code}${backQ ? `?${backQ}` : ""}`;

  const kind = group.type === "trip" ? "Trip" : group.type === "home" ? "Flat or family" : group.type === "couple" ? "Couple" : group.type === "pot" ? "Game night" : "Group";
  // The place photo for a trip (never the group's own photo: outsiders don't see it).
  const placeSrc = tripPhotoSrc(group);
  const invitedFirst = invitedBy ? invitedBy.trim().split(/\s+/)[0] || invitedBy : "";
  // Whoever looks after the group (pickAdmin): "Varun added these names". Their first name.
  const adminName = pickAdmin(group.members)?.name ?? "";
  const adminFirst = adminName.trim().split(/\s+/)[0] ?? "";

  return (
    <>
      {/* The invitation: no names and no amounts until you join. */}
      <header className="mb-5">
        <span className="font-display text-[26px] font-semibold leading-none tracking-tight">loopin</span>
      </header>
      <section data-join-card>
        <div aria-hidden className="relative aspect-[16/9] w-full overflow-hidden rounded-[20px] bg-[#1f1f24]">
          <GroupCover {...coverFor(group, true)} uid={`join-${group.id}`} letter={group.name} sizes="(max-width: 448px) 100vw, 448px" priority />
          {placeSrc && <Image src={placeSrc} alt="" aria-hidden fill sizes="(max-width: 448px) 100vw, 448px" priority className="object-cover" />}
        </div>
        <h1 className="mt-5 break-words font-display text-[clamp(26px,8vw,32px)] font-semibold leading-[1.1] tracking-[-0.02em] [text-wrap:balance]">Join {group.name}</h1>
        {invitedFirst && <p className="mt-1 text-[15px] text-fg">Invited by {invitedFirst}</p>}
        <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-fg/20 px-3.5 py-1.5 text-[13px] text-fg/75">
          <GroupIcon size={18} className="text-fg/75" />
          {kind} · {active.length} {active.length === 1 ? "person" : "people"}
        </p>
      </section>

      {error === "busy" && <ErrorNote>Too many joins from here in the last hour. Wait a bit and try again.</ErrorNote>}
      {error === "name" && <ErrorNote>{NAME_NEEDED}</ErrorNote>}
      {error === "left" && <ErrorNote>That name has left this group, so it can’t be taken over. Join as yourself instead.</ErrorNote>}
      {error === "removed" && !account && <ErrorNote>You were taken out of this group, so this link can’t bring you back. Ask the person who looks after it.</ErrorNote>}
      {error === "full" && <ErrorNote>This group has no room for more people joining this way. Ask the person who looks after it.</ErrorNote>}
      {error === "claimed" && <ErrorNote>That name is already taken by someone else. Join as yourself instead.</ErrorNote>}

      {!account ? (
        emailInvite ? (
          <>
            {asMember && <p className="mb-4 rounded-[18px] bg-mist px-4 py-3 text-sm">You were added as <strong>{publicName(asMember.name)}</strong>. Join to see your share.</p>}
            <hr className="mt-6 border-0 border-t border-fg/15" />
            <p className="mt-5 text-[15px] leading-snug text-fg/80">Sign in to join and keep your groups across devices.</p>
            <div className="mt-4 space-y-2.5">
              {googleConfigured() && (
                <GoogleSignInLink href={`/api/auth/google/start?${new URLSearchParams({ back })}`} groups={guestGroups} className="pop flex h-14 w-full items-center justify-center gap-3 bg-fg text-base font-semibold text-canvas">
                  <GoogleG />
                  Continue with Google
                </GoogleSignInLink>
              )}
              <Link
                href={`/signin?${new URLSearchParams({ back, ...(invitedEmail ? { e: invitedEmail } : {}) })}`}
                className={googleConfigured() ? "flex h-14 w-full items-center justify-center rounded-full border border-fg/25 bg-transparent text-base font-semibold text-fg transition-transform active:scale-[0.97]" : "pop flex h-14 w-full items-center justify-center bg-fg text-base font-semibold text-canvas"}
              >
                Continue with email
              </Link>
            </div>
            <p className="mt-3 text-center text-[13px] text-fg/50">About 30 seconds, no password. Your groups follow you to any device.</p>
          </>
        ) : step === "name" ? (
          <>
            <hr className="mt-6 border-0 border-t border-fg/15" />
            {claimable.length > 0 && (
              <section className="mt-5" data-claim-names>
                <h2 className="font-display text-[22px] font-semibold leading-tight tracking-tight">Which one is you?</h2>
                {adminFirst && <p className="mb-3 mt-1 text-sm text-fg/65">{adminFirst} added these names</p>}
                <ul className="space-y-2">
                  {claimable.map((m) => (
                    <li key={m.id}>
                      <form action={joinAsExisting}>
                        <input type="hidden" name="code" value={code} />
                        <input type="hidden" name="memberId" value={m.id} />
                        <button type="submit" className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-left active:bg-mist">
                          <Avatar name={m.name} />
                          <span className="font-medium">{publicName(m.name)}</span>
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <form action={joinAsNew} className={`space-y-4 ${claimable.length > 0 ? "mt-8" : "mt-5"}`}>
              <input type="hidden" name="code" value={code} />
              {claimable.length > 0 && <h2 className="font-display text-[22px] font-semibold leading-tight tracking-tight">Not on the list?</h2>}
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-gray-600">Your name in this group</span>
                <input name="name" required placeholder="Your name" autoComplete="given-name" maxLength={40} className={inputClass} />
              </label>
              <button type="submit" className={primaryButtonClass}>
                Join as someone new
              </button>
              <p className="text-center text-xs text-gray-400">This phone remembers you, so you don’t need an account.</p>
            </form>
          </>
        ) : (
          <>
            {asMember && <p className="mb-4 rounded-[18px] bg-mist px-4 py-3 text-sm">You were added as <strong>{publicName(asMember.name)}</strong>. Join to see your share.</p>}
            <hr className="mt-6 border-0 border-t border-fg/15" />
            <div className="mt-5 space-y-3">
              <Link href={`/join/${code}?${new URLSearchParams({ step: "name", ...(asMember ? { as: asMember.id } : {}) })}`} className={primaryButtonClass} data-join-start>
                Join {group.name}
              </Link>
              <p className="text-center text-sm text-fg/65">
                Have a Loopin account?{" "}
                <Link href={`/signin?${new URLSearchParams({ back, ...(invitedEmail ? { e: invitedEmail } : {}) })}`} className="font-semibold text-fg underline underline-offset-4">
                  Sign in
                </Link>
              </p>
            </div>
          </>
        )
      ) : (
        <>
          <hr className="mt-6 border-0 border-t border-fg/15" />
          <p className="mb-5 mt-5 text-[15px] leading-snug text-fg/70">Join to see who’s in, what’s been spent and who owes what.</p>
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
            <p className="text-center text-xs text-gray-400">Joining as <EmailText email={account.email} /></p>
          </form>

          {/* Names stay out of sight until you ask: the page above shows none. */}
          {claimable.length > 0 && (
            <details className="mt-10" data-claim-names>
              <summary className="cursor-pointer text-sm font-medium text-gray-600">Already added to this group by name? <ChevronDown size={14} className="chev ml-1.5 inline-block align-[-2px] text-fg/55" /></summary>
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

      <p className="mt-6 text-center text-[13px] text-fg/50" data-join-footnote>{account ? (invitedFirst ? "No amounts are shown before you join." : "No names or amounts are shown before you join.") : "No amounts are shown before you join."}</p>
      <p className="mt-8 text-center text-xs text-gray-400">Loopin keeps count. It never touches your money.</p>
      <GetAppButton variant="card" className="mt-6" />
    </>
  );
}
