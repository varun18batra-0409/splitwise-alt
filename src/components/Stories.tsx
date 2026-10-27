"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "./Link";
import { GroupCover } from "./GroupCover";
import type { CoverChoice } from "@/lib/covers";
import type { Story } from "@/lib/home/stories";

// Home's stories, as little polaroids pegged on a string. A green peg means
// you haven't seen it yet. Tap one to open the stories full screen: tap the
// right side for the next, the left for the one before, swipe down (or Back)
// to close. Seen stories are remembered on this phone only.

const SEEN_KEY = "lp_seen_stories";
const DURATION = 6000;

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeSeen(s: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200)));
  } catch {
    /* private mode: fine, they just look new again */
  }
}

// Each kind's own backdrop when there's no photo.
const BACKDROP: Record<Story["kind"], string> = {
  trip: "[background:radial-gradient(120%_80%_at_80%_0%,#2b5d8a_0%,transparent_60%),linear-gradient(170deg,#14273a_0%,#0b1118_85%)]",
  pot: "[background:radial-gradient(90%_100%_at_100%_0%,#1f6b4a_0%,transparent_60%),linear-gradient(160deg,#123a2a_0%,#0b1612_80%)]",
  square: "[background:radial-gradient(100%_90%_at_20%_0%,#2f8a62_0%,transparent_60%),linear-gradient(170deg,#173a2b_0%,#0c1511_85%)]",
  collect: "[background:radial-gradient(100%_90%_at_90%_10%,#8a5a1f_0%,transparent_60%),linear-gradient(170deg,#3a2812_0%,#140f09_85%)]",
  memory: "[background:radial-gradient(100%_90%_at_10%_10%,#7a6a52_0%,transparent_60%),linear-gradient(170deg,#2e271d_0%,#110f0b_85%)]",
  wrapped: "[background:radial-gradient(100%_90%_at_80%_10%,#6b3a8a_0%,transparent_60%),linear-gradient(170deg,#2a1838_0%,#0f0a14_85%)]",
};

function Picture({ s, uid, big }: { s: Story; uid: string; big?: boolean }) {
  if (s.photo)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={s.photo} alt="" aria-hidden className={`absolute inset-0 h-full w-full object-cover ${big ? "lp-drift" : ""}`} loading={big ? "eager" : "lazy"} decoding="async" />;
  if (s.cover) return <GroupCover kind={s.cover.kind as CoverChoice} src={s.cover.src} uid={uid} sizes={big ? "448px" : "80px"} drift={big} />;
  return (
    <span aria-hidden className={`absolute inset-0 flex items-center justify-center ${BACKDROP[s.kind]} ${big ? "text-[96px]" : "text-[30px]"}`}>
      {s.emoji}
    </span>
  );
}

