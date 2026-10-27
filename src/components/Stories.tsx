"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "./Link";
import { GroupCover } from "./GroupCover";
import { StoryArt } from "./StoryArt";
import { Backdrop, TONE } from "./Backdrop";
import type { CoverChoice } from "@/lib/covers";
import type { Frame, Story } from "@/lib/home/stories";

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

function Picture({ s, uid, big }: { s: Story; uid: string; big?: boolean }) {
  // Sized for where it shows: a small copy for the polaroid, a sharp one full screen.
  if (s.photo) return <Image src={s.photo} alt="" aria-hidden fill sizes={big ? "(max-width: 448px) 100vw, 448px" : "96px"} quality={big ? 82 : 70} priority={big} className={`object-cover ${big ? "lp-drift" : ""}`} />;
  if (s.cover && !s.art) return <GroupCover kind={s.cover.kind as CoverChoice} src={s.cover.src} uid={uid} sizes={big ? "448px" : "80px"} drift={big} />;
  // No photo: designed artwork (green felt for a card night, a jar for a collection…).
  return <StoryArt kind={s.art ?? s.kind} uid={uid} />;
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

function Words({ kicker, head, line }: { kicker?: string; head: string; line?: string }) {
  return (
    <div className="lp-slide-in pointer-events-none absolute inset-x-0 bottom-[132px] z-20 px-6 text-[#f7f4ec]">
      {kicker && <p className="mb-2 inline-block rounded-full bg-[#f7f4ec]/15 px-3 py-1 text-[13px] font-semibold backdrop-blur-sm">{kicker}</p>}
      <p className="font-display text-[clamp(30px,9vw,40px)] font-semibold leading-[1.04]" data-story-headline>
        {head}
      </p>
      {line && <p className="mt-2 font-hand text-[24px] font-bold leading-tight text-[#ffd9a8]">{line}</p>}
    </div>
  );
}

function Slide({ f, uid }: { f: Frame; uid: string }) {
  if (f.kind === "photo" || f.kind === "art")
    return (
      <>
        {f.kind === "photo" ? <Image src={f.photo} alt="" aria-hidden fill sizes="(max-width: 448px) 100vw, 448px" quality={82} priority className="lp-drift object-cover" /> : <StoryArt kind={f.art} uid={uid} />}
        <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.5)_0%,transparent_22%,transparent_42%,rgba(0,0,0,0.9)_100%)]" />
        <Words kicker={f.kicker} head={f.head} line={f.line} />
      </>
    );
  const accent = TONE[f.tone];
  if (f.kind === "poster")
    return (
      <div className="absolute inset-0 text-[#f7f4ec]">
        <Backdrop accent={accent} />
        <div className="lp-slide-in pointer-events-none relative flex h-full flex-col justify-center px-7 pb-[140px] pt-24">
          <p className="text-[13px] font-semibold uppercase tracking-[0.22em]" style={{ color: accent }}>
            {f.kicker}
          </p>
          <p className="mt-4 break-words font-display font-semibold leading-[0.95] tracking-[-0.02em]" style={{ fontSize: `min(84px, ${Math.floor(170 / Math.max(5, f.big.length))}vw)` }} data-story-headline>
            {f.big}
          </p>
          <span aria-hidden className="mt-5 block h-[3px] w-14 rounded-full" style={{ background: accent }} />
          {f.line && <p className="mt-4 font-hand text-[26px] font-bold leading-tight text-[#f7f4ec]/85">{f.line}</p>}
        </div>
      </div>
    );
  return (
    <div className="absolute inset-0 text-[#f7f4ec]">
      <Backdrop accent={accent} />
      <div className="lp-slide-in pointer-events-none relative flex h-full flex-col justify-center px-7 pb-[140px] pt-24">
        <p className="text-[13px] font-semibold uppercase tracking-[0.22em]" style={{ color: accent }} data-story-headline>
          {f.kicker}
        </p>
        <ul className="mt-5 space-y-2.5">
          {f.rows.map((r, k) => (
            <li key={k} className="lp-card rounded-[16px] border border-[#f7f4ec]/10 bg-[#f7f4ec]/[0.06] px-4 py-3 backdrop-blur-sm" style={{ animationDelay: `${k * 60}ms` }}>
              <p className="flex items-baseline gap-3 text-[17px]">
                <span className="min-w-0 flex-1 truncate font-semibold">{r.label}</span>
                {r.value && <span className={`shrink-0 font-semibold tabular-nums ${r.good ? "text-[#6fe3a8]" : r.bad ? "text-[#f2a07b]" : "text-[#f7f4ec]/80"}`}>{r.value}</span>}
              </p>
              {r.share !== undefined && (
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[#f7f4ec]/10">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(4, r.share * 100)}%`, background: r.good ? "#6fe3a8" : r.bad ? "#f2a07b" : accent }} />
                </span>
              )}
            </li>
          ))}
        </ul>
        {f.line && <p className="mt-4 font-hand text-[24px] font-bold leading-tight text-[#f7f4ec]/85">{f.line}</p>}
      </div>
    </div>
  );
}

