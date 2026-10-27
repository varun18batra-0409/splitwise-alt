import Link from "@/components/Link";
import { notFound, redirect } from "next/navigation";
import { GetAppButton } from "@/components/GetApp";
import { db } from "@/lib/db";
import { getAccount, getMemberships } from "@/lib/identity";
import { joinAsExisting, joinAsNew } from "@/app/actions";
import { Avatar, ErrorNote, PageHeader, inputClass, primaryButtonClass } from "@/components/ui";
import { GroupCover } from "@/components/GroupCover";
import { coverFor, coverOf } from "@/lib/covers";
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
  const phase = group.type === "trip" && group.tripStart ? tripPhase(group.tripStart, group.tripEnd ?? "", todayKey(new Date(), await getTimeZone())) : null;
  const countdown = phase ? countdownWords(group.name, phase) : null;
  const firsts = verified.map((m) => m.name.trim().split(/\s+/)[0]);
  const whoIn = firsts.length === 0 ? "" : firsts.length === 1 ? `${firsts[0]} is in` : firsts.length === 2 ? `${firsts[0]} and ${firsts[1]} are in` : `${firsts.slice(0, 2).join(", ")} and ${firsts.length - 2} more are in`;
  const perks = PERKS[group.type] ?? PERKS.other;

  return (
    <>
      <PageHeader title={`Join ${group.name}`} />

      {error === "busy" && <ErrorNote>Too many joins from here in the last hour. Wait a bit and try again.</ErrorNote>}
      {error === "claimed" && <ErrorNote>That name is already taken by someone else. Join as yourself instead.</ErrorNote>}

      {/* The invitation itself: the group's picture, who's in, and (for a trip) how soon. */}
      <section className="vault relative -mx-1 mb-7 overflow-hidden rounded-[26px] text-fg" data-join-card>
        <div className="relative h-[210px] overflow-hidden" aria-hidden>
          {coverOf(group) !== "plain" ? (
            <GroupCover {...coverFor(group, true)} uid={`join-${group.id}`} sizes="(max-width: 448px) 100vw, 448px" priority drift />
          ) : (
            <StoryArt kind={group.type === "pot" ? "pot" : "trip"} uid={`join-${group.id}`} className="lp-drift" />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,17,20,0.1)_30%,#141418_100%)]" />
          <span className="absolute left-4 top-4 rounded-full bg-canvas/60 px-3 py-1 text-xs font-semibold backdrop-blur">
            {kind} · {active.length} {active.length === 1 ? "person" : "people"}
          </span>
        </div>
        <div className="relative -mt-10 px-5 pb-6">
          <p className="lp-slide-in font-hand text-[24px] font-bold leading-none text-[#ffd9a8]">You’re invited to</p>
          <h2 className="lp-slide-in mt-1 font-display text-[32px] font-semibold leading-[1.05] tracking-tight">{group.name}</h2>
          {(whoIn || countdown) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              {firsts.length > 0 && (
                <span className="flex items-center">
                  <span className="flex">
                    {firsts.slice(0, 4).map((n, i) => (
                      <span key={i} className="lp-pop-in -mr-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#141418] bg-[#26262c] font-display text-[13px] font-semibold text-fg" style={{ animationDelay: `${200 + i * 90}ms` }}>
                        {n.charAt(0).toUpperCase()}
                      </span>
                    ))}
                  </span>
                  <span className="ml-4 text-sm text-fg/70">{whoIn}</span>
                </span>
              )}
              {countdown && <span className="rounded-full bg-owe/20 px-3 py-1 text-xs font-semibold text-[#ffd2b0]">{countdown.line}</span>}
            </div>
          )}
        </div>
      </section>

      {/* What joining gets you, for this kind of group. */}
      <section aria-label="What you get" className="-mx-5 mb-8">
        <p className="mb-3 px-5 text-[12px] font-semibold uppercase tracking-[0.2em] text-gray-400">Inside, you get</p>
        <ul className="flex snap-x gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          {perks.map((k, i) => (
            <li key={k.title} className="lp-card w-[168px] shrink-0 snap-start overflow-hidden rounded-[20px] border border-line bg-mist" style={{ animationDelay: `${120 + i * 90}ms` }}>
              <span className="relative block h-[88px] overflow-hidden" aria-hidden>
                <StoryArt kind={k.art} uid={`perk-${i}`} />
              </span>
              <span className="block px-3.5 pb-3.5 pt-3">
                <span className="block font-display text-[16px] font-semibold leading-tight">{k.title}</span>
                <span className="mt-1 block text-xs leading-snug text-gray-500">{k.line}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {!account ? (
        <>
          <p className="mb-4 text-[15px] text-gray-600">Sign in with Google or your email to join. 30 seconds, no password, and your groups follow you to any phone.</p>
          {asMember && <p className="mb-4 rounded-xl bg-mist px-4 py-3 text-sm">You were added as <strong>{asMember.name}</strong>. Join to see your share.</p>}
          <Link href={`/signin?${new URLSearchParams({ back, ...(invitedEmail ? { e: invitedEmail } : {}) })}`} className={primaryButtonClass}>
            Sign in or sign up to join
          </Link>
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

      <p className="mt-8 text-center text-xs text-gray-400">Free · No ads · Loopin keeps count, it never touches your money</p>
      <GetAppButton variant="card" className="mt-6" />
    </>
  );
}
