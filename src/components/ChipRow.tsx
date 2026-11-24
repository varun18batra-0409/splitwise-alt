"use client";

import { useEffect, useRef, useState } from "react";
import { revealIfNewPick } from "@/lib/reveal-selected";
import { RowControls } from "@/components/RowControls";

// A row of chips that scrolls sideways. Names are never cut with "…": a long one is a long chip, and the row scrolls.
// The row runs to the screen's edges (so the next chip is seen coming in), and while there is more to the right a soft fade
// says so. The fade goes when the end is reached.
export function ChipRow({ label, children, dataKey }: { label: string; children: React.ReactNode; dataKey?: string }) {
  const el = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const n = el.current;
    if (!n) return;
    const check = () => setMore(n.scrollWidth - n.clientWidth - n.scrollLeft > 4);
    check();
    n.addEventListener("scroll", check, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(n);
    return () => {
      n.removeEventListener("scroll", check);
      ro?.disconnect();
    };
  }, []);
  // A newly picked chip is brought into full view (when the row opens, or the pick changes); otherwise only the finger moves the row.
  const shown = useRef<Element | null>(null);
  useEffect(() => revealIfNewPick(el.current, shown));
  return (
    <RowControls className="-mx-5 mb-5">
      <nav ref={el} data-row-scroller aria-label={label} className="flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" {...(dataKey ? ({ [dataKey]: "" } as Record<string, string>) : {})}>
        {children}
      </nav>
      {more && <span aria-hidden data-chip-fade className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-r from-transparent to-[var(--color-canvas)]" />}
    </RowControls>
  );
}
