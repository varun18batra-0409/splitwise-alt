"use client";

import Link from "@/components/Link";
import { useEffect, useRef, useState } from "react";
import { trapFocus } from "@/lib/focus-trap";
import { markSheetSeen, shouldShowSheet, sheetFor, type SheetCard } from "@/lib/group-type-sheet";

const ICONS: Record<SheetCard["icon"], React.ReactNode> = {
  repeat: (
    <>
      <path d="M4 4h16v16H4z" />
      <path d="M4 9h16M9 4v5" />
    </>
  ),
  door: (
    <>
      <path d="M10 4H5v16h5" />
      <path d="M14 8l4 4-4 4M18 12H9" />
    </>
  ),
  split: <path d="M12 3v18M5 8h14M7 8l-3 6h6zM17 8l-3 6h6z" />,
  ahead: <path d="M4 17l5-5 4 4 7-8M15 8h5v5" />,
  tally: <path d="M6 5v14M10 5v14M14 5v14M18 5v14M4 17L20 7" />,
  confirm: <path d="M5 12l5 5 9-10" />,
};

// A bottom sheet that shows once per group on this phone: what is special about a flat, a couple or a game night.
// It sits above the page without blocking it (tap outside, Escape or "Got it" closes it), and if the phone can't
// remember (blocked storage) it simply doesn't appear.
export function GroupTypeSheet({ groupId, type }: { groupId: string; type: string }) {
  const sheet = sheetFor(type, groupId);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let show = false;
    try {
      show = shouldShowSheet(window.localStorage, groupId);
    } catch {
      show = false;
    }
    setOpen(show);
  }, [groupId]);

  function close() {
    try {
      markSheetSeen(window.localStorage, groupId);
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  // While open: focus moves into the sheet, Tab stays inside it, Escape closes, and focus goes back to where it was.
  useEffect(() => {
    if (!open) return;
    return trapFocus(box.current, { onEscape: close, start: heading.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!sheet || !open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={close} data-type-sheet={sheet.kind}>
      <section
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={sheet.title}
        onClick={(e) => e.stopPropagation()}
        className="sheet-enter w-full max-w-md rounded-t-[28px] border border-b-0 border-line bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
      >
        <span aria-hidden className="mx-auto block h-1 w-10 rounded-full bg-fg/20" />
        <h2 ref={heading} tabIndex={-1} className="mt-4 font-display outline-none text-[26px] font-semibold leading-tight tracking-tight">{sheet.title}</h2>
        <ul className="mt-4 space-y-3">
          {sheet.cards.map((c) => (
            <li key={c.title} className="flex gap-3 rounded-2xl border border-line bg-mist p-4">
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-canvas text-owed">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  {ICONS[c.icon]}
                </svg>
              </span>
              <span className="min-w-0">
                <b className="block text-[15px] font-semibold">{c.title}</b>
                <span className="mt-0.5 block text-sm leading-snug text-fg/65">{c.body}</span>
              </span>
            </li>
          ))}
        </ul>
        {sheet.note && <p className="mt-4 text-center text-xs text-fg/55" data-sheet-note>{sheet.note}</p>}
        <div className="mt-5 space-y-2">
          <Link href={sheet.primary.href} onClick={close} className="pop block w-full bg-fg px-5 py-3.5 text-center text-base font-semibold text-canvas [--pop-edge:#6e6b63]" data-type-sheet-primary>
            {sheet.primary.label}
          </Link>
          <button type="button" onClick={close} className="block min-h-11 w-full rounded-full px-5 py-3 text-center text-base font-semibold text-fg/70 active:bg-mist" data-type-sheet-close>
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}
