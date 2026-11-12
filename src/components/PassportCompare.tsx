"use client";

import { useState } from "react";

// Our passports, in one small box: tabs for every country between you, the
// ones you've all been to ("Shared"), and the ones only one of you has (the tabs wrap onto a second row, none is ever cut off); under them, the
// flags with a short name each.
export type CompareSet = { key: string; label: string; countries: { code: string; flag: string; name: string }[] };

export function PassportCompare({ sets }: { sets: CompareSet[] }) {
  const [on, setOn] = useState(sets[0]?.key);
  const set = sets.find((s) => s.key === on) ?? sets[0];
  if (!set) return null;
  return (
    <div className="mt-4" data-passport-compare>
      <div role="tablist" aria-label="Who's been where" className="flex flex-wrap gap-1.5">
        {sets.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={s.key === set.key}
            onClick={() => setOn(s.key)}
            data-compare-tab={s.key}
            className={`max-w-full shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] ${s.key === set.key ? "border-fg bg-fg font-semibold text-canvas" : "border-line text-fg/70 active:bg-mist"}`}
          >
            {s.label} <span className={s.key === set.key ? "text-canvas/60" : "text-fg/60"}>{s.countries.length}</span>
          </button>
        ))}
      </div>
      <ul role="tabpanel" className="mt-3 grid grid-cols-5 gap-x-1 gap-y-2.5" data-compare-list={set.key}>
        {set.countries.map((c) => (
          <li key={c.code} className="flex min-w-0 flex-col items-center" title={c.name}>
            <span aria-hidden className="text-[26px] leading-none">
              {c.flag}
            </span>
            <span className="mt-1 w-full truncate text-center text-[10.5px] leading-tight text-fg/65">{c.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
