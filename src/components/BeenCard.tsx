import Image from "next/image";
import Link from "@/components/Link";
import { StampMark } from "@/components/PassportBook";
import { CalendarIcon, DotsIcon, PeopleIcon, PhotoIcon } from "@/components/PassportIcons";
import { removePlaceAction } from "@/app/passport-actions";
import { photoSet, placePhotos, placeSlot } from "@/lib/places";
import { titleFit, type BeenCardData } from "@/lib/passport-cards";

// The cards of the passport's Been tab: a big one for the newest trip, small ones for the rest, and a
// quiet one for a country added by hand. Layout: photo with the place's stamp, then words. Server-drawn.

// A trip: the place's photo (or a mood photo when the place isn't known). A country added by hand: only
// a photo that is really that country; otherwise none (a plain card with the stamp), never a wrong one.
// Cards are about places: the photo of the place (from the trip's name, "Where to?", the stamp's country or its cities) comes before any
// mood picture, and a group's own people/cover photo is never used here. A hand-added place with no photo gets a designed panel.
function photoOf(c: BeenCardData): string | undefined {
  const slot = placeSlot(`${c.groupName} ${c.place}`) ?? placeSlot(c.title) ?? placeSlot(c.cities.join(" ")) ?? placeSlot(c.stamp.name);
  if (slot) {
    const own = photoSet(slot)[0];
    if (own) return own;
  }
  if (c.kind === "trip") return placePhotos(c.groupName, c.place, 1)[0];
  return undefined;
}

// The cream paper of the passport pages (the booklet's own look), for a card with no photo.
const PAPER_STYLE = {
  backgroundColor: "#efe8d6",
  backgroundImage:
    "radial-gradient(circle at 50% 120%, transparent 0 38%, rgba(43,76,126,0.06) 38.5% 39%, transparent 39.5% 45%, rgba(43,76,126,0.05) 45.5% 46%, transparent 46.5%), repeating-linear-gradient(115deg, rgba(38,35,29,0.035) 0 1px, transparent 1px 7px)",
} as const;

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
  if (!src)
    // No photo of this place: the large stamp, centred on the passport's cream paper (never an empty grey box).
    return (
      <div className={`relative overflow-hidden ${className}`} style={PAPER_STYLE} data-been-panel>
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 isolate" style={{ transform: `translate(-50%,-50%) scale(${scale * 1.05})` }}>
          <div className="relative h-[140px] w-[150px]">
            <StampMark s={c.stamp} i={0} at={{ left: "50%", top: "50%" }} />
          </div>
        </div>
      </div>
    );
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

// "5–10 May 2026 · 6 days": the "·" stays with the dates (never at the start of the next line), and "6 days" stays together.
function TripWords({ c }: { c: BeenCardData }) {
  const days = c.days ? `${c.days} ${c.days === 1 ? "day" : "days"}` : "";
  if (!c.dates && !days) return null;
  if (!c.dates) return <span className="whitespace-nowrap">{days}</span>;
  const cut = c.dates.lastIndexOf(" ");
  const head = cut > 0 ? c.dates.slice(0, cut + 1) : "";
  const tail = cut > 0 ? c.dates.slice(cut + 1) : c.dates;
  return (
    <>
      {head}
      <span className="whitespace-nowrap">
        {tail}
        {days ? " ·" : ""}
      </span>
      {days && " "}
      {days && <span className="whitespace-nowrap">{days}</span>}
    </>
  );
}
const hasWords = (c: BeenCardData) => Boolean(c.dates || c.days);

// A card's title: wraps only at spaces and "·", never inside a word; one very long word steps the type down for this card.
function Title({ text, max, className }: { text: string; max: number; className?: string }) {
  return (
    <div className="@container min-w-0">
      <h3 className={`font-display font-semibold leading-tight tracking-tight [overflow-wrap:normal] [word-break:normal] ${className ?? ""}`} style={{ fontSize: titleFit(text, max) }}>
        {text}
      </h3>
    </div>
  );
}

// The newest trip, big.
export function BeenCardBig({ c }: { c: BeenCardData }) {
  return (
    <article className="overflow-hidden rounded-[20px] border border-line bg-white" data-been-card="big" data-group={c.groupId}>
      <div className="relative">
        <Photo c={c} className="aspect-[5/2] w-full" sizes="(max-width: 480px) 100vw, 480px" scale={0.95} />
        {c.momentsHref && (
          <Link href={c.momentsHref} className="absolute bottom-2.5 left-2.5 inline-flex min-h-9 items-center rounded-full bg-black/60 px-3.5 text-[13px] font-medium text-fg" data-been-moments>
            See our moments
          </Link>
        )}
      </div>
      <div className="pb-4 pl-4 pr-6 pt-3">
        <Title text={c.title} max={28} />
        {c.cities.length > 0 && <p className="mt-0.5 text-[15px] text-fg/75">{c.cities.join(" · ")}</p>}
        {hasWords(c) && (
          <p className="mt-2 flex items-start gap-2 text-[15px] text-fg/75" data-been-dates>
            <CalendarIcon size={18} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <TripWords c={c} />
            </span>
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
      <Photo c={c} className="min-h-[148px]" sizes="200px" scale={0.72} />
      <div className="min-w-0 py-3 pl-3.5 pr-5">
        <Title text={c.title} max={22} />
        {hasWords(c) && (
          <p className="mt-1.5 flex items-start gap-2 text-[13px] text-fg/75" data-been-dates>
            <CalendarIcon size={16} className="mt-px shrink-0" />
            <span className="min-w-0">
              <TripWords c={c} />
            </span>
          </p>
        )}
        <p className="mt-1 flex items-start gap-2 text-[13px] text-fg/75">
          <PeopleIcon size={16} className="mt-px shrink-0" />
          <span className="min-w-0">{c.friendsLabel}</span>
        </p>
        {c.reliveHref && (
          <Link href={c.reliveHref} className="mt-3 inline-flex h-10 items-center justify-center rounded-full border border-fg/25 px-4 text-[14px] font-semibold text-fg active:scale-[0.97] active:bg-fg/10" data-been-relive>
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
      <Photo c={c} className="min-h-[112px]" sizes="200px" scale={0.72} />
      <div className="relative min-w-0 px-3.5 py-3 pr-12">
        <Title text={c.title} max={22} />
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
