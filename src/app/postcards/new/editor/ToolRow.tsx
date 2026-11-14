"use client";

import { useEffect, useRef, useState } from "react";

export type ToolDef = { id: string; name: string; icon: React.ReactNode };

// The tools for the step, one row at thumb height: an icon and one word each. Six fit on a normal phone; on a narrow one (or with
// seven, one side) the row scrolls sideways and the last one peeks in, with a soft fade at the right edge while there is more.
export function ToolRow({ label, tools, active, onPick }: { label: string; tools: ToolDef[]; active: string; onPick: (id: string) => void }) {
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
  }, [tools.length]);
  return (
    <nav aria-label={label} className="flex-none">
      <div ref={ref} className="flex gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none]" style={more ? { WebkitMaskImage: "linear-gradient(to right,#000 calc(100% - 28px),transparent)", maskImage: "linear-gradient(to right,#000 calc(100% - 28px),transparent)" } : undefined} data-tool-row>
        {tools.map((t) => {
          const on = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              data-tool={t.id}
              onClick={() => onPick(t.id)}
              className={`flex h-16 min-w-[52px] flex-1 shrink-0 flex-col items-center justify-center gap-1 rounded-[12px] border px-1 text-[11px] transition-transform active:scale-95 motion-reduce:transition-none ${on ? "border-fg bg-mist font-semibold text-fg" : "border-transparent bg-[#16161a] text-fg/80"}`}
            >
              {t.icon}
              <span className="whitespace-nowrap">{t.name}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
