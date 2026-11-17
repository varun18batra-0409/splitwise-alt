"use client";

import { useEffect, useRef, useState } from "react";
import { keepPeeking, revealSelected } from "@/lib/reveal-selected";

// A row that scrolls sideways (chips, small cards). Words fit, no new look: while there is more to the right a soft fade at the
// edge says so (gone at the end), the picked item is scrolled fully into view, and the item cut by the edge is never a sliver:
// when the finger lifts it is whole or clearly peeking (at least 40%).
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
    const stop = keepPeeking(el, more ? FADE / 2 : 0);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
      stop();
    };
  }, [more]);
  useEffect(() => revealSelected(ref.current));
  return (
    <div ref={ref} className={`overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`} style={more ? { WebkitMaskImage: MASK, maskImage: MASK } : undefined} {...rest}>
      {children}
    </div>
  );
}
