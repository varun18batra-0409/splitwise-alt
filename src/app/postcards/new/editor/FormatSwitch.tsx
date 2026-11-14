"use client";

import type { Format } from "@/lib/postcards/format";

// "Front and back" or "One side". Shown on the first step only.
export function FormatSwitch({ format, onChange }: { format: Format; onChange: (f: Format) => void }) {
  const opt = (id: Format, name: string) => (
    <button key={id} type="button" aria-pressed={format === id} onClick={() => onChange(id)} data-format-choice={id} className={`h-11 rounded-full text-[13px] ${format === id ? "bg-[#2a2a30] font-semibold text-fg" : "text-fg/70"}`}>
      {name}
    </button>
  );
  return (
    <div role="group" aria-label="Postcard format" className="mx-auto mt-2 grid w-[min(100%,260px)] flex-none grid-cols-2 gap-1 rounded-full border border-fg/10 bg-[#16161a] p-[3px]">
      {opt("classic", "Front and back")}
      {opt("oneside", "One side")}
    </div>
  );
}
