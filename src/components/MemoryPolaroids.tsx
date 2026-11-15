"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "@/components/Link";
import type { HomeMemory } from "@/lib/home/memories";

// "Memories" on Home, right after the story circles (stories are the trips and nights; memories are the photos people added, shown ONLY here).
// Collapsed: the newest moment as one tilted polaroid (a small stack when there are more) beside a quiet line, and a "See all" control.
// Expanded (in place, no new page): a two-column grid of larger square polaroids, each with its caption in handwriting and its group's
// name. Tap one: that moment, big, with the reactions; Back comes home. No moments to show: nothing renders at all (no heading, no empty state).
// The photos come from our own /api/ (private, cookie-checked), so they are shown as they are (the image service has no cookies).
// What may be listed was decided before it got here (canSeeMoment in src/lib/home/memories.ts); this only draws.

const INK = "#26231d"; // the pen, as in Polaroid.tsx
const tilt = ["-rotate-[2deg]", "rotate-[1.5deg]"];
const BIG_FRAME = "block bg-[#f4f1e8] p-[5px] pb-0 shadow-[0_16px_30px_-12px_rgba(0,0,0,0.95),0_2px_6px_rgba(0,0,0,0.35)]";

export function MemoryPolaroids({ memories }: { memories: HomeMemory[] }) {
  const [all, setAll] = useState(false);
  if (memories.length === 0) return null;
  const first = memories[0]; // the newest first (pickMemories)
  return (
    <section className="mt-7" aria-labelledby="home-memories-h" data-memories-row data-memories-open={all ? "1" : "0"}>
      <div className="flex items-baseline justify-between">
        <h2 id="home-memories-h" className="font-display text-[20px] font-semibold tracking-tight">
          Memories
        </h2>
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          aria-controls="home-memories-list"
          className="flex min-h-11 items-center text-sm font-medium text-fg/85"
          data-memories-toggle
        >
          {all ? "Show less" : "See all"}
        </button>
      </div>
      {all ? (
        <ul id="home-memories-list" aria-label="Memories" className="-mt-1 grid grid-cols-2 gap-x-4 gap-y-5 px-1 pb-4 pt-2" data-memories-grid>
          {memories.map((m, i) => (
            <li key={m.id} className="min-w-0">
              <Link
                href={m.href}
                aria-label={`${m.caption || "A moment"}, from ${m.groupName}`}
                className={`lp-press block min-h-11 ${tilt[i % 2]} active:rotate-0 motion-reduce:rotate-0`}
                data-memory={m.id}
              >
                <span className={BIG_FRAME}>
                  <span className="relative block aspect-square overflow-hidden bg-[#1c1b20]">
                    <Image src={m.thumb} alt="" aria-hidden fill unoptimized sizes="50vw" className="object-cover" />
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
      ) : (
        // Collapsed (the 15 Nov mockup): the newest moment as one tilted polaroid (a small stack when there are more), and a quiet line
        // with a hand-drawn swoosh. Tap the polaroid: that moment. "See all" opens the grid.
        <div id="home-memories-list" className="flex items-center gap-4 pb-2 pt-1" data-memories-collapsed>
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
              <span className={BIG_FRAME}>
                <span className="relative block aspect-[5/4] overflow-hidden bg-[#1c1b20]">
                  <Image src={first.thumb} alt="" aria-hidden fill unoptimized sizes="45vw" className="object-cover" />
                  <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(160deg,rgba(255,255,255,0.10),transparent_40%,rgba(0,0,0,0.12))]" />
                </span>
                <span className="block px-1 pb-1.5 pt-0.5 leading-none" style={{ color: INK }}>
                  <span className="block truncate font-hand text-[20px] font-bold leading-[1.1]" data-memory-caption>
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
      )}
    </section>
  );
}
