"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useDragToClose } from "@/lib/use-drag-close";
import Link from "@/components/Link";
import { ChevronDown } from "@/components/icons";

// The Expenses filter as a bottom sheet: the "Filter" button opens it, the list stays visible behind it, and
// the form inside has "Show results" fixed at its bottom, so it is always in reach and never under the bar.
// The form itself (its fields and how it filters) is passed in and is the same as before; only where it sits changed.
// The form is sent the plain way (a full page load, which closes the sheet); a link followed inside it (Clear, This month, Last month) closes it too.
export function FilterSheet({ label, clearHref, children }: { label: string; clearHref: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const dragRef = useDragToClose(close);
  const layer = useFocusTrap(open, { onEscape: close });
  // The page behind stays put while the sheet is open.
  useEffect(() => {
    if (!open) return;
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = was;
    };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="rounded-full border border-line px-4 py-1.5 text-sm font-medium text-fg active:bg-mist" data-filter-open>
        {label}
        <ChevronDown size={14} className="ml-1.5 inline-block align-[-2px] text-fg/55" />
      </button>
      {open &&
        createPortal(
          <div ref={layer} className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60" onClick={close} data-filter-sheet>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Filter"
              ref={dragRef}
              onClick={(e) => {
                e.stopPropagation();
                if ((e.target as HTMLElement).closest("a")) close();
              }}
              className="sheet-enter flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-[28px] border-t border-line bg-canvas pt-3 text-fg"
            >
              <span aria-hidden className="mx-auto mb-3 block h-1 w-10 shrink-0 rounded-full bg-fg/20" />
              <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3">
                <p className="font-display text-xl font-semibold tracking-tight">Filter</p>
                <Link href={clearHref} className="inline-flex min-h-11 items-center text-sm font-medium text-gray-500 underline underline-offset-4" data-filter-clear>
                  Clear
                </Link>
              </div>
              {children}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
