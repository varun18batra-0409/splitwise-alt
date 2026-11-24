"use client";

import { Children, useEffect, useRef, useState } from "react";

function slideTo(el: HTMLElement | null, i: number) {
  // Lands exactly on the start of slide i; with animations turned off it jumps instead of gliding.
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (el) el.scrollTo({ left: i * el.clientWidth, behavior: still ? "auto" : "smooth" });
}

// The cards at the bottom of Home (weather for your next trip, your month, a bill due, a postcard, your passport, a festival), as a row
// you swipe through yourself, or tap a dot to jump to a card. They never move on their own and never jump back to the first card
// (founder, 22 Nov: "I should be able to scroll left right, not automatic").
export function HomeBanner({ children }: { children: React.ReactNode }) {
  const slides = Children.toArray(children);
  const n = slides.length;
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const slideEls = useRef<(HTMLDivElement | null)[]>([]);

  // The row is as tall as the card showing, not as the tallest card: a short card (your month at 320) isn't stretched into a tall empty one.
  // (Before the page wakes up, or with no script, every card still stretches to the tallest, as before.) The track hides vertical overflow, so an up/down swipe on a card always scrolls the page, never the card.
  useEffect(() => {
    const el = track.current;
    const slide = slideEls.current[at];
    if (!el || !slide) return;
    const fit = () => {
      el.style.height = `${slide.offsetHeight}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(slide);
    return () => ro.disconnect();
  }, [at, n]);

  const show = (i: number) => slideTo(track.current, i);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section aria-roledescription="carousel" aria-label="Highlights" className="relative">
      <div
        ref={track}
        className="flex snap-x snap-mandatory overflow-x-auto items-start overflow-y-hidden rounded-[24px] border border-line bg-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((s, i) => (
          <div key={i} ref={(node) => { slideEls.current[i] = node; }} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${n}`} className="relative flex w-full shrink-0 snap-start snap-always flex-col">
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
                onClick={() => show(i)}
                className="flex h-8 w-[26px] items-center justify-center"
              >
                <span className={`block h-1.5 rounded-full transition-all duration-300 ${i === at ? "w-[18px] bg-fg" : "w-1.5 bg-fg/35"}`} />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
