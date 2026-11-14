import Link from "@/components/Link";
import { BackIcon, ChevronDown, GearIcon, InviteIcon } from "@/components/icons";
import { GroupCover } from "@/components/GroupCover";
import { avatarTone } from "@/components/ui";
import { tripPhotoSrc } from "@/lib/places";
import { coverFor, coverOf, type CoverChoice } from "@/lib/covers";
import type { GroupView } from "./view";
import { countdownWords, headerTripLine, placeOf, tripPhase } from "@/lib/countdown";
import { todayKey } from "@/lib/dates";
import { climateFor, tripMonth, weatherWords } from "@/lib/climate";
import { tripStops } from "@/lib/geo";
import { membersAsOf } from "@/lib/left-view";

type SwitchItem = { id: string; name: string; pic?: { kind: CoverChoice; src?: string } };

// Trips and other groups (the founder's mockup 03): back, the group's name (tap to switch group), a ⋯ menu, the picture as a rounded card,
// "6 people · Starts in 36 days", the faces and a labelled Invite pill. Flats and couples (mockup 10) keep the picture edge to edge.
// Home, Search and Settle also live in the bottom bar.
export function GroupHeader({ v, switchTo }: { v: GroupView; switchTo: SwitchItem[] }) {
  const { group, myId } = v;
  const me = group.members.find((m) => m.id === myId);
  const cover = coverOf(group);
  // Trip groups: the countdown ("Goa in 12 days"), or a nudge to add the dates.
  const phase = group.type === "trip" ? tripPhase(group.tripStart, group.tripEnd, todayKey(new Date(), v.tz)) : null;
  const words = phase ? countdownWords(group.name, phase) : null;
  const hot = phase && (phase.kind !== "before" || phase.days <= 7);
  // Part of the one quiet line under the name: the countdown (full strength when it is close), or "Add dates" as an underlined link.
  const tripPill =
    group.type !== "trip" || group.closed ? null : words && phase && headerTripLine(phase) ? (
      <span data-countdown-line className={hot ? "font-semibold text-fg" : undefined}>
        {headerTripLine(phase)}
      </span>
    ) : !group.tripStart ? (
      <Link href={`/groups/${group.id}/settings#trip`} className="-my-3 inline-flex min-h-11 items-center font-semibold text-fg underline underline-offset-4" data-add-dates>
        Add dates
      </Link>
    ) : null;

  // The usual weather there on the trip's dates: from two months out until it ends.
  const weather = (() => {
    if (group.type !== "trip" || group.closed || !group.tripStart || !phase || phase.kind === "after") return null;
    if (phase.kind === "before" && phase.days > 60) return null;
    const stop = tripStops(group.name, group.tripPlace ?? "", group.tripCountry ?? "")[0];
    const c = stop ? climateFor(stop.city, stop.country, tripMonth(group.tripStart, group.tripEnd)) : null;
    if (!c) return null;
    const w = weatherWords(c, group.currency === "USD");
    const f = (n: number) => `${group.currency === "USD" ? Math.round((n * 9) / 5 + 32) : n}°`;
    const month = new Date(Date.UTC(2026, tripMonth(group.tripStart, group.tripEnd), 15)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
    return { pill: `${f(c.hi)} / ${f(c.lo)}`, where: stop.city || placeOf(group.name), month, w };
  })();
  const weatherPill = weather && (
    <details className="group/wx relative" data-trip-weather>
      <summary className="-my-3 flex min-h-11 cursor-pointer list-none items-center font-semibold [&::-webkit-details-marker]:hidden">{weather.pill}</summary>
      <div className="absolute left-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2.5rem)] rounded-2xl border border-line bg-white p-4 text-sm shadow-2xl shadow-black/60">
        <p className="text-xs text-gray-400">
          {weather.where} in {weather.month}, usually
        </p>
        <p className="mt-1 font-semibold">{weather.w.temps.replace(/^Usually /, "").replace(/^\w/, (x) => x.toUpperCase())}</p>
        <p className="mt-1 text-fg/80">{weather.w.sky}</p>
        <p className="mt-2 text-fg/80">{weather.w.tip}</p>
        <p className="mt-3 text-[11px] text-gray-400">Long-term averages for the month, not a forecast.</p>
      </div>
    </details>
  );

  const rowButton = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-fg/10 bg-fg/[0.06] text-fg/85 backdrop-blur transition-transform active:scale-95 active:bg-fg/10";

  const switcher = (big: boolean) => (
    <details className={`group/switch relative min-w-0 ${big ? "max-w-full" : "flex-1"}`}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <h1 className={`font-display font-semibold tracking-[-0.02em] ${big ? "line-clamp-2 text-[clamp(32px,10vw,44px)] leading-[1.02]" : "line-clamp-2 text-[24px] leading-[1.1]"}`}>{group.name}</h1>
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

  // Someone who left sees who was in the group on the day they left, not whoever joined since.
  const people = (v.leaver ? membersAsOf(group.members, myId, v.leaver.leftAt) : group.members).filter((m) => !m.leftAt);
  const names = people.map((m) => (m.id === myId ? "You" : m.name.trim().split(/\s+/)[0]));
  const ordered = [...names.filter((n) => n === "You"), ...names.filter((n) => n !== "You")];
  // A trip with no photo of its own shows a real photo of the place instead (Thailand → Maya Bay), the same as its polaroid.
  const placeShot = tripPhotoSrc(group);
  const flat = (group.type === "home" || group.type === "couple") && cover !== "plain";

  // The one quiet line: how many, and the trip's dates or countdown (no pills), plus the usual weather.
  const line = (shadow: boolean) => (
    <div className={`flex flex-wrap items-center gap-x-2 text-[13px] text-fg/75 ${shadow ? "[text-shadow:0_1px_12px_rgba(0,0,0,0.5)]" : ""}`} data-group-line>
      <span>
        {people.length} {people.length === 1 ? "person" : "people"}
      </span>
      {tripPill && (
        <>
          <span aria-hidden>·</span>
          {tripPill}
        </>
      )}
      {weatherPill && (
        <>
          <span aria-hidden>·</span>
          {weatherPill}
        </>
      )}
    </div>
  );

  // Everyone's initials (opens People); a person is named in full in the label, not cut.
  const faces = (
    <Link href={`/groups/${group.id}?tab=balances`} className="flex min-h-11 items-center active:opacity-80" aria-label={`Everyone in ${group.name}: ${ordered.join(", ")}`}>
      <span className="flex" aria-hidden>
        {ordered.slice(0, 6).map((n, i) => (
          <span key={`${n}-${i}`} className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-[var(--color-canvas)] text-[13px] font-bold ${i ? "-ml-2" : ""} ${avatarTone(n)}`}>
            {n.charAt(0).toUpperCase()}
          </span>
        ))}
        {ordered.length > 6 && (
          <span className="-ml-2 flex h-9 min-w-9 items-center justify-center rounded-full border-2 border-[var(--color-canvas)] bg-mist px-1.5 text-[12px] font-semibold text-fg/80">+{ordered.length - 6}</span>
        )}
      </span>
    </Link>
  );

  if (!flat) {
    return (
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <Link href="/" aria-label="Back to all groups" className={rowButton}>
            <BackIcon size={20} />
          </Link>
          {switcher(false)}
          <details className="group/more relative shrink-0">
            <summary aria-label="More about this group" className={`${rowButton} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
              <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </summary>
            <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-2xl border border-line bg-white p-2 shadow-2xl shadow-black/60">
              <Link href={`/groups/${group.id}/settings`} className="flex min-h-11 items-center gap-3 rounded-xl px-3 active:bg-mist">
                <GearIcon size={18} />
                Group settings
              </Link>
              {!v.leaver && (
                <Link href={`/groups/${group.id}/passports`} className="flex min-h-11 items-center gap-3 rounded-xl px-3 active:bg-mist">
                  Our passports
                </Link>
              )}
            </div>
          </details>
        </div>
        {cover !== "plain" && (
          <div className="relative mt-3 h-[150px] overflow-hidden rounded-[20px] bg-mist min-[390px]:h-[168px]" data-group-photo>
            {placeShot ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={placeShot} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <GroupCover {...coverFor(group)} uid={`head-${group.id}`} letter={group.name} sizes="(max-width: 448px) 100vw, 448px" priority />
            )}
          </div>
        )}
        <div className="mt-3">{line(false)}</div>
        <div className="mt-1 flex items-center justify-between gap-3">
          {faces}
          {!v.leaver && (
            <Link href={`/groups/${group.id}/invite`} aria-label="Add people" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-fg/25 px-4 text-[15px] font-semibold text-fg active:bg-fg/10" data-invite-pill>
              <InviteIcon size={18} />
              Invite
            </Link>
          )}
        </div>
      </header>
    );
  }

  // Flats and couples: the picture runs edge to edge behind the buttons and the name, fading into the page.
  const glass = "glass flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-fg active:scale-95";
  return (
    <header className="relative -mx-5 -mt-[max(1.5rem,env(safe-area-inset-top))] mb-5 h-[300px] px-5 pt-[max(1.1rem,env(safe-area-inset-top))]">
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {placeShot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={placeShot} alt="" className="lp-drift absolute inset-0 h-full w-full object-cover" />
        ) : (
          <GroupCover {...coverFor(group)} uid={`head-${group.id}`} letter={group.name} sizes="(max-width: 448px) 100vw, 448px" priority drift />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.5)_0%,rgba(0,0,0,0)_30%,rgba(0,0,0,0.5)_62%,var(--color-canvas)_100%)]" />
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
        <div className="flex [text-shadow:0_2px_18px_rgba(0,0,0,0.35)]">{switcher(true)}</div>
        <div className="mt-1">{faces}</div>
        {/* One quiet line: how many, and the countdown (no pills). */}
        {line(true)}
      </div>
    </header>
  );
}
