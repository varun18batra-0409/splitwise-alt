"use client";

import { Children, useRef, useState } from "react";

// More than one trip on Home: one full card on screen, swipe for the next
// (soonest first). Dots underneath say how many there are and which one is showing.
export function TripRow({ children }: { children: React.ReactNode }) {
  const items = Children.toArray(children);
  const ref = useRef<HTMLUListElement>(null);
  const [at, setAt] = useState(0);
  const go = (i: number) => {
    const el = ref.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  return (
    <>
      <ul
        ref={ref}
        data-trip-row
        onScroll={(e) => {
          const el = e.currentTarget;
          setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="no-scrollbar -mx-5 -my-3 flex snap-x snap-mandatory overflow-x-auto py-3"
      >
        {items.map((c, i) => (
          <li key={i} className="w-full shrink-0 snap-center px-5" aria-label={`Trip ${i + 1} of ${items.length}`}>
            {c}
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex justify-center gap-1.5">
        {items.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => go(i)}
            aria-label={`Show trip ${i + 1}`}
            aria-current={i === at}
            className="flex h-6 items-center px-0.5"
          >
            <span className={`block h-1.5 rounded-full transition-all ${i === at ? "w-4 bg-fg/70" : "w-1.5 bg-fg/25"}`} />
          </button>
        ))}
      </div>
    </>
  );
}
