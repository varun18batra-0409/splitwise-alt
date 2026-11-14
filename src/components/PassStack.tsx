"use client";

import { Children, useRef, useState } from "react";

// Boarding passes (money you owe and money owed to you; the trips coming up): one on screen, the next peeks in at the edge. Swipe, use the arrow keys
// on the strip, or tap a dot. Scroll-snap does the work, so it never moves by itself; with animations turned off it jumps.
export function PassStack({ children, label, attrs }: { children: React.ReactNode; label: string; attrs?: Record<string, string | undefined> }) {
  const items = Children.toArray(children);
  const ref = useRef<HTMLUListElement>(null);
  const [at, setAt] = useState(0);
  const still = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const go = (i: number) => {
    const el = ref.current;
    const li = el?.children[i] as HTMLElement | undefined;
    if (el && li) el.scrollTo({ left: li.offsetLeft - el.offsetLeft - 20, behavior: still() ? "auto" : "smooth" });
  };
  return (
    <div role="region" aria-roledescription="carousel" aria-label={label} data-pass-stack {...attrs}>
      <ul
        ref={ref}
        tabIndex={0}
        aria-label={`${label}, swipe for the next`}
        onScroll={(e) => {
          const el = e.currentTarget;
          const x = el.scrollLeft;
          const closest = [...el.children].reduce((best, c, i) => (Math.abs((c as HTMLElement).offsetLeft - el.offsetLeft - 20 - x) < Math.abs((el.children[best] as HTMLElement).offsetLeft - el.offsetLeft - 20 - x) ? i : best), 0);
          setAt(closest);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && at < items.length - 1) {
            e.preventDefault();
            go(at + 1);
          } else if (e.key === "ArrowLeft" && at > 0) {
            e.preventDefault();
            go(at - 1);
          }
        }}
        className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-5 px-5 outline-none focus-visible:ring-1 focus-visible:ring-fg/30"
      >
        {items.map((c, i) => (
          <li key={i} role="group" aria-roledescription="slide" aria-label={`Pass ${i + 1} of ${items.length}`} className="w-full shrink-0 snap-start">
            {c}
          </li>
        ))}
      </ul>
      {items.length > 1 && (
      <div className="mt-1 flex justify-center" data-pass-dots>
        {items.map((_, i) => (
          <button key={i} type="button" onClick={() => go(i)} aria-label={`Show pass ${i + 1} of ${items.length}`} aria-current={i === at ? "true" : undefined} className="flex h-8 w-[26px] items-center justify-center">
            <span className={`block h-1.5 rounded-full transition-all motion-reduce:transition-none ${i === at ? "w-[18px] bg-fg" : "w-1.5 bg-fg/35"}`} />
          </button>
        ))}
      </div>
      )}
    </div>
  );
}
