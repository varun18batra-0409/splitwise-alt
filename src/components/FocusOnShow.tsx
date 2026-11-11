"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Puts the keyboard focus on what it wraps once the screen shows (autoFocus
// isn't reliable after a page change), so the safe choice is the default.
export function FocusOnShow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("a, button");
    el?.focus();
  }, []);
  return (
    <span ref={ref} className="contents">
      {children}
    </span>
  );
}
