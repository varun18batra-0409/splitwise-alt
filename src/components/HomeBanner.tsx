"use client";

import { Children, useEffect, useRef, useState } from "react";

function slideTo(el: HTMLElement | null, i: number) {
  if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
}

// The cards at the top of Home that slide by on their own (like a photo
// carousel): swipe them, tap a dot, or pause. They stop moving while you touch
// them, while the app is in the background, and for anyone who has turned off
// animations on their phone.
export function HomeBanner({ children, seconds = 5 }: { children: React.ReactNode; seconds?: number }) {
  const slides = Children.toArray(children);
  const n = slides.length;
  const track = useRef<HTMLDivElement>(null);
  const touched = useRef(0);
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);

  const show = (i: number) => slideTo(track.current, i);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (paused || n < 2) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => {
      const el = track.current;
      if (!el || document.hidden || Date.now() - touched.current < 8000) return;
      slideTo(el, (Math.round(el.scrollLeft / Math.max(1, el.clientWidth)) + 1) % n);
    }, seconds * 1000);
    return () => window.clearInterval(t);
  }, [paused, n, seconds]);

  const hold = () => {
    touched.current = Date.now();
  };

  return (
    <section aria-roledescription="carousel" aria-label="Highlights" className="relative">
      <div
        ref={track}
        onPointerDown={hold}
        onTouchStart={hold}
        onFocus={hold}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-[24px] border border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((s, i) => (
          <div key={i} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${n}`} className="relative w-full shrink-0 snap-start">
            {s}
          </div>
        ))}
      </div>
      {n > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-1 flex h-10 items-center justify-center">
          <div className="pointer-events-auto flex items-center">
            {slides.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Show ${i + 1} of ${n}`}
                aria-current={i === at ? "true" : undefined}
                onClick={() => {
                  hold();
                  show(i);
                }}
                className="flex h-8 w-[22px] items-center justify-center"
              >
                <span className={`block h-1.5 rounded-full transition-all duration-300 ${i === at ? "w-[18px] bg-fg" : "w-1.5 bg-fg/35"}`} />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Play the highlights" : "Pause the highlights"}
            className="pointer-events-auto absolute right-2 flex h-10 w-10 items-center justify-center text-fg/70"
          >
            {paused ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M7 5l12 7-12 7z" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            )}
          </button>
        </div>
      )}
    </section>
  );
}
