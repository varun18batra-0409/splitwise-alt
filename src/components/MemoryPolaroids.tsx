import Image from "next/image";
import Link from "@/components/Link";
import { INK } from "@/components/Polaroid";
import type { HomeMemory } from "@/lib/home/memories";

// "Memories" on Home, under the story circles: a row of SQUARE polaroids of the newest moments you may see, across your groups.
// White frame, the moment's photo, its caption in handwriting (one line), and the group's name small. They lean a little, alternately
// (like the group polaroids; flat for people who ask for less motion), and slide sideways with snapping. Tap one: that moment, big,
// with the reactions; Back comes home. No moments to show: nothing renders at all (no heading, no empty state).
// The photos come from our own /api/ (private, cookie-checked), so they are shown as they are (the image service has no cookies).

const tilt = ["-rotate-[2deg]", "rotate-[1.5deg]"];

export function MemoryPolaroids({ memories }: { memories: HomeMemory[] }) {
  if (memories.length === 0) return null;
  return (
    <section className="mb-1 mt-5" aria-labelledby="home-memories-h" data-memories-row>
      <h2 id="home-memories-h" className="font-display text-[20px] font-semibold tracking-tight">
        Memories
      </h2>
      <ul aria-label="Memories" className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-5 pt-4 [scrollbar-width:none]">
        {memories.map((m, i) => (
          <li key={m.id} className="w-[132px] shrink-0 snap-start">
            <Link
              href={m.href}
              aria-label={`${m.caption || "A moment"}, from ${m.groupName}`}
              className={`lp-press block min-h-11 ${tilt[i % 2]} active:rotate-0 motion-reduce:rotate-0`}
              data-memory={m.id}
            >
              <span className="block bg-[#f4f1e8] p-[5px] pb-0 shadow-[0_16px_30px_-12px_rgba(0,0,0,0.95),0_2px_6px_rgba(0,0,0,0.35)]">
                <span className="relative block aspect-square overflow-hidden bg-[#1c1b20]">
                  <Image src={m.thumb} alt="" aria-hidden fill unoptimized sizes="132px" className="object-cover" />
                  {/* a little film sheen, like the group polaroids */}
                  <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.10),transparent_40%,rgba(0,0,0,0.12))]" />
                </span>
                <span className="block px-1 pb-1.5 pt-0.5 leading-none" style={{ color: INK }}>
                  <span className="block truncate font-hand text-[20px] font-bold leading-[1.1]" data-memory-caption>
                    {m.caption || "A moment"}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] font-semibold text-[#6d685e]" data-memory-group>
                    {m.groupName}
                  </span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
