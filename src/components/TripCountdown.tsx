import Link from "@/components/Link";
import { Polaroid } from "./Polaroid";
import { ShareCountdown } from "./ShareCountdown";
import { countdownWords, placeOf, tripEmoji, type TripPhase } from "@/lib/countdown";
import { coverFor } from "@/lib/covers";
import { placePhoto } from "@/lib/places";

// The trip countdown, as a boarding pass: the trip's polaroid on the left, a
// torn perforation, and "12 days to go" on the right, with everyone coming.
// It warms up as the day gets close: calm a month out, green within a month,
// glowing orange in the last week, and "Today" on the day.

type Group = { id: string; name: string; type: string; cover: string; coverAt: Date | null; members: { id: string; name: string; leftAt: Date | null }[] };

export function TripCountdown({ group, phase, more = 0 }: { group: Group; phase: TripPhase; more?: number }) {
  const w = countdownWords(group.name, phase);
  if (!w) return null;
  const people = group.members.filter((m) => !m.leftAt);
  const days = phase.kind === "before" ? phase.days : 0;
  const tone = phase.kind !== "before" ? "now" : days <= 7 ? "close" : days <= 30 ? "soon" : "far";
  const bigColor = tone === "now" || tone === "close" ? "text-owe" : tone === "soon" ? "text-owed" : "text-fg";
  const glow = tone === "close" || tone === "now" ? "shadow-[0_0_44px_-14px_rgba(255,171,107,0.7)]" : "";
  const place = placeOf(group.name);
  // The destination's photo (Thailand → Maya Bay), so Home doesn't show the group's photo three times.
  const dest = placePhoto(group.name);
  const names = people.map((m) => m.name.split(" ")[0]);
  // Everyone going, by first name ("Varun, Nupur, Ravi & Meera").
  const withWho = names.length <= 1 ? "" : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;

  return (
    <section aria-label="Trip countdown" data-countdown={phase.kind === "before" ? days : phase.kind} className="lp-rise">
      <div className={`relative flex overflow-hidden rounded-[22px] text-fg ${glow} [background:radial-gradient(90%_120%_at_100%_0%,#3a2a1e_0%,transparent_60%),linear-gradient(160deg,#1d1a17_0%,#121014_80%)]`}>
        {/* The trip's photo */}
        <Link href={`/groups/${group.id}`} className="relative z-10 shrink-0 py-4 pl-4 pr-3" aria-label={`Open ${group.name}`}>
          <Polaroid
            cover={dest ? { kind: "own", src: dest.src } : coverFor(group)}
            uid={`cd-${group.id}`}
            letter={group.name}
            caption={place}
            photoClass="h-[92px]"
            captionClass="text-[18px]"
            className="w-[112px] -rotate-[4deg]"
            sizes="120px"
          />
        </Link>
        {/* The perforation, with the two half-circle bites of a ticket */}
        <span aria-hidden className="relative my-3 w-0 border-l-2 border-dashed border-fg/15">
          <span className="absolute -left-[11px] -top-[23px] h-5 w-5 rounded-full bg-canvas" />
          <span className="absolute -bottom-[23px] -left-[11px] h-5 w-5 rounded-full bg-canvas" />
        </span>
        {/* The count */}
        <div className="flex min-w-0 flex-1 flex-col justify-center py-4 pl-4 pr-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/45">{phase.kind === "during" ? "On the trip" : "Boarding in"}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className={`font-display font-semibold leading-none tracking-tight tabular-nums ${bigColor} ${w.big.length > 3 ? "text-[38px]" : "text-[54px]"}`} data-countdown-big>
              {w.big}
            </span>
            <span className="font-hand text-[22px] font-bold leading-none text-fg/80">{w.small}</span>
          </p>
          <p className="mt-1.5 truncate text-sm font-medium" data-countdown-line>
            {w.line}
          </p>
          {withWho && <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-fg/45">with {withWho}</p>}
          <div className="mt-3 flex items-center gap-3">
            <ShareCountdown groupId={group.id} text={`${w.line} ✨`} />
            {more > 0 && <span className="text-[11px] text-fg/40">+{more} more trip{more > 1 ? "s" : ""} coming</span>}
          </div>
        </div>
        <span aria-hidden className="pointer-events-none absolute -right-3 -top-4 select-none text-[64px] opacity-[0.13]">
          {tripEmoji(group.name)}
        </span>
      </div>
    </section>
  );
}
