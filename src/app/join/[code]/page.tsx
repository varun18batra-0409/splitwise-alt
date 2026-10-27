import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { GetAppButton } from "@/components/GetApp";
import { db } from "@/lib/db";
import { getAccount, getMemberships } from "@/lib/identity";
import { joinAsExisting, joinAsNew } from "@/app/actions";
import { Avatar, ErrorNote, avatarTone, inputClass, primaryButtonClass } from "@/components/ui";
import { GoogleG } from "@/components/GoogleG";
import { googleConfigured } from "@/lib/google";
import { GroupCover } from "@/components/GroupCover";
import { coverFor, coverOf } from "@/lib/covers";
import { placePhoto } from "@/lib/places";
import { StoryArt } from "@/components/StoryArt";
import type { StoryKind } from "@/lib/home/stories";
import { countdownWords, tripPhase } from "@/lib/countdown";
import { todayKey } from "@/lib/dates";
import { getTimeZone } from "@/lib/tz";
import type { Metadata } from "next";

// What a group of this kind gets you, in three cards.
const PERKS: Record<string, { title: string; line: string; art: StoryKind }[]> = {
  trip: [
    { title: "Split as you go", line: "Any currency, card fees included, one tap to add", art: "trip" },
    { title: "Stories & Wrapped", line: "The trip, told in slides when it’s over", art: "wrapped" },
    { title: "A trip passport", line: "A stamp in everyone’s passport", art: "memory" },
  ],
  home: [
    { title: "Bills on repeat", line: "Rent and Wi-Fi add themselves each month", art: "collect" },
    { title: "Pay in one tap", line: "UPI opens with the amount filled in", art: "square" },
    { title: "The shopping list", line: "Add what’s low, tick what you bought", art: "memory" },
  ],
  couple: [
    { title: "Your split, not 50/50", line: "By income, if you like", art: "square" },
    { title: "Savings goals", line: "Bali in March, counted together", art: "trip" },
    { title: "Who’s ahead", line: "One number for the month", art: "collect" },
  ],
  pot: [
    { title: "Buy in with a tap", line: "Who took what from the pot", art: "pot" },
    { title: "Who pays whom", line: "Worked out when the game ends", art: "square" },
    { title: "The night, as a story", line: "Winners, losers, bragging rights", art: "wrapped" },
  ],
  other: [
    { title: "Split any way", line: "Equally, some of you, or exact amounts", art: "collect" },
    { title: "Pay in one tap", line: "UPI opens with the amount filled in", art: "square" },
    { title: "Stories", line: "Your groups, told as stories on Home", art: "trip" },
  ],
};

