"use client";

import { useEffect, useRef, useState } from "react";
import { wheelMove } from "@/lib/row-wheel";

// Sideways rows (chips, tools, group cards) on a computer: the mouse wheel moves them, and small arrow buttons appear while the pointer is
// over the row. Phones are untouched: a finger swipes as before, and the arrows never show on a screen without a mouse.
// Wrap the row and mark the scrolling element inside it with `data-row-scroller`. Nothing else about the row changes.
const FINE = "(hover: hover) and (pointer: fine)";

export function RowControls({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [can, setCan] = useState({ left: false, right: false });

  useEffect(() => {
    const box = wrap.current;
    const row = box?.querySelector<HTMLElement>("[data-row-scroller]");
    if (!box || !row) return;
    const fine = window.matchMedia?.(FINE);
    const measure = () => setCan({ left: row.scrollLeft > 4, right: row.scrollWidth - row.clientWidth - row.scrollLeft > 4 });
    const onWheel = (e: WheelEvent) => {
      if (!fine?.matches || e.ctrlKey) return;
      const to = wheelMove({ deltaX: e.deltaX, deltaY: e.deltaY, scrollLeft: row.scrollLeft, max: row.scrollWidth - row.clientWidth });
      if (to === null) return;
      e.preventDefault();
      row.scrollLeft = to;
    };
    measure();
    row.addEventListener("scroll", measure, { passive: true });
    row.addEventListener("wheel", onWheel, { passive: false });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(row);
    return () => {
      row.removeEventListener("scroll", measure);
      row.removeEventListener("wheel", onWheel);
      ro?.disconnect();
    };
  }, []);

  const move = (dir: -1 | 1) => {
    const row = wrap.current?.querySelector<HTMLElement>("[data-row-scroller]");
    if (row) row.scrollBy({ left: dir * Math.max(120, row.clientWidth * 0.8), behavior: "smooth" });
  };
  const arrow = (dir: -1 | 1) => (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={() => move(dir)}
      className={`row-arrow ${dir < 0 ? "row-arrow-left" : "row-arrow-right"}`}
      data-row-arrow={dir < 0 ? "left" : "right"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={dir < 0 ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
      </svg>
    </button>
  );

  return (
    <div ref={wrap} className={`row-controls relative ${className}`} data-row-controls>
      {children}
      {can.left && arrow(-1)}
      {can.right && arrow(1)}
    </div>
  );
}
