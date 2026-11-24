"use client";

import { useEffect, useRef, useState } from "react";
import { wheelMove } from "@/lib/row-wheel";

// Sideways rows (chips, tools, group cards) on a computer: the mouse wheel moves them, and small arrow buttons appear while the pointer is
// over the row. Phones are untouched: a finger swipes as before, and the arrows never show on a screen without a mouse.
// Wrap the row and mark the scrolling element inside it with `data-row-scroller`. Nothing else about the row changes.
const FINE = "(hover: hover) and (pointer: fine)";

// The behaviour, shared: the wheel moves the row and arrows appear while the pointer is over the box. `getBox` returns the element that
// holds the scrolling row (marked `data-row-scroller`) and, for the arrows, is `position: relative` with the `row-controls` class.
function useRowControls(getBox: () => HTMLElement | null) {
  const [can, setCan] = useState({ left: false, right: false });

  useEffect(() => {
    const box = getBox();
    const row = box?.querySelector<HTMLElement>("[data-row-scroller]");
    if (!box || !row) return;
    const fine = window.matchMedia?.(FINE);
    const measure = () => setCan({ left: row.scrollLeft > 4, right: row.scrollWidth - row.clientWidth - row.scrollLeft > 4 });
    const onWheel = (e: WheelEvent) => {
      if (!fine?.matches || e.ctrlKey) return;
      const to = wheelMove({ deltaX: e.deltaX, deltaY: e.deltaY, scrollLeft: row.scrollLeft, max: row.scrollWidth - row.clientWidth });
      if (to === null) return;
      const by = to - row.scrollLeft;
      if (by === 0) return; // it can't move further this way: the page scrolls as usual
      e.preventDefault();
      // scrollBy (not setting scrollLeft): a row that snaps to its cards then follows the direction of the turn instead of snapping back.
      row.scrollBy({ left: by, behavior: "instant" as ScrollBehavior });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (dir: -1 | 1) => {
    const row = getBox()?.querySelector<HTMLElement>("[data-row-scroller]");
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
    <>
      {can.left && arrow(-1)}
      {can.right && arrow(1)}
    </>
  );
}

export function RowControls({ children, className = "", as = "div" }: { children: React.ReactNode; className?: string; as?: "div" | "span" }) {
  const Tag: React.ElementType = as;
  const wrap = useRef<HTMLDivElement>(null); // typed as a div for React's ref check; a span works the same at run time
  const arrows = useRowControls(() => wrap.current);
  return (
    <Tag ref={wrap} className={`row-controls relative ${as === "span" ? "block " : ""}${className}`} data-row-controls>
      {children}
      {arrows}
    </Tag>
  );
}

// Without a wrapper: for a parent whose first child div must stay the scrolling row (Settings > Picture: a fieldset). Put it inside the parent,
// next to the row; the parent itself must have the classes `row-controls relative`. It adds a hidden marker, and the arrows when they are needed.
export function RowControlsInline() {
  const marker = useRef<HTMLSpanElement>(null);
  const arrows = useRowControls(() => marker.current?.parentElement ?? null);
  return (
    <>
      <span ref={marker} hidden data-row-marker />
      {arrows}
    </>
  );
}
