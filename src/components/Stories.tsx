"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import Link from "./Link";
import { buzz } from "@/lib/haptics";
import { GroupCover } from "./GroupCover";
import { StoryArt } from "./StoryArt";
import { Backdrop, TONE } from "./Backdrop";
import type { CoverChoice } from "@/lib/covers";
import type { Frame, Story } from "@/lib/home/stories";
import { orderStories } from "@/lib/home/story-order";
import { storyShort } from "@/lib/home/display";

// Home's stories, as a row of circles under the header (like Instagram). A gold ring means you haven't seen it yet; seen ones have a faint ring. Tap one to open the stories full screen: tap the
// right side for the next, the left for the one before, hold to pause,
// swipe sideways to jump stories, swipe up for the story's button, swipe
// down (or Back) to close. Seen stories are remembered on this phone only.

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

// Full-screen story photos (UX-F5). A landscape picture cropped to a portrait screen is scaled to the screen's HEIGHT, so it is shown
// about twice as wide as the screen: ask the image service for twice the width (the old "100vw" gave a soft, blocky picture), at high quality.
export const STORY_SIZES = "(max-width: 448px) 220vw, 960px";
export const STORY_QUALITY = 90;
export const isOwnApi = (src: string) => src.startsWith("/api/");

function Picture({ s, uid, big }: { s: Story; uid: string; big?: boolean }) {
  // Sized for where it shows: a small copy for the polaroid, a sharp one full screen.
  // A photo from our own /api/ (a moment) is private: Next's image service has no cookies, so it must be shown as it is.
  if (s.photo) return <Image src={s.photo} alt="" aria-hidden fill unoptimized={isOwnApi(s.photo)} sizes={big ? STORY_SIZES : "80px"} quality={big ? STORY_QUALITY : 75} priority={big} className={`object-cover ${big ? "lp-drift" : ""}`} />;
  if (s.cover && !s.art) return <GroupCover kind={s.cover.kind as CoverChoice} src={s.cover.src} uid={uid} sizes={big ? "448px" : "80px"} drift={big} />;
  // No photo: designed artwork (green felt for a card night, a jar for a collection…).
  return <StoryArt kind={s.art ?? s.kind} uid={uid} />;
}

