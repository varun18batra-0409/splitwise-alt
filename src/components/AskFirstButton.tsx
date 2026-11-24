"use client";

import { useEffect, useRef, useState } from "react";

// A button that asks first, right on the page (not the browser's pop-up box, which looks different on every phone and can't be styled).
// Tap it and the question opens under it, with the real submit button ("confirmLabel") and a "Not now". Put it inside the <form>: only the
// confirm button submits, so the form's hidden fields are sent exactly as before. Without script the first tap can't open anything, so
// the button is a plain submit then (nothing is lost, it just doesn't ask).
export function AskFirstButton({ label, message, confirmLabel, cancelLabel = "Not now", className, confirmClassName, cancelClassName }: {
  label: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  className?: string;
  confirmClassName?: string;
  cancelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false); // true once the page is awake: only then does the first tap ask
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => setArmed(true), []);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button type={armed ? "button" : "submit"} className={className} onClick={armed ? () => setOpen(true) : undefined} data-ask-first>
        {label}
      </button>
    );
  }
  return (
    <div
      role="alertdialog"
      aria-label={message}
      data-ask-open
      className="rounded-[20px] border border-line bg-white px-4 py-3.5"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <p className="text-[15px] leading-snug text-fg">{message}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className={cancelClassName ?? "inline-flex min-h-11 items-center justify-center rounded-full border border-fg/25 px-4 text-sm font-semibold text-fg"}>
          {cancelLabel}
        </button>
        <button ref={first} type="submit" data-haptic="success" className={confirmClassName ?? "pop inline-flex min-h-11 items-center justify-center bg-fg px-4 text-sm font-semibold text-canvas"} data-ask-confirm>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
