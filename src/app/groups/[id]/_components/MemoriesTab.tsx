import Link from "@/components/Link";
import { CameraPlusIcon } from "@/components/MomentIcons";
import { MomentsFeed } from "@/components/MomentsFeed";
import { PostcardFront } from "@/components/postcards/Card";
import { SealedEnvelope, SealMark } from "@/components/postcards/Sealed";
import { SendPostcardCard } from "@/components/postcards/SendCard";
import { POSTCARD_FONTS_URL } from "@/lib/postcards/catalog";
import { cardProps } from "@/lib/postcards/view";
import { CREAM, OUTLINE } from "@/components/HomeMoney";
import { dayGroups, type GroupPostcard, type TripStamp } from "@/lib/group-memories";
import type { MomentCard } from "@/lib/moments-db";
import { placePhoto } from "@/lib/places";
import { placeOf } from "@/lib/countdown";
import type { GroupView } from "./view";

const PAPER = { backgroundColor: "#efe8d6", backgroundImage: "repeating-linear-gradient(115deg, rgba(38,35,29,0.035) 0 1px, transparent 1px 7px)" } as const;
const TILT = ["-rotate-[2deg]", "rotate-[1.5deg]", "-rotate-[1deg]", "rotate-[2.5deg]"];

// A group's Memories tab: its moments by day (newest day first while the trip is on; Day 1 first once it is over), the trip's passport stamp,
// the postcards you sent or got from this group, and Wrapped once the trip is over. One main button: Add a moment. No money anywhere here.
export function MemoriesTab({
  v,
  cards,
  stamp,
  postcards,
  today,
  canAdd,
  guest,
  removed,
}: {
  v: GroupView;
  cards: MomentCard[];
  stamp: TripStamp | null;
  postcards: GroupPostcard[];
  today: string;
  canAdd: boolean;
  guest: boolean;
  removed: boolean;
}) {
  const { group, tz } = v;
  const now = new Date();
  const trip = group.type === "trip";
  const days = dayGroups(cards, group.tripStart, group.tripEnd, tz, today);
  const over = trip && Boolean(group.tripEnd) && today > group.tripEnd && v.expenses.length >= 3;
  const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz });
  const empty = days.length === 0 && !stamp && postcards.length === 0;
  const hasPostcards = postcards.length > 0;
  const stampLines = stamp?.stampText.split(" / ") ?? [];
  return (
    <div className="space-y-8" data-memories>
      {hasPostcards && <link rel="stylesheet" href={POSTCARD_FONTS_URL} precedence="default" />}
      {removed && (
        <p role="status" className="text-sm text-fg/75">
          That moment is gone.
        </p>
      )}

      {trip && canAdd && (
        <Link href={`/groups/${group.id}/moments/new`} className={`${CREAM} w-full gap-2.5`} data-add-moment>
          <CameraPlusIcon size={22} />
          Add a moment
        </Link>
      )}
      {trip && !canAdd && guest && (
        <Link href={`/signin?${new URLSearchParams({ back: `/groups/${group.id}?tab=memories` })}`} className={`${OUTLINE} w-full`}>
          Sign in to add a moment
        </Link>
      )}

      {stamp && (
        <section aria-label="Trip stamp" className="rounded-[20px] border border-line bg-white p-4" data-trip-stamp>
          <div className="flex items-center gap-4">
            <div aria-hidden className="-rotate-3 shrink-0 rounded-[4px] px-3 py-2 text-center text-[#26231d] shadow-[0_6px_16px_-6px_rgba(0,0,0,0.7)]" style={PAPER}>
              {stampLines.map((l, i) => (
                <span key={i} className="block font-display text-[15px] font-semibold leading-tight tracking-[0.12em]">
                  {l}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <p className="break-words font-semibold leading-tight">{stamp.title}</p>
              <p className="mt-0.5 text-[13px] text-fg/55">{[stamp.dates, stamp.days > 0 ? `${stamp.days} ${stamp.days === 1 ? "day" : "days"}` : ""].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <Link href={stamp.reliveHref} className={`${OUTLINE} mt-3 w-full`} data-relive>
            Relive trip
          </Link>
        </section>
      )}

      {days.map((d) => (
        <section key={d.key} aria-label={d.label} data-memory-day={d.key}>
          <h2 className="mb-2 text-[13px] font-medium text-fg/55">{d.label}</h2>
          <MomentsFeed cards={d.cards} groupId={group.id} now={now} />
        </section>
      ))}

      {hasPostcards && (
        <section aria-labelledby="mem-postcards-h">
          <h2 id="mem-postcards-h" className="mb-3 font-display text-[20px] font-semibold tracking-tight">
            Postcards
          </h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-6" data-memory-postcards>
            {postcards.map((p, i) => (
              <li key={p.id} data-postcard-item={p.id}>
                <Link href={`/postcards/${p.id}`} className={`relative block transition-transform active:scale-[0.97] ${TILT[i % TILT.length]}`}>
                  {p.row ? <PostcardFront {...cardProps(p.row, "", tz).front} /> : <SealedEnvelope from="" opens={p.sealedUntil ? short.format(p.sealedUntil) : ""} small />}
                  {p.row?.reaction && p.direction === "sent" && <SealMark id={p.row.reaction} k={`s${p.id}`} className="absolute -bottom-3 -right-2 w-[24%] rotate-[10deg]" />}
                </Link>
                <p className="mt-2.5 truncate text-[13px] text-fg/70">{p.sealedUntil ? `Sealed until ${short.format(p.sealedUntil)}` : p.direction === "sent" ? `To ${p.who}` : `From ${p.who}`}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!v.leaver && (
        <SendPostcardCard
          href={`/postcards/new?group=${group.id}`}
          front={trip && !group.cover && placePhoto(group.name) ? `photo:${placePhoto(group.name)!.src}` : group.type === "pot" ? "print:cards" : group.type === "home" || group.type === "couple" ? "print:home" : "print:beach"}
          words={trip ? placeOf(group.name) : ""}
        />
      )}

      {over && (
        <Link href={`/groups/${group.id}/wrapped`} className="flex min-h-11 items-center justify-between gap-3 border-y border-line py-2 text-[15px] font-medium text-fg/85 active:opacity-70" data-memories-wrapped>
          Watch the Wrapped
          <span aria-hidden className="text-fg/40">›</span>
        </Link>
      )}

      {empty && trip && !canAdd && <p className="text-sm text-fg/55">{v.leaver ? "You left this group, so you can look back but not add." : "Moments and postcards from this trip will show up here."}</p>}
      {empty && trip && canAdd && <p className="text-sm text-fg/55">One photo and a few words. Only people in this group see them.</p>}
      {!empty && v.leaver && trip && <p className="text-sm text-fg/55">You left this group, so you can look back but not add.</p>}
    </div>
  );
}