export function Stories({ stories }: { stories: Story[] }) {
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => setSeen(readSeen()), []);

  const markSeen = useCallback((id: string) => {
    setSeen((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      writeSeen(next);
      return next;
    });
  }, []);

  // Unseen first, in their order; then the seen ones.
  const ordered = [...stories.filter((s) => !seen.has(s.id)), ...stories.filter((s) => seen.has(s.id))];
  if (!stories.length) return null;

  const tilt = [-3, 2, -1.5, 2.5, -2, 1.5];
  return (
    <section aria-label="Stories" className="relative -mx-5 mb-6">
      {/* The string the photos hang on. */}
      <svg aria-hidden className="pointer-events-none absolute inset-x-0 top-[9px] h-6 w-full" preserveAspectRatio="none" viewBox="0 0 100 10">
        <path d="M0 1 Q 50 9 100 1" fill="none" stroke="currentColor" strokeWidth="0.35" className="text-fg/25" vectorEffect="non-scaling-stroke" />
      </svg>
      <ul className="flex gap-3.5 overflow-x-auto px-5 pb-2 pt-1 [scrollbar-width:none]" data-stories>
        {ordered.map((s, i) => {
          const isNew = !seen.has(s.id);
          return (
            <li key={s.id} className="shrink-0" data-story={s.kind} data-new={isNew ? "1" : "0"}>
              <button
                type="button"
                onClick={() => setOpen(stories.indexOf(s))}
                aria-label={`${s.headline}${isNew ? " (new)" : ""}`}
                className="relative block pt-2 transition-transform active:scale-95"
                style={{ transform: `rotate(${tilt[i % tilt.length]}deg)` }}
              >
                {/* The peg: green until you've seen it. */}
                <span aria-hidden className={`absolute left-1/2 top-0 z-10 h-4 w-2.5 -translate-x-1/2 rounded-[2px] ${isNew ? "bg-owed shadow-[0_0_10px_rgba(111,227,168,0.6)]" : "bg-fg/35"}`} />
                <span className={`block w-[72px] bg-[#f4f1e8] p-[4px] pb-0 shadow-[0_12px_22px_-10px_rgba(0,0,0,0.95)] ${isNew ? "" : "opacity-70"}`}>
                  <span className="relative block h-[64px] overflow-hidden bg-[#222]">
                    <Picture s={s} uid={`st-${s.id}`} />
                  </span>
                  <span className="block truncate px-0.5 pb-1 pt-0.5 text-center font-hand text-[15px] font-bold leading-tight text-[#2a2620]">{s.label}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {open !== null && <Viewer stories={stories} start={open} onSeen={markSeen} onClose={() => setOpen(null)} />}
    </section>
  );
}

function Viewer({ stories, start, onSeen, onClose }: { stories: Story[]; start: number; onSeen: (id: string) => void; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false); // the phone asks for less motion: no auto-advance
  const startY = useRef<number | null>(null);
  const s = stories[i];

  const closing = useRef(false);
  const close = useCallback(() => {
    if (closing.current) return; // a quick double tap on × must not go back twice
    closing.current = true;
    // Opened with a history step, so the phone's Back closes it too.
    if (history.state?.lpStory) history.back();
    else onClose();
  }, [onClose]);

  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    history.pushState({ ...(history.state ?? {}), lpStory: 1 }, "");
    const pop = () => onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, stories.length));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (i >= stories.length) close();
    else onSeen(stories[i].id);
  }, [i, stories, onSeen, close]);

  useEffect(() => {
    if (still || paused || i >= stories.length) return;
    const t = setTimeout(() => setI((x) => x + 1), DURATION);
    return () => clearTimeout(t);
  }, [i, paused, still, stories.length]);

  if (!s) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-black" role="dialog" aria-modal="true" aria-label="Stories">
      <div
        className="relative mx-auto h-full max-w-md overflow-hidden"
        onPointerDown={(e) => {
          startY.current = e.clientY;
          setPaused(true);
        }}
        onPointerUp={(e) => {
          setPaused(false);
          if (startY.current !== null && e.clientY - startY.current > 90) close();
          startY.current = null;
        }}
        onPointerCancel={() => setPaused(false)}
      >
        <Picture s={s} uid={`sv-${s.id}`} big />
        <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.55)_0%,transparent_22%,transparent_45%,rgba(0,0,0,0.88)_100%)]" />

        {/* Progress, one bar per story. */}
        <div className="absolute inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-20 flex gap-1" aria-hidden>
          {stories.map((x, k) => (
            <span key={x.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-[#f7f4ec]/30">
              <span
                key={`${k}-${i}`}
                className={`block h-full bg-[#f7f4ec] ${k < i ? "w-full" : k > i ? "w-0" : still ? "w-full" : "lp-story-bar"}`}
                style={k === i && !still ? { animationDuration: `${DURATION}ms`, animationPlayState: paused ? "paused" : "running" } : undefined}
              />
            </span>
          ))}
        </div>
        <button type="button" onClick={close} aria-label="Close" className="absolute right-3 top-[max(26px,calc(env(safe-area-inset-top)+14px))] z-30 flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-xl text-[#f7f4ec]">
          ×
        </button>

        {/* Tap the left third for back, the rest for next. */}
        <button type="button" aria-label="Previous" onClick={() => setI((x) => Math.max(x - 1, 0))} className="absolute inset-y-0 left-0 z-10 w-1/3" />
        <button type="button" aria-label="Next" onClick={() => setI((x) => x + 1)} className="absolute inset-y-0 right-0 z-10 w-2/3" />

        {/* The words don't catch taps (tap through them for next); only the button does. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-6 pb-[max(28px,env(safe-area-inset-bottom))]">
          <p className="font-display text-[34px] font-semibold leading-[1.05] text-[#f7f4ec]" data-story-headline>
            {s.headline}
          </p>
          <p className="mt-2 font-hand text-[24px] font-bold leading-tight text-[#ffd9a8]">{s.line}</p>
          <Link href={s.href} replace className="pop pointer-events-auto relative z-30 mt-6 block bg-[#f4f1e8] px-4 py-3.5 text-center text-base font-semibold text-[#14130f] [--pop-edge:#6e6b63]">
            {s.cta}
          </Link>
        </div>
      </div>
    </div>
  );
}
