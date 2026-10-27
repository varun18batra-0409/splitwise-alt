import Link from "@/components/Link";
import { CalendarClockIcon } from "@/components/DrawnIcons";
import { BackIcon, ChevronDown, GearIcon, InviteIcon, iconButtonClass } from "@/components/icons";
import { GroupCover } from "@/components/GroupCover";
import { avatarTone } from "@/components/ui";
import { placePhoto } from "@/lib/places";
import { coverFor, coverOf, type CoverChoice } from "@/lib/covers";
import type { GroupView } from "./view";
import { countdownWords, tripPhase } from "@/lib/countdown";
import { todayKey } from "@/lib/dates";

type SwitchItem = { id: string; name: string; pic?: { kind: CoverChoice; src?: string } };

// Back to all groups · group name (tap to switch group) · Invite · Settings.
// Home, Search and Settle also live in the bottom bar.
export function GroupHeader({ v, switchTo }: { v: GroupView; switchTo: SwitchItem[] }) {
  const { group, myId } = v;
  const me = group.members.find((m) => m.id === myId);
  const cover = coverOf(group);
  // Trip groups: the countdown ("Goa in 12 days 🌴"), or a nudge to add the dates.
  const phase = group.type === "trip" ? tripPhase(group.tripStart, group.tripEnd, todayKey(new Date(), v.tz)) : null;
  const words = phase ? countdownWords(group.name, phase) : null;
  const hot = phase && (phase.kind !== "before" || phase.days <= 7);
  const tripPill =
    group.type !== "trip" || group.closed ? null : words ? (
      <span data-countdown-line className={`inline-block rounded-full px-3 py-1 text-[13px] font-semibold backdrop-blur ${hot ? "bg-owe/25 text-[#ffd2b0]" : "glass"}`}>
        {words.line}
      </span>
    ) : !group.tripStart ? (
      <Link href={`/groups/${group.id}/settings#trip`} className="glass inline-block rounded-full px-3 py-1 text-[13px] font-semibold text-fg/85">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClockIcon size={13} /> Add trip dates
        </span>
      </Link>
    ) : null;

  const switcher = (big: boolean) => (
    <details className="group/switch relative min-w-0 flex-1">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <h1 className={`font-display font-semibold tracking-[-0.02em] ${big ? "line-clamp-2 text-[clamp(32px,10vw,44px)] leading-[1.02]" : "truncate text-[24px]"}`}>{group.name}</h1>
        <span className={`shrink-0 transition-transform group-open/switch:rotate-180 ${big ? "text-fg/80" : "text-gray-400"}`}>
          <ChevronDown size={18} />
        </span>
        <span className="sr-only">Switch group</span>
      </summary>
      <div className="absolute left-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2.5rem)] rounded-2xl border border-line bg-white p-2 shadow-2xl shadow-black/60">
        {switchTo.length === 0 ? (
          <p className="px-3 py-2 text-sm text-gray-500">No other open groups.</p>
        ) : (
          <>
            <p className="px-3 pb-1 pt-1.5 text-xs text-gray-400">Switch to</p>
            <ul>
              {switchTo.map((g) => (
                <li key={g.id}>
                  <Link href={`/groups/${g.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2 active:bg-mist">
                    {g.pic && (
                      <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg" aria-hidden>
                        <GroupCover {...g.pic} uid={`sw-${g.id}`} letter={g.name} letterClass="text-sm" sizes="32px" />
                      </span>
                    )}
                    <span className="truncate font-medium">{g.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        {/* Who this phone is in this group — and a way to fix a wrong pick. */}
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-line px-3 pb-1 pt-2.5 text-xs text-gray-400">
          <span className="truncate">You’re {me?.name ?? "—"} in this group</span>
          <Link href={`/groups/${group.id}/invite`} className="shrink-0 font-semibold text-fg">
            Add people
          </Link>
        </div>
      </div>
    </details>
  );

  // A plain group (no picture): the compact header.
  if (cover === "plain") {
    return (
      <header className="mb-8 flex items-center gap-2">
        <Link href="/" aria-label="Back to all groups" className={iconButtonClass}>
          <BackIcon size={20} />
        </Link>
        {switcher(false)}
        <Link href={`/groups/${group.id}/invite`} aria-label="Add people" className={iconButtonClass}>
          <InviteIcon size={20} />
        </Link>
        <Link href={`/groups/${group.id}/settings`} aria-label="Group settings" className={iconButtonClass}>
          <GearIcon size={20} />
        </Link>
      </header>
    );
  }

  // With a picture: it runs edge to edge behind the buttons and the name, fading into the group's tint.
  const glass = "glass flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-fg active:scale-95";
  const type = ({ trip: "Trip", home: "Home", couple: "Couple", pot: "Card nights" } as Record<string, string | undefined>)[group.type];
  const people = group.members.filter((m) => !m.leftAt);
  // A trip still on its default drawing shows a real photo of the place instead (Thailand → Maya Bay).
  const placeShot = group.type === "trip" && !group.cover ? placePhoto(group.name)?.src : undefined;
  const names = people.map((m) => (m.id === myId ? "You" : m.name.trim().split(/\s+/)[0]));
  const ordered = [...names.filter((n) => n === "You"), ...names.filter((n) => n !== "You")];
  const crew = ordered.length <= 1 ? ordered.join("") : ordered.length <= 4 ? `${ordered.slice(0, -1).join(", ")} and ${ordered[ordered.length - 1]}` : `${ordered.slice(0, 3).join(", ")} and ${ordered.length - 3} more`;
  return (
    <header className="relative -mx-5 -mt-[max(1.5rem,env(safe-area-inset-top))] mb-5 h-[300px] px-5 pt-[max(1.1rem,env(safe-area-inset-top))]">
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {placeShot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={placeShot} alt="" className="lp-drift absolute inset-0 h-full w-full object-cover" />
        ) : (
          <GroupCover {...coverFor(group)} uid={`head-${group.id}`} letter={group.name} sizes="(max-width: 448px) 100vw, 448px" priority drift />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.5)_0%,rgba(0,0,0,0)_30%,rgba(0,0,0,0.18)_55%,var(--color-canvas)_100%)]" />
      </div>
      <div className="relative flex items-center gap-2">
        <Link href="/" aria-label="Back to all groups" className={glass}>
          <BackIcon size={20} />
        </Link>
        <span className="flex-1" />
        <Link href={`/groups/${group.id}/invite`} aria-label="Add people" className={glass}>
          <InviteIcon size={20} />
        </Link>
        <Link href={`/groups/${group.id}/settings`} aria-label="Group settings" className={glass}>
          <GearIcon size={20} />
        </Link>
      </div>
      <div className="absolute inset-x-5 bottom-1">
        <p className="mb-2 flex flex-wrap gap-1.5">
          <span className="glass inline-block rounded-full px-3 py-1 text-[13px] font-semibold">
            {type ? `${type} with ` : ""}
            {people.length} {people.length === 1 ? "person" : "people"}
          </span>
          {tripPill}
        </p>
        <div className="flex [text-shadow:0_2px_18px_rgba(0,0,0,0.35)]">{switcher(true)}</div>
        <Link href={`/groups/${group.id}/people`} className="mt-2.5 flex items-center gap-2.5 active:opacity-80" aria-label={`Everyone in ${group.name}: ${ordered.join(", ")}`}>
          <span className="flex" aria-hidden>
            {ordered.slice(0, 4).map((n, i) => (
              <span key={`${n}-${i}`} className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--color-canvas)] text-[11px] font-bold ${i ? "-ml-2" : ""} ${avatarTone(n)}`}>
                {n.charAt(0).toUpperCase()}
              </span>
            ))}
          </span>
          <span className="truncate text-[13px] text-fg/75" aria-hidden>
            {crew}
          </span>
        </Link>
      </div>
    </header>
  );
}
