import Image from "next/image";
import Link from "@/components/Link";
import { StampMark } from "@/components/PassportBook";
import { CalendarIcon, DotsIcon, PeopleIcon, PhotoIcon } from "@/components/PassportIcons";
import { removePlaceAction } from "@/app/passport-actions";
import { photoSet, placePhotos, placeSlot } from "@/lib/places";
import type { BeenCardData } from "@/lib/passport-cards";

// The cards of the passport's Been tab: a big one for the newest trip, small ones for the rest, and a
// quiet one for a country added by hand. Layout: photo with the place's stamp, then words. Server-drawn.

// A trip: the place's photo (or a mood photo when the place isn't known). A country added by hand: only
// a photo that is really that country; otherwise none (a plain card with the stamp), never a wrong one.
function photoOf(c: BeenCardData): string | undefined {
  if (c.kind === "trip") return placePhotos(c.groupName, c.place, 1)[0];
  const slot = placeSlot(c.title);
  return slot ? photoSet(slot)[0] : undefined;
}

// The stamp on a piece of paper, tilted on the photo's corner. The stamp artwork is the booklet's own.
function PhotoStamp({ c, scale }: { c: BeenCardData; scale: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute right-2 top-2 isolate" style={{ transform: `rotate(5deg) scale(${scale})`, transformOrigin: "top right" }}>
      <div className="relative h-[140px] w-[150px] rounded-[6px] bg-[#efe8d6] shadow-[0_6px_16px_-6px_rgba(0,0,0,0.7)]">
        <StampMark s={c.stamp} i={0} at={{ left: "50%", top: "50%" }} />
      </div>
    </div>
  );
}

function Photo({ c, className, sizes, scale }: { c: BeenCardData; className: string; sizes: string; scale: number }) {
  const src = photoOf(c);
  return (
    <div className={`relative overflow-hidden bg-mist ${className}`}>
      {src && <Image src={src} alt="" fill sizes={sizes} className="object-cover" />}
      <PhotoStamp c={c} scale={scale} />
    </div>
  );
}

// Round initials, neutral, with an off-white 25% edge.
function Faces({ initials }: { initials: string[] }) {
  if (!initials.length) return null;
  return (
    <span aria-hidden className="flex shrink-0 -space-x-1.5">
      {initials.map((l, i) => (
        <span key={i} className="flex h-8 w-8 items-center justify-center rounded-full border border-fg/25 bg-mist text-[13px] font-semibold text-fg">
          {l}
        </span>
      ))}
    </span>
  );
}

const tripWords = (c: BeenCardData) => [c.dates, c.days ? `${c.days} ${c.days === 1 ? "day" : "days"}` : ""].filter(Boolean).join(" · ");

// The newest trip, big.
export function BeenCardBig({ c }: { c: BeenCardData }) {
  return (
    <article className="overflow-hidden rounded-[20px] border border-line bg-white" data-been-card="big" data-group={c.groupId}>
      <div className="relative">
        <Photo c={c} className="aspect-[5/2] w-full" sizes="(max-width: 480px) 100vw, 480px" scale={0.85} />
        {c.momentsHref && (
          <Link href={c.momentsHref} className="absolute bottom-2.5 left-2.5 inline-flex min-h-9 items-center rounded-full bg-black/60 px-3.5 text-[13px] font-medium text-fg" data-been-moments>
            See our moments
          </Link>
        )}
      </div>
      <div className="px-4 pb-4 pt-3">
        <h3 className="break-words font-display text-[28px] font-semibold leading-tight tracking-tight">{c.title}</h3>
        {c.cities.length > 0 && <p className="mt-0.5 break-words text-[15px] text-fg/75">{c.cities.join(" · ")}</p>}
        {tripWords(c) && (
          <p className="mt-2 flex items-start gap-2 text-[15px] text-fg/75">
            <CalendarIcon size={18} className="mt-0.5 shrink-0" />
            <span className="min-w-0">{tripWords(c)}</span>
          </p>
        )}
        <div className="mt-3 flex items-center gap-2.5">
          <Faces initials={c.initials} />
          <span className="min-w-0 text-[15px] text-fg/75">{c.peopleLabel}</span>
        </div>
        {c.reliveHref && (
          <Link href={c.reliveHref} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-fg/25 text-[15px] font-semibold text-fg transition-transform active:scale-[0.97] active:bg-fg/10" data-been-relive>
            <PhotoIcon size={18} />
            Relive this trip
          </Link>
        )}
      </div>
    </article>
  );
}

// A trip, small: photo on the left, words on the right.
export function BeenCardSmall({ c }: { c: BeenCardData }) {
  return (
    <article className="grid grid-cols-[42%_1fr] overflow-hidden rounded-[20px] border border-line bg-white" data-been-card="small" data-group={c.groupId}>
      <Photo c={c} className="min-h-[148px]" sizes="200px" scale={0.52} />
      <div className="min-w-0 px-3.5 py-3">
        <h3 className="break-words font-display text-[22px] font-semibold leading-tight tracking-tight">{c.title}</h3>
        {tripWords(c) && (
          <p className="mt-1.5 flex items-start gap-2 text-[13px] text-fg/75">
            <CalendarIcon size={16} className="mt-px shrink-0" />
            <span className="min-w-0">{tripWords(c)}</span>
          </p>
        )}
        <p className="mt-1 flex items-start gap-2 text-[13px] text-fg/75">
          <PeopleIcon size={16} className="mt-px shrink-0" />
          <span className="min-w-0">{c.friendsLabel}</span>
        </p>
        {c.reliveHref && (
          <Link href={c.reliveHref} className="mt-1 inline-flex min-h-11 items-center text-[14px] font-semibold text-fg underline underline-offset-4" data-been-relive>
            Relive this trip
          </Link>
        )}
        {c.momentsHref && (
          <Link href={c.momentsHref} className="block min-h-9 text-[13px] text-fg/75 underline underline-offset-4" data-been-moments>
            See our moments
          </Link>
        )}
      </div>
    </article>
  );
}

// A country added by hand: no dates, no Relive. Its menu takes it back out of the passport.
export function BeenCardHand({ c }: { c: BeenCardData }) {
  return (
    <article className="grid grid-cols-[42%_1fr] overflow-hidden rounded-[20px] border border-line bg-white" data-been-card="hand" data-country={c.code}>
      <Photo c={c} className="min-h-[112px]" sizes="200px" scale={0.52} />
      <div className="relative min-w-0 px-3.5 py-3 pr-12">
        <h3 className="break-words font-display text-[22px] font-semibold leading-tight tracking-tight">{c.title}</h3>
        <p className="mt-1 text-[13px] text-fg/55">Been there</p>
        <details className="absolute right-1 top-1">
          <summary aria-label={`More for ${c.title}`} className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-full text-fg/75 active:bg-mist [&::-webkit-details-marker]:hidden">
            <DotsIcon size={20} />
          </summary>
          <form action={removePlaceAction} className="absolute right-0 z-10 mt-1 w-52 rounded-[14px] border border-line bg-canvas p-1 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.9)]">
            <input type="hidden" name="country" value={c.code} />
            <button type="submit" className="flex min-h-11 w-full items-center rounded-[10px] px-3 text-left text-[14px] text-fg active:bg-mist">
              Remove from passport
            </button>
          </form>
        </details>
      </div>
    </article>
  );
}

// Uneven ink for the stamps on the photos (the booklet defines the same filter for its own pages).
export function InkFilter() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id="lp-ink">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="0.9" />
      </filter>
    </svg>
  );
}