export function Stories({ stories, className = "mb-6" }: { stories: Story[]; className?: string }) {
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

  // Unseen first, most recent first; then the seen ones.
  const ordered = orderStories(stories, seen);
  if (!stories.length) return null;

  return (
    <section aria-label="Stories" className={`relative -mx-5 ${className}`}>
      <ul className="flex gap-3 overflow-x-auto px-5 pb-1 pt-1 [scrollbar-width:none]" data-stories>
        {ordered.map((s) => {
          const isNew = !seen.has(s.id);
          return (
            <li key={s.id} className="w-[84px] shrink-0" data-story={s.kind} data-new={isNew ? "1" : "0"}>
              <button
                type="button"
                onClick={() => setOpen(stories.indexOf(s))}
                aria-label={`${s.headline}${isNew ? " (new)" : ""}`}
                title={s.label}
                className="flex w-full flex-col items-center gap-1.5 text-center transition-opacity active:opacity-70 motion-reduce:transition-none"
              >
                <span aria-hidden className={`block h-[80px] w-[80px] rounded-full p-[2.5px] ${isNew ? "bg-[conic-gradient(#e8c46a,#e9b08a,#d99aa6,#e8c46a)]" : "bg-fg/25"}`}>
                  <span className="relative block h-full w-full overflow-hidden rounded-full border-[3px] border-canvas bg-mist">
                    <Picture s={s} uid={`st-${s.id}`} />
                  </span>
                </span>
                <span className={`block w-full truncate text-[13px] leading-tight ${isNew ? "text-fg" : "text-fg/70"}`} data-story-label>
                  {storyShort(s.short ?? s.label)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {/* On top of everything (the page's cards and the bottom bar), whatever the strip sits inside. */}
      {open !== null && createPortal(<Viewer stories={stories} start={open} onSeen={markSeen} onClose={() => setOpen(null)} />, document.body)}
    </section>
  );
}

// The small label above a slide's words ("Day 2 of 5"): plain sentence-case type, no tape or handwriting.
function Sticker({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-[14px] font-medium leading-tight text-[#f4f2ec]/75">{children}</p>;
}

function Words({ kicker, head, line, calm }: { kicker?: string; head: string; line?: string; calm?: boolean }) {
  return (
    <div className="lp-slide-in pointer-events-none absolute inset-x-0 bottom-[132px] z-20 px-6 text-[#f7f4ec]">
      {kicker && <Sticker>{kicker}</Sticker>}
      <p className={`break-words font-display font-semibold tracking-[-0.02em] ${calm ? "text-[clamp(24px,7vw,28px)] leading-[1.15]" : "text-[clamp(28px,8.5vw,36px)] leading-[1.1]"}`} data-story-headline>
        {head}
      </p>
      {line && <p className="mt-2 text-[17px] leading-snug text-[#f4f2ec]/85">{line}</p>}
    </div>
  );
}

// Money colours only go on a row whose value is an amount (it has a digit): "Checked" and "Not yet" stay neutral.
const money = (r: { value?: string }) => /\d/.test(r.value ?? "");

function Slide({ f, uid, story }: { f: Frame; uid: string; story: Story }) {
  // Never an empty slide: a poster with nothing to say, or a list with no rows, shows the group's own picture instead.
  const empty = (f.kind === "poster" && !f.big.trim()) || (f.kind === "list" && f.rows.length === 0);
  if (empty)
    return (
      <>
        <Picture s={story} uid={`${uid}-fb`} big />
        <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.5)_0%,transparent_22%,transparent_42%,rgba(0,0,0,0.9)_100%)]" />
        <Words kicker={f.kicker} head={story.label} line={f.line ?? story.line} />
      </>
    );
  if (f.kind === "photo" || f.kind === "art")
    return (
      <>
        {f.kind === "photo" ? <Image src={f.photo} alt="" aria-hidden fill unoptimized={isOwnApi(f.photo)} sizes={STORY_SIZES} quality={STORY_QUALITY} priority className="lp-drift object-cover" /> : <StoryArt kind={f.art} uid={uid} />}
        <span aria-hidden className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.5)_0%,transparent_22%,transparent_42%,rgba(0,0,0,0.9)_100%)]" />
        <Words kicker={f.kicker} head={f.head} line={f.line} calm={f.kind === "photo" ? f.calm : undefined} />
      </>
    );
  const accent = TONE[f.tone];
  if (f.kind === "poster")
    return (
      <div className="absolute inset-0 text-[#f7f4ec]">
        <Backdrop accent={accent} />
        <div className="lp-slide-in pointer-events-none relative flex h-full flex-col justify-center px-7 pb-[140px] pt-24">
          <Sticker>{f.kicker}</Sticker>
          <p className="mt-1 break-words font-display font-semibold leading-[0.95] tracking-[-0.02em]" style={{ fontSize: `min(84px, ${Math.floor(170 / Math.max(5, f.big.length))}vw)` }} data-story-headline>
            {f.big}
          </p>
                    {f.line && <p className="mt-4 text-[17px] leading-snug text-[#f4f2ec]/85">{f.line}</p>}
        </div>
      </div>
    );
  return (
    <div className="absolute inset-0 text-[#f7f4ec]">
      <Backdrop accent={accent} />
      <div className="lp-slide-in pointer-events-none relative flex h-full flex-col justify-center px-7 pb-[140px] pt-24">
        <p className="font-display text-[28px] font-semibold leading-none tracking-[-0.02em]" data-story-headline>
          {f.kicker}
        </p>
        <ul className="mt-5 space-y-2.5">
          {f.rows.map((r, k) => (
            <li key={k} className="lp-card rounded-[16px] border border-[#f7f4ec]/10 bg-[#f7f4ec]/[0.06] px-4 py-3 backdrop-blur-sm" style={{ animationDelay: `${k * 60}ms` }}>
              <p className="flex items-baseline gap-3 text-[17px]">
                <span className="min-w-0 flex-1 truncate font-semibold">{r.label}</span>
                {r.value && <span className={`shrink-0 font-semibold tabular-nums ${money(r) && r.good ? "text-[#6fe3a8]" : money(r) && r.bad ? "text-[#f2a07b]" : "text-[#f7f4ec]/80"}`}>{r.value}</span>}
              </p>
              {r.share !== undefined && (
                <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[#f7f4ec]/10">
                  <span className="block h-full rounded-full" style={{ width: `${Math.max(4, r.share * 100)}%`, background: money(r) && r.good ? "#6fe3a8" : money(r) && r.bad ? "#f2a07b" : accent }} />
                </span>
              )}
            </li>
          ))}
        </ul>
        {f.line && <p className="mt-4 text-[17px] leading-snug text-[#f4f2ec]/85">{f.line}</p>}
      </div>
    </div>
  );
}

function Viewer({ stories, start, onSeen, onClose }: { stories: Story[]; start: number; onSeen: (id: string) => void; onClose: () => void }) {
  const [at, setAt] = useState({ s: start, f: 0 });
  const [paused, setPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false); // the Pause / Play button
  const [tabHidden, setTabHidden] = useState(false); // another tab or app is on top: don't run the clock
  const [still, setStill] = useState(false); // the phone asks for less motion: no auto-advance
  // Gestures: hold to pause, drag down to close, swipe sideways for the next or previous story,
  // swipe up to do the story's one thing. A hold or a swipe never also counts as a tap.
  const drag = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notATap = useRef(false);
  const cta = useRef<HTMLAnchorElement>(null);
  const [dy, setDy] = useState(0);
  const stopped = paused || userPaused || tabHidden;
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
  const tap = (go: () => void) => () => {
    if (notATap.current) {
      notATap.current = false;
      return;
    }
    go();
  };
  const letGo = (e: PointerEvent<HTMLDivElement> | null) => {
    clearTimeout(holdTimer.current);
    const d = drag.current;
    drag.current = null;
    setPaused(false);
    setDy(0);
    if (!d || !e) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (d.moved || Date.now() - d.t > 260) notATap.current = true;
    if (!d.moved) return;
    const down = my > 0 && Math.abs(my) > Math.abs(mx);
    const up = my < 0 && Math.abs(my) > Math.abs(mx);
    if (down && my > 110) close();
    else if (up && my < -90) {
      buzz("tap");
      cta.current?.click();
    } else if (Math.abs(mx) > 70 && Math.abs(mx) > Math.abs(my)) {
      buzz("tap");
      if (mx < 0) setAt((x) => ({ s: x.s + 1, f: 0 }));
      else setAt((x) => ({ s: Math.max(0, x.s - 1), f: 0 }));
    }
  };

  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    history.pushState({ ...(history.state ?? {}), lpStory: 1 }, "");
    const pop = () => onClose();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    const vis = () => setTabHidden(document.visibilityState === "hidden");
    vis();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", key);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("visibilitychange", vis);
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
    if (still || stopped || at.s >= stories.length) return;
    const t = setTimeout(next, DURATION);
    return () => clearTimeout(t);
  }, [at, stopped, still, stories.length, next]);

  if (!story) return null;
  const f = frames[Math.min(at.f, frames.length - 1)];
  // Every slide is dark now (photos, artwork, posters), so the controls are always light.
  const ink = "#f7f4ec";
  return (
    <div className="fixed inset-0 z-[60]" style={{ background: `rgba(0,0,0,${dy ? Math.max(0.35, 1 - dy / 500) : 1})` }} role="dialog" aria-modal="true" aria-label={`Story: ${story.headline}`}>
      <div
        className="relative mx-auto h-full max-w-md touch-none overflow-hidden"
        data-story-viewer
        style={
          dy
            ? { transform: `translateY(${dy * 0.85}px) scale(${1 - Math.min(dy, 400) / 1800})`, borderRadius: 24, transition: "none" }
            : { transition: "transform 240ms cubic-bezier(.2,.9,.25,1), border-radius 240ms" }
        }
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
          clearTimeout(holdTimer.current);
          holdTimer.current = setTimeout(() => setPaused(true), 180);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const mx = e.clientX - d.x;
          const my = e.clientY - d.y;
          if (!d.moved && Math.hypot(mx, my) > 10) {
            d.moved = true;
            clearTimeout(holdTimer.current);
            setPaused(true);
          }
          if (d.moved && my > 0 && my > Math.abs(mx)) setDy(my);
          else if (dy) setDy(0);
        }}
        onPointerUp={letGo}
        onPointerCancel={() => letGo(null)}
      >
        {f ? <Slide key={`${at.s}-${at.f}`} f={f} uid={`sl-${story.id}-${at.f}`} story={story} /> : <Picture s={story} uid={`sv-${story.id}`} big />}

        {/* Progress: one bar per slide of this story. */}
        <div className="absolute inset-x-3 top-[max(12px,env(safe-area-inset-top))] z-20 flex gap-1" aria-hidden>
          {frames.map((_, k) => (
            <span key={k} className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ background: `${ink}40` }}>
              <span
                key={`${at.s}-${at.f}-${k}`}
                className={`block h-full ${k < at.f ? "w-full" : k > at.f ? "w-0" : still ? "w-full" : "lp-story-bar"}`}
                style={{ background: ink, ...(k === at.f && !still ? { animationDuration: `${DURATION}ms`, animationPlayState: stopped ? "paused" : "running" } : {}) }}
              />
            </span>
          ))}
        </div>
        {/* Whose story: the little picture and its name. */}
        <div className="pointer-events-none absolute left-4 top-[max(26px,calc(env(safe-area-inset-top)+14px))] z-20 flex max-w-[calc(100%-8.5rem)] items-center gap-2.5" style={{ color: ink }}>
          <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-full border-2" style={{ borderColor: ink }}>
            <Picture s={story} uid={`sva-${story.id}`} />
          </span>
          <span className="truncate text-sm font-semibold">{story.label}</span>
        </div>
        <button type="button" onClick={close} aria-label="Close" className="glass absolute right-3 top-[max(22px,calc(env(safe-area-inset-top)+10px))] z-30 flex h-11 w-11 items-center justify-center rounded-full" style={{ color: ink }}>
          <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => setUserPaused((p) => !p)}
          aria-label={userPaused ? "Play" : "Pause"}
          aria-pressed={userPaused}
          className="glass absolute right-[4.25rem] top-[max(22px,calc(env(safe-area-inset-top)+10px))] z-30 flex h-11 w-11 items-center justify-center rounded-full"
          style={{ color: ink }}
          data-story-pause
        >
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            {userPaused ? <path d="M8 5.5v13l11-6.5z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
          </svg>
        </button>

        {/* Tap the left third for back, the rest for next. */}
        <button type="button" aria-label="Previous" onClick={tap(prev)} className="absolute inset-y-0 left-0 z-10 w-1/3" />
        <button type="button" aria-label="Next" onClick={tap(next)} className="absolute inset-y-0 right-0 z-10 w-2/3" />

        {/* One thing to do next, on every slide. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-6 pb-[max(28px,env(safe-area-inset-bottom))]">
          <Link ref={cta} href={story.href} replace className="pop pointer-events-auto relative block px-4 py-4 text-center text-base font-semibold" style={{ background: "#f4f2ec", color: "#0d0d0f" }}>
            {story.cta}
          </Link>
          <p className="mt-2 text-center text-[11px]" style={{ color: `${ink}99` }}>
            Hold to pause. Swipe up to open, down to close.
          </p>
        </div>
      </div>
    </div>
  );
}
