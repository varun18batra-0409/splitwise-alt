"use client";

import { useEffect, useRef, useState } from "react";
import { revealIfNewPick } from "@/lib/reveal-selected";

// A row that scrolls sideways (chips, small cards). Words fit, no new look: while there is more to the right a soft fade at the
// edge says so (gone at the end), and a newly picked item is scrolled fully into view. Otherwise the row moves only when the finger
// moves it (founder, 22 Nov): no nudging after a swipe, and no jumping back to the picked item while swiping.
const FADE = 28;
const MASK = `linear-gradient(to right,#000 calc(100% - ${FADE}px),transparent)`;

export function SideRow({ children, className = "", ...rest }: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  }, []);
  const shown = useRef<Element | null>(null);
  useEffect(() => revealIfNewPick(ref.current, shown));
  return (
    <div ref={ref} className={`overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`} style={more ? { WebkitMaskImage: MASK, maskImage: MASK } : undefined} {...rest}>
      {children}
    </div>
  );
}