// The preview WhatsApp shows for an invite link: the group's name, never anyone's money.
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const group = await db.group.findUnique({ where: { inviteCode: code }, select: { name: true, deletedAt: true } });
  const robots = { index: false, follow: false };
  if (!group || group.deletedAt) return { title: "Join on Loopin", robots };
  const title = `You’re invited to ${group.name}`;
  const description = "Join on Loopin: split everything, settle in one tap. Free, no ads.";
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
  if (!group || group.deletedAt) notFound();

  const account = await getAccount();
  const memberships = await getMemberships();
  const mine = group.members.find((m) => (account && m.accountId === account.id) || memberships[group.id] === m.id);
  if (mine && !mine.leftAt && (!account || mine.accountId === account.id)) redirect(`/groups/${group.id}`);

  const active = group.members.filter((m) => !m.leftAt);
  const verified = active.filter((m) => m.accountId);
  const unclaimed = active.filter((m) => !m.accountId && !m.claimedAt);
  // Invited by email to take over a name: offer that name first.
  const asMember = unclaimed.find((m) => m.id === asId) ?? null;
  const backQ = new URLSearchParams({ ...(invitedEmail ? { e: invitedEmail } : {}), ...(asMember ? { as: asMember.id } : {}) }).toString();
  const back = `/join/${code}${backQ ? `?${backQ}` : ""}`;

  const kind = group.type === "trip" ? "Trip" : group.type === "home" ? "Home" : group.type === "couple" ? "Couple" : group.type === "pot" ? "The Pot" : "Group";
  const phase = group.type === "trip" && group.tripStart ? tripPhase(group.tripStart, group.tripEnd, todayKey(new Date(), await getTimeZone())) : null;
  const countdown = phase ? countdownWords(group.name, phase) : null;
  const firsts = verified.map((m) => m.name.trim().split(/\s+/)[0]);
  const whoIn = firsts.length === 0 ? "" : firsts.length === 1 ? `${firsts[0]} is in` : firsts.length === 2 ? `${firsts[0]} and ${firsts[1]} are in` : `${firsts.slice(0, 2).join(", ")} and ${firsts.length - 2} more are in`;
  const perks = PERKS[group.type] ?? PERKS.other;

  return (
    <>
      {/* The group's picture, edge to edge, with Loopin's name and (for a trip) how soon it leaves. */}
      <div className="relative -mx-5 -mt-[max(1.5rem,env(safe-area-inset-top))] h-[400px] overflow-hidden" aria-hidden>
        {group.type === "trip" && !group.cover && placePhoto(group.name) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={placePhoto(group.name)!.src} alt="" className="lp-drift absolute inset-0 h-full w-full object-cover" />
        ) : coverOf(group) !== "plain" ? (
          <GroupCover {...coverFor(group, true)} uid={`join-${group.id}`} sizes="(max-width: 448px) 100vw, 448px" priority drift />
        ) : (
          <StoryArt kind={group.type === "pot" ? "pot" : "trip"} uid={`join-${group.id}`} />
        )}
        <span className="absolute inset-0 bg-[linear-gradient(180deg,rgba(13,13,15,0.5)_0%,rgba(13,13,15,0)_26%,rgba(13,13,15,0.3)_62%,#0d0d0f_100%)]" />
      </div>
      <div className="absolute inset-x-0 top-0 mx-auto flex max-w-md items-center justify-between px-5 pt-[max(1.2rem,env(safe-area-inset-top))]">
        <span className="font-display text-[26px] font-semibold leading-none tracking-tight [text-shadow:0_2px_12px_rgba(0,0,0,0.4)]">loopin</span>
        {countdown && <span className="glass rounded-full px-3 py-1.5 text-[13px] font-semibold">{countdown.line}</span>}
      </div>

      {/* The invitation itself, on frosted glass over the picture: who's in, and what you get. */}
      <section className="glass relative z-10 -mt-[150px] mb-7 rounded-[30px] px-5 pb-5 pt-5 text-fg" data-join-card>
        <p className="text-[15px] text-fg/70">
          You’re invited to join, {active.length} {active.length === 1 ? "person" : "people"} so far
        </p>
        <h1 className="lp-slide-in mt-1.5 font-display text-[clamp(38px,12vw,52px)] font-semibold leading-[1.02] tracking-[-0.02em]">{group.name}</h1>
        {firsts.length > 0 && (
          <span className="mt-3.5 flex items-center gap-2.5">
            <span className="flex">
              {firsts.slice(0, 4).map((n, i) => (
                <span key={i} className={`lp-pop-in flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#1c1c20] text-[12px] font-bold ${i ? "-ml-2" : ""} ${avatarTone(n)}`} style={{ animationDelay: `${200 + i * 90}ms` }}>
                  {n.charAt(0).toUpperCase()}
                </span>
              ))}
            </span>
            <span className="text-sm text-fg/75">{whoIn}</span>
          </span>
        )}
        <span aria-hidden className="mb-4 mt-5 block h-px bg-fg/10" />
        <ul aria-label="What you get" className="space-y-2.5">
          {perks.map((k, i) => (
            <li key={k.title} className="lp-card flex items-start gap-2.5 text-[14.5px] leading-snug" style={{ animationDelay: `${120 + i * 90}ms` }}>
              <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-owed)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span>
                <span className="font-semibold">{k.title}</span>
                <span className="text-fg/60">: {k.line}</span>
              </span>
            </li>
          ))}
        </ul>
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

      <p className="mt-8 text-center text-xs text-gray-400">Free, no ads. Loopin keeps count; it never touches your money.</p>
      <GetAppButton variant="card" className="mt-6" />
    </>
  );
}
