"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { trapFocus } from "@/lib/focus-trap";

// The bottom sheet shell shared by the two "check before you go on" sheets: "These groups will move to this account" (GuestMoveSheet)
// and "Sign in to do this" (SignInSheet). Overlay, slide-in, rounded top, handle bar, focus kept inside, Escape and a tap outside close.
// Only those two use it; the other sheets in the app keep their own markup.
export function Sheet({
  titleId,
  title,
  onClose,
  footer,
  children,
  guestMarker,
  signinMarker,
}: {
  titleId: string;
  title: string;
  onClose: () => void;
  footer: ReactNode; // the buttons
  children: ReactNode; // the text and lists under the title (scrolls when long)
  guestMarker?: boolean; // adds data-guest-sheet (the tests look for it)
  signinMarker?: boolean; // adds data-signin-sheet
}) {
  const box = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // onClose only clears a ref and a flag, so the first copy is always right; keeping the focus trap from restarting on every render.
  useEffect(() => trapFocus(box.current, { onEscape: onClose, start: heading.current }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose} data-guest-sheet={guestMarker ? "" : undefined} data-signin-sheet={signinMarker ? "" : undefined}>
      <section
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="sheet-enter flex max-h-[92dvh] w-full max-w-md flex-col rounded-t-[28px] border border-b-0 border-line bg-white px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
      >
        <span aria-hidden className="mx-auto block h-1 w-10 shrink-0 rounded-full bg-fg/20" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="mt-4 font-display text-[26px] font-semibold leading-tight tracking-tight outline-none">
            {title}
          </h2>
          {children}
        </div>
        <div className="mt-4 space-y-2">{footer}</div>
      </section>
    </div>
  );
}
