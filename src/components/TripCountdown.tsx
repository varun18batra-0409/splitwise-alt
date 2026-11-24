import Link from "@/components/Link";
import { Polaroid } from "./Polaroid";
import { ShareCountdown } from "./ShareCountdown";
import { countdownCard, countdownWords, placeOf, tripEmoji, tripMetaLine, type TripPhase } from "@/lib/countdown";
import { coverFor } from "@/lib/covers";
import { placePhoto } from "@/lib/places";

// The trip countdown, as a boarding pass (as on 12 Nov, commit 3fd1a0a2): the trip's polaroid on the left, a torn perforation with two
// half-circle bites, and "12 days to go" on the right (handwritten). Share sits under the polaroid; a quiet line gives the start day and
// the head count ("12 December · 6 people") with a small dashed curve ending in a map pin (no names line).
// The number stays off-white (green and orange are for money only); "Today" shows on the day.

type Group = { id: string; name: string; type: string; cover: string; coverAt: Date | null; tripStart?: string | null; tripPlace?: string | null; members: { id: string; name: string; leftAt: Date | null }[] };

export function TripCountdown({ group, phase, slot = 0, today }: { group: Group; phase: TripPhase; slot?: number; today?: string }) {
  const w = countdownWords(group.name, phase);
  if (!w) return null;
  const c = countdownCard(group.name, phase, slot);
  const people = group.members.filter((m) => !m.leftAt);
  const days = phase.kind === "before" ? phase.days : 0;
  // Green and orange are for money only: the count is off-white all the way, and carries no glow.
  const bigColor = "text-fg";
  const glow = "";
  const place = placeOf(group.name);
  // The destination's photo (Thailand → Maya Bay), so Home doesn't show the group's photo three times.
  // It reads "Where to?" as well as the name (a trip called "Weekend" to Manali shows Manali, not a generic photo).
  const dest = placePhoto(`${group.name} ${group.tripPlace ?? ""}`.trim(), group.id);
  // "12 December · 6 people" (the start day, then the head count); an undated trip says just the people.
  const meta = tripMetaLine(group.tripStart, people.length, today ?? new Date().toISOString().slice(0, 10));

  return (
    <section aria-label={`${place}, trip countdown`} data-countdown={phase.kind === "before" ? days : phase.kind} data-trip-pass={group.id} className="lp-rise h-full">
      <div className={`relative flex h-full overflow-hidden rounded-[22px] text-fg ${glow} [background:radial-gradient(90%_120%_at_100%_0%,#3a2a1e_0%,transparent_60%),linear-gradient(160deg,#1d1a17_0%,#121014_80%)]`}>
        {/* The trip's photo, with Share right under it (44px tall, as wide as the polaroid, so it fits a 320px phone) */}
        <div className="relative z-10 flex shrink-0 flex-col items-center py-4 pl-3.5 pr-3">
          <Link href={`/groups/${group.id}`} aria-label={`Open ${group.name}`}>
            <Polaroid
              cover={dest ? { kind: "own", src: dest.src } : coverFor(group)}
              uid={`cd-${group.id}`}
              letter={group.name}
              caption={place}
              photoClass="h-[94px] min-[380px]:h-[114px]"
              captionClass="text-[18px] min-[380px]:text-[19px]"
              className="w-[112px] -rotate-[4deg] min-[380px]:w-[134px]"
              sizes="150px"
            />
          </Link>
          <ShareCountdown
            groupId={group.id}
            line={w.line}
            className="mt-2.5 inline-flex h-11 w-[112px] items-center justify-center gap-1.5 rounded-full border border-fg/25 bg-transparent text-xs font-semibold active:bg-fg/20 min-[380px]:w-[134px]"
          />
        </div>
        {/* The perforation, with the two half-circle bites of a ticket */}
        <span aria-hidden className="relative my-3 w-0 border-l-2 border-dashed border-fg/15">
          <span className="absolute -left-[11px] -top-[23px] h-5 w-5 rounded-full bg-canvas" />
          <span className="absolute -bottom-[23px] -left-[11px] h-5 w-5 rounded-full bg-canvas" />
        </span>
        {/* The count */}
        <div className="flex min-w-0 flex-1 flex-col justify-center py-4 pl-3.5 pr-3">
          <div className="flex items-center gap-2">
            <p className="min-w-0 text-[10px] font-semibold uppercase leading-tight tracking-[0.18em] text-fg/60">{c?.kicker ?? (phase.kind === "during" ? "On the trip" : "Coming up")}</p>
            {phase.kind !== "during" && <TakeOff className={bigColor} />}
          </div>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className={`font-display font-semibold leading-none tracking-tight tabular-nums ${bigColor} ${w.big.length > 3 ? "text-[38px]" : "text-[54px]"}`} data-countdown-big>
              {w.big}
            </span>
            <span className="font-hand text-[22px] font-bold leading-none text-fg/80">{w.small}</span>
          </p>
          <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-snug" data-countdown-line data-countdown-quip>
            {c?.quip ?? w.line}
          </p>
          {meta && (
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-fg/55" data-trip-meta>
              <p className="min-w-0 text-xs leading-snug">{meta}</p>
              <RouteToPin />
            </div>
          )}
        </div>
        <span aria-hidden className="pointer-events-none absolute -right-3 -top-4 select-none text-[64px] opacity-[0.13]">
          {tripEmoji(group.name)}
        </span>
      </div>
    </section>
  );
}

// A small plane taking off down a dashed runway, next to "Boarding in".
export function TakeOff({ className }: { className: string }) {
  return (
    <span aria-hidden data-takeoff className="relative h-[24px] min-w-[34px] flex-1 overflow-hidden">
      <span className="absolute inset-x-0 bottom-[3px] border-t border-dashed border-fg/20" />
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className={`lp-takeoff absolute ${className}`}>
        <path d="M2 16l20-7-4-2-6 2-6-4-2 1 4 5-4 1-2-1-1 1z" />
      </svg>
    </span>
  );
}

// A small hand-drawn dashed curve that ends in a map pin: where the trip is headed. Muted, decorative.
function RouteToPin() {
  return (
    <svg aria-hidden width="72" height="22" viewBox="0 0 72 22" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0 text-fg/40">
      <path d="M1 17C10 6 18 19 30 11S46 3 55 11" strokeWidth={1.2} strokeDasharray="2 3" />
      <g transform="translate(55 2) scale(0.7)" strokeWidth={1.8}>
        <path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21z" />
        <circle cx="12" cy="10.5" r="2.3" />
      </g>
    </svg>
  );
}
