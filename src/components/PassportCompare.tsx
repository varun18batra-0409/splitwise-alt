"use client";

import { useState } from "react";
import { WorldMap } from "@/components/PassportBook";
import { stampInk } from "@/components/stamps/StampArt";

// Our passports, in one small box: tabs for every country between you, the
// ones you've all been to ("Shared"), and the ones only one of you has (the tabs wrap onto a second row, none is ever cut off); under them, a
// small photo of each country with its short name (a drawn stamp ring where we have no photo).
export type CompareSet = { key: string; label: string; countries: { code: string; flag: string; name: string; photo?: string }[]; hideCount?: boolean }; // hideCount: the number is already said above (the "Everywhere" tab)

export function PassportCompare({ sets, showMap = false }: { sets: CompareSet[]; showMap?: boolean }) {
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
            className={`max-w-full shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] ${s.key === set.key ? "border-fg shadow-[inset_0_0_0_0.5px_var(--color-fg)] font-semibold text-fg" : "border-fg/15 text-fg/85 active:bg-mist"}`}
          >
            {s.label}
            {!s.hideCount && <span className={s.key === set.key ? "text-fg/55" : "text-fg/60"}> {s.countries.length}</span>}
          </button>
        ))}
      </div>
      {showMap && set.countries.length > 0 && (
        // The map follows the chosen tab: the same countries as the flags below.
        <div className="mt-3 rounded-[14px] bg-[#efe8d6] p-2" data-compare-map={set.key}>
          <WorldMap className="" index={set.countries.map((c) => ({ code: c.code, name: c.name, trips: 1 }))} />
        </div>
      )}
      <ul role="tabpanel" className="mt-3 grid grid-cols-4 gap-x-2 gap-y-3 min-[400px]:grid-cols-5" data-compare-list={set.key}>
        {set.countries.map((c) => (
          <li key={c.code} className="flex min-w-0 flex-col items-center" title={c.name}>
            {c.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.photo} alt="" width={56} height={56} loading="lazy" className="h-14 w-14 rounded-[14px] object-cover" />
            ) : (
              <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-[#efe8d6]">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 text-[11px] font-extrabold" style={{ color: stampInk(c.code, c.name), borderColor: stampInk(c.code, c.name) }}>
                  {c.code}
                </span>
              </span>
            )}
            <span className="mt-1 w-full text-center text-[12px] leading-tight text-fg/75">{c.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