function Viewer({ stories, start, onSeen, onClose }: { stories: Story[]; start: number; onSeen: (id: string) => void; onClose: () => void }) {
  const [at, setAt] = useState({ s: start, f: 0 });
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false); // the phone asks for less motion: no auto-advance
  const startY = useRef<number | null>(null);
  const story = stories[at.s];
  const frames = story?.frames.length ? story.frames : [];

  const closing = useRef(false);
  const close = useCallback(() => {
    if (closing.current) return; // a quick double tap on × must not go back twice
    closing.current = true;
    // Opened with a history step, so the phone's Back closes it too.
    if (history.state?.lpStory) history.back();
    else onClose();
  }, [onClose]);

  // Next slide; after the last slide, the next story; after the last story, close.
  const next = useCallback(
    () =>
      setAt((x) => {
        const n = stories[x.s]?.frames.length ?? 1;
        return x.f + 1 < n ? { s: x.s, f: x.f + 1 } : { s: x.s + 1, f: 0 };
      }),
    [stories],
  );
  const prev = useCallback(() => setAt((x) => (x.f > 0 ? { s: x.s, f: x.f - 1 } : x.s > 0 ? { s: x.s - 1, f: 0 } : x)), []);

  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    history.pushState({ ...(history.state ?? {}), lpStory: 1 }, "");
    const pop = () => onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", key);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (at.s >= stories.length) close();
    else onSeen(stories[at.s].id);
  }, [at.s, stories, onSeen, close]);

  useEffect(() => {
    if (still || paused || at.s >= stories.length) return;
    const t = setTimeout(next, DURATION);
    return () => clearTimeout(t);
  }, [at, paused, still, stories.length, next]);

  if (!story) return null;
  const f = frames[Math.min(at.f, frames.length - 1)];
  // Every slide is dark now (photos, artwork, posters), so the controls are always light.
  const ink = "#f7f4ec";
  return (
    <div className="fixed inset-0 z-[60] bg-black" role="dialog" aria-modal="true" aria-label={`Story: ${story.headline}`}>
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
        {f ? <Slide key={`${at.s}-${at.f}`} f={f} uid={`sl-${story.id}-${at.f}`} /> : <Picture s={story} uid={`sv-${story.id}`} big />}

        {/* Progress: one bar per slide of this story. */}
        <div className="absolute inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-20 flex gap-1" aria-hidden>
          {frames.map((_, k) => (
            <span key={k} className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: `${ink}40` }}>
              <span
                key={`${at.s}-${at.f}-${k}`}
                className={`block h-full ${k < at.f ? "w-full" : k > at.f ? "w-0" : still ? "w-full" : "lp-story-bar"}`}
                style={{ background: ink, ...(k === at.f && !still ? { animationDuration: `${DURATION}ms`, animationPlayState: paused ? "paused" : "running" } : {}) }}
              />
            </span>
          ))}
        </div>
        {/* Whose story: the little picture and its name. */}
        <div className="pointer-events-none absolute left-4 top-[max(26px,calc(env(safe-area-inset-top)+14px))] z-20 flex items-center gap-2.5" style={{ color: ink }}>
          <span className="relative block h-8 w-8 overflow-hidden rounded-full border-2" style={{ borderColor: ink }}>
            <Picture s={story} uid={`sva-${story.id}`} />
          </span>
          <span className="text-sm font-semibold">{story.label}</span>
        </div>
        <button type="button" onClick={close} aria-label="Close" className="absolute right-3 top-[max(22px,calc(env(safe-area-inset-top)+10px))] z-30 flex h-10 w-10 items-center justify-center rounded-full text-xl" style={{ color: ink, background: "rgba(0,0,0,0.35)" }}>
          ×
        </button>

        {/* Tap the left third for back, the rest for next. */}
        <button type="button" aria-label="Previous" onClick={prev} className="absolute inset-y-0 left-0 z-10 w-1/3" />
        <button type="button" aria-label="Next" onClick={next} className="absolute inset-y-0 right-0 z-10 w-2/3" />

        {/* One thing to do next, on every slide. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-[max(28px,env(safe-area-inset-bottom))]">
          <Link href={story.href} replace className="pop pointer-events-auto relative block px-4 py-3.5 text-center text-base font-semibold [--pop-edge:#6e6b63]" style={{ background: "#f4f1e8", color: "#14130f" }}>
            {story.cta}
          </Link>
          <p className="mt-2 text-center text-[11px]" style={{ color: `${ink}99` }}>
            Tap for more · swipe down to close
          </p>
        </div>
      </div>
    </div>
  );
}
