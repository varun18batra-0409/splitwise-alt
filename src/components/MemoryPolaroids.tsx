import Image from "next/image";
import Link from "@/components/Link";
import { groupMemoriesHref, hasMoreMemories, type HomeMemory } from "@/lib/home/memories";

// "Memories" on Home, right after the story circles (stories are the trips and nights; memories are the photos people added).
// One fixed layout, no expanding: the newest moment as one tilted polaroid (always the same size; a small stack sits behind it only when there
// are more), with its caption in handwriting, beside a quiet line and a swoosh. Tap the polaroid: that moment, big, with the reactions
// (Back comes home). Under it, "View <group> memories →" opens that group's Memories tab. "See all" (top right) opens the Memories page,
// and is shown only when there is more than this one memory. No moments to show: nothing renders at all (no heading, no empty state).
// The photos come from our own /api/ (private, cookie-checked), so they are shown as they are (the image service has no cookies).
// What may be listed was decided before it got here (canSeeMoment in src/lib/home/memories.ts); this only draws.

const INK = "#26231d"; // the pen, as in Polaroid.tsx
const FRAME = "block bg-[#f4f1e8] p-[5px] pb-0 shadow-[0_16px_30px_-12px_rgba(0,0,0,0.95),0_2px_6px_rgba(0,0,0,0.35)]";

export function MemoryPolaroids({ memories }: { memories: HomeMemory[] }) {
  if (memories.length === 0) return null;
  const first = memories[0]; // the newest first (pickMemories)
  return (
    <section className="mt-7" aria-labelledby="home-memories-h" data-memories-row>
      <div className="flex items-baseline justify-between">
        <h2 id="home-memories-h" className="font-display text-[20px] font-semibold tracking-tight">
          Memories
        </h2>
        {hasMoreMemories(memories.length) && (
          <Link href="/memories" className="flex min-h-11 items-center text-sm font-medium text-fg/85" data-memories-see-all>
            See all
          </Link>
        )}
      </div>
      <div className="flex items-center gap-4 pb-1 pt-1" data-memories-collapsed>
        {/* The front card's width never depends on how many memories there are: the ones behind are absolute and add no height. */}
        <div className="relative w-[46%] max-w-[200px] shrink-0 pb-1">
          {memories.slice(1, 3).map((m, i) => (
            <span
              key={m.id}
              aria-hidden
              data-memory-behind
              className={`absolute inset-x-0 top-0 block ${i === 0 ? "translate-x-2 rotate-[5deg]" : "-translate-x-1.5 translate-y-1 -rotate-[6deg]"} bg-[#f4f1e8] p-[5px] pb-0 shadow-[0_8px_16px_-8px_rgba(0,0,0,0.9)]`}
            >
              <span className="relative block aspect-[5/4] overflow-hidden bg-[#1c1b20]">
                <Image src={m.thumb} alt="" aria-hidden fill unoptimized sizes="30vw" className="object-cover" />
              </span>
              <span className="block h-11" />
            </span>
          ))}
          <Link
            href={first.href}
            aria-label={`${first.caption || "A moment"}, from ${first.groupName}`}
            className="lp-press relative z-10 block -rotate-[3deg] active:rotate-0 motion-reduce:rotate-0"
            data-memory={first.id}
            data-memory-lead
          >
            <span className={FRAME}>
              <span className="relative block aspect-[5/4] overflow-hidden bg-[#1c1b20]">
                <Image src={first.thumb} alt="" aria-hidden fill unoptimized sizes="45vw" className="object-cover" />
                <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.10),transparent_40%,rgba(0,0,0,0.12))]" />
              </span>
              <span className="block px-1 pb-1.5 pt-0.5 leading-none" style={{ color: INK }}>
                <span className="line-clamp-2 break-words font-hand text-[20px] font-bold leading-[1.1] [text-wrap:balance]" data-memory-caption>
                  {first.caption || "A moment"}
                </span>
                <span className="mt-0.5 block truncate text-[12px] font-semibold text-[#6d685e]" data-memory-group>
                  {first.groupName}
                </span>
              </span>
            </span>
          </Link>
        </div>
        <div className="min-w-0 flex-1" data-memories-line>
          <p className="text-[17px] leading-snug text-fg/80 [text-wrap:balance]">Little moments, shared together.</p>
          <svg aria-hidden width="64" height="12" viewBox="0 0 64 12" fill="none" className="mt-2 text-fg/45" data-swoosh>
            <path d="M2 9c10-5 24-7 38-6 8 .5 15 1.5 22 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
      </div>
      {/* Under the polaroid, the full width of the row so a longer group name still fits at 320px (it shortens with "…" rather than clip). */}
      <Link
        href={groupMemoriesHref(first.groupId)}
        className="flex min-h-11 max-w-full items-center text-[15px] font-medium text-fg/85 active:opacity-70"
        data-memories-group-link
      >
        <span className="min-w-0 truncate">View {first.groupName} memories →</span>
      </Link>
    </section>
  );
}
