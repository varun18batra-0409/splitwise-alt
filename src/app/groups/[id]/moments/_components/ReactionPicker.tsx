"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PICKER_BAR, placePicker } from "@/lib/picker-place";

// The "+" on a moment and the emoji choices it opens. The choices hang from the "+" button (never from the page edge), stay fully inside the
// screen (at most the width minus 16 px each side, the emoji wrapping in columns), and open right under the button (with a small pointer to it).
// If the picker is taller than the room under the button the page scrolls to fit; only when there is still no room does it open above the
// button, and then it stays short (src/lib/picker-place.ts).
// The choices themselves (a server form) come in as children, so reacting still works without script.
export function ReactionPicker({ summaryClass, children }: { summaryClass: string; children: ReactNode }) {
  const box = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; above: boolean; maxH?: number; point: number }>({ left: 0, above: false, point: 16 });

  useEffect(() => {
    const d = box.current;
    if (!d) return;
    const fit = () => {
      if (!d.open || !panel.current) return;
      const b = d.getBoundingClientRect();
      // The card around the "+" may cut off what hangs outside it, so room is measured against the nearer of that card and the window.
      let area = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      let clipped = false;
      for (let el = d.parentElement; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible") {
          const r = el.getBoundingClientRect();
          area = { left: Math.max(area.left, r.left), top: Math.max(area.top, r.top), right: Math.min(area.right, r.right), bottom: Math.min(area.bottom, r.bottom) };
          clipped = true;
          break;
        }
      }
      const w = Math.min(panel.current.offsetWidth || 248, area.right - area.left - 32, window.innerWidth - 32);
      const h = panel.current.scrollHeight || 120; // the full height of the choices, whatever the panel is capped to
      const left = Math.min(Math.max(b.left, area.left + 16), area.right - 16 - w) - b.left; // 16 px from each edge at least
      const root = document.documentElement;
      // Inside a card that cuts things off the page can't scroll to make room, so the card's own edges are the room.
      const spot = placePicker({
        buttonTop: clipped ? b.top - Math.max(area.top, 8) + 8 : b.top,
        buttonBottom: b.bottom,
        viewHeight: clipped ? Math.min(area.bottom + PICKER_BAR, window.innerHeight) : window.innerHeight,
        panelHeight: h + 2,
        scrollRoom: clipped ? 0 : root.scrollHeight - window.innerHeight - window.scrollY,
      });
      if (spot.scrollBy > 0) window.scrollBy({ top: spot.scrollBy, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      setPlace({ left, above: spot.above, maxH: spot.maxHeight, point: Math.min(Math.max(b.width / 2 - left - 6, 10), w - 22) });
    };
    const onToggle = () => requestAnimationFrame(fit);
    d.addEventListener("toggle", onToggle);
    window.addEventListener("resize", fit);
    return () => {
      d.removeEventListener("toggle", onToggle);
      window.removeEventListener("resize", fit);
    };
  }, []);

  return (
    <details ref={box} className="relative">
      <summary aria-label="React" className={summaryClass} style={{ width: 44, minWidth: 44 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </summary>
      <div
        ref={panel}
        className="emoji-font absolute z-10 w-[15.5rem] max-w-[calc(100vw-32px)] overflow-y-auto overscroll-contain rounded-[14px] border border-line bg-white p-2 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]"
        style={{ left: place.left, maxHeight: place.maxH, ...(place.above ? { bottom: 52 } : { top: 52 }) }}
        data-picker-place={place.above ? "above" : "below"}
      >
        {children}
      </div>
      {/* The small pointer to the "+" (it sits outside the panel's scroll, on the edge facing the button). */}
      <span
        aria-hidden
        className={`pointer-events-none absolute z-[11] block size-3 rotate-45 bg-white ${place.above ? "border-b border-r border-line" : "border-l border-t border-line"}`}
        style={{ left: place.left + place.point, ...(place.above ? { bottom: 46 } : { top: 46 }) }}
        data-picker-pointer
      />
    </details>
  );
}
