"use client";

import { useEffect, useRef } from "react";
import { trapFocus } from "./focus-trap";

// Put the returned ref on the full-screen layer of a sheet or dialog. While `open`: focus moves in, Tab stays
// inside, Escape calls onEscape (if given), and focus returns to where it was when the sheet closes.
export function useFocusTrap(open: boolean, opts: { onEscape?: () => void; start?: () => HTMLElement | null } = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(opts);
  latest.current = opts;
  useEffect(() => {
    if (!open) return;
    return trapFocus(ref.current, {
      onEscape: latest.current.onEscape ? () => latest.current.onEscape?.() : undefined,
      start: latest.current.start?.() ?? null,
    });
  }, [open]);
  return ref;
}
