"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// The "+" on a moment and the emoji choices it opens. The choices hang from the "+" button (never from the page edge), stay fully inside the
// screen (at most the width minus 16 px each side, the emoji wrapping in columns), and open below the button, or above when there is no room below.
// The choices themselves (a server form) come in as children, so reacting still works without script.
export function ReactionPicker({ summaryClass, children }: { summaryClass: string; children: ReactNode }) {
  const box = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; above: boolean }>({ left: 0, above: false });

  useEffect(() => {
    const d = box.current;
    if (!d) return;
    const fit = () => {
      if (!d.open || !panel.current) return;
      const b = d.getBoundingClientRect();
      const w = Math.min(panel.current.offsetWidth || 248, window.innerWidth - 32);
      const h = panel.current.offsetHeight || 120;
      const left = Math.min(Math.max(b.left, 16), window.innerWidth - 16 - w) - b.left; // 16 px from each edge at least
      const room = window.innerHeight - 96; // keep clear of the floating bar at the bottom
      const above = b.bottom + 8 + h > room && b.top - 8 - h > 8;
      setPlace({ left, above });
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
        className="emoji-font absolute z-10 w-[15.5rem] max-w-[calc(100vw-32px)] rounded-[14px] border border-line bg-white p-2 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]"
        style={{ left: place.left, ...(place.above ? { bottom: 52 } : { top: 52 }) }}
      >
        {children}
      </div>
    </details>
  );
}
