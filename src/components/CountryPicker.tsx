"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { createPortal } from "react-dom";
import { searchCountries } from "@/lib/geo";
import { addPlacesAction } from "@/app/passport-actions";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useDragToClose } from "@/lib/use-drag-close";

// "Places I've been": tick as many countries as you like, then add them in one go.
export function CountryPicker({ added, home = "", tile = false }: { added: string[]; home?: string; tile?: boolean }) {
  const [open, setOpen] = useState(false);
  const dragRef = useDragToClose(useCallback(() => setOpen(false), []), { from: "top" });
  const [q, setQ] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  const have = useMemo(() => new Set(added), [added]);
  const opener = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  // Once the countries are saved (the list we're given changes), close and start fresh.
  const saved = added.join();
  useEffect(() => {
    setOpen(false);
    setTicked([]);
    setQ("");
  }, [saved]);
  const shown = useMemo(() => searchCountries(q), [q]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  const layer = useFocusTrap(open, { onEscape: () => setOpen(false), start: () => search.current });

  const toggle = (c: string) => setTicked((t) => (t.includes(c) ? t.filter((x) => x !== c) : [...t, c]));
  const n = ticked.length;

  return (
    <>
      {tile ? (
        // The dashed "Add a visited place" tile on the passport's Been tab.
        <button ref={opener} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="flex h-14 w-full items-center justify-center gap-2.5 rounded-[20px] border border-dashed border-fg/25 text-[16px] text-fg active:bg-fg/10" data-add-visited>
          <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add a visited place
        </button>
      ) : (
        <button ref={opener} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="mt-3 w-full rounded-xl border border-line px-4 py-3 text-sm font-semibold active:bg-mist">
          + Add countries
        </button>
      )}
      {open &&
        createPortal(
          <div ref={layer} className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70" onClick={() => setOpen(false)}>
            <form
              action={addPlacesAction}
              role="dialog"
              aria-modal="true"
              aria-label="Add countries"
              onClick={(e) => e.stopPropagation()}
              ref={dragRef}
              className="sheet-enter flex h-[88dvh] w-full max-w-md flex-col rounded-t-[24px] border border-line bg-canvas text-fg"
            >
              <div className="flex items-center justify-between px-5 pb-2 pt-4">
                <p className="font-display text-xl font-semibold">Countries you’ve been to</p>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-xl text-fg/60 active:bg-mist">
                  ×
                </button>
              </div>
              <div className="px-5 pb-2">
                <input
                  ref={search}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search countries"
                  aria-label="Search countries"
                  autoComplete="off"
                  className="w-full rounded-xl border border-line bg-transparent px-4 py-3 text-base outline-none focus:border-fg/50"
                />
              </div>
              {/* Ticked ones are sent even when the search hides them. */}
              {ticked.map((c) => (
                <input key={c} type="hidden" name="country" value={c} />
              ))}
              <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Countries">
                {shown.map((c) => {
                  const already = have.has(c.code) || c.code === home;
                  const on = already || ticked.includes(c.code);
                  return (
                    <li key={c.code}>
                      <label className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${already ? "opacity-50" : "active:bg-mist"}`}>
                        <input type="checkbox" checked={on} disabled={already} onChange={() => toggle(c.code)} className="h-5 w-5 shrink-0" aria-label={c.name} />
                        <span className="text-xl leading-none">{c.flag}</span>
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        {already && <span className="text-xs text-fg/60">{c.code === home ? "Home" : "Added"}</span>}
                      </label>
                    </li>
                  );
                })}
                {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg/60">No country matches “{q}”.</li>}
              </ul>
              <div className="border-t border-line px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
                <AddButton n={n} />
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}

// Shows "Adding…" while the countries are being saved.
function AddButton({ n }: { n: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={n === 0 || pending} className="pop block w-full bg-fg px-4 py-3.5 text-center font-semibold text-canvas [--pop-edge:#6e6b63] disabled:opacity-50">
      {pending ? "Adding…" : n === 0 ? "Tick the countries you’ve been to" : `Add ${n} ${n === 1 ? "country" : "countries"}`}
    </button>
  );
}
